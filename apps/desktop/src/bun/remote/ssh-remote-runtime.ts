import { randomBytes } from "node:crypto";

import { REMOTE_RUNTIME_PROTOCOL_VERSION } from "@llm-space/runtime/remote-protocol";

import { findFreePort } from "./port";
import {
  spawnManagedProcess,
  waitForProcess,
  type ManagedProcess,
} from "./process-utils";
import { RemoteRuntimeClient } from "./remote-runtime-client";
import type { SshRemoteRuntimeConfig } from "./ssh-bootstrap-config";
import {
  buildRemoteCleanupArgs,
  buildRemoteServerArgs,
  buildTunnelArgs,
} from "./ssh-command";

export interface SshRemoteRuntimeHandle {
  client: RemoteRuntimeClient;
  stop(): Promise<void>;
}

export async function startSshRemoteRuntime(
  config: SshRemoteRuntimeConfig
): Promise<SshRemoteRuntimeHandle> {
  const token = _generateToken();
  const localPort = config.localPort ?? (await findFreePort());
  const processes: ManagedProcess[] = [];

  try {
    await _cleanupRemoteServer(config);

    const serverProcess = spawnManagedProcess(
      "remote server",
      "ssh",
      buildRemoteServerArgs({ config, token })
    );
    processes.push(serverProcess);
    await _waitForProcessAlive(serverProcess, "server-start");

    const tunnelProcess = spawnManagedProcess(
      "ssh tunnel",
      "ssh",
      buildTunnelArgs({ config, localPort })
    );
    processes.push(tunnelProcess);
    await _waitForProcessAlive(tunnelProcess, "tunnel-start");

    const client = new RemoteRuntimeClient({
      id: config.id,
      name: config.name,
      baseUrl: `http://127.0.0.1:${localPort}`,
      token,
    });
    await _waitForHealth(client, processes);

    return {
      client,
      stop: async () => {
        client.shutdown();
        await Promise.all(processes.map((process) => process.stop()));
        await _cleanupRemoteServer(config);
      },
    };
  } catch (error) {
    await Promise.all(processes.map((process) => process.stop()));
    await _cleanupRemoteServer(config);
    throw error;
  }
}

async function _cleanupRemoteServer(
  config: SshRemoteRuntimeConfig
): Promise<void> {
  const cleanup = spawnManagedProcess(
    "remote cleanup",
    "ssh",
    buildRemoteCleanupArgs(config)
  );
  await waitForProcess(cleanup.child, 5_000);
}

function _generateToken(): string {
  return `llm-space-${randomBytes(24).toString("base64url")}`;
}

async function _waitForProcessAlive(
  process: ManagedProcess,
  stage: "server-start" | "tunnel-start"
): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 250));
  if (process.child.exitCode !== null || process.child.signalCode !== null) {
    throw new Error(
      `SSH remote runtime bootstrap failed during ${stage}: ${process.label} exited early. ${process.output()}`
    );
  }
}

async function _waitForHealth(
  client: RemoteRuntimeClient,
  processes: ManagedProcess[]
): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    for (const process of processes) {
      if (
        process.child.exitCode !== null ||
        process.child.signalCode !== null
      ) {
        throw new Error(
          `SSH remote runtime bootstrap failed during health-check: ${process.label} exited early. ${process.output()}`
        );
      }
    }
    try {
      await client.connect();
      const info = client.info();
      if (!info.capabilities.length) {
        throw new Error("Remote runtime returned no capabilities.");
      }
      return;
    } catch (error) {
      lastError = error;
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(
    `SSH remote runtime bootstrap failed during health-check: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }. Expected protocol ${REMOTE_RUNTIME_PROTOCOL_VERSION}.`
  );
}
