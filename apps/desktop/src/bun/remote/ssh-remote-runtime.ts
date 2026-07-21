import { randomBytes } from "node:crypto";

import { REMOTE_RUNTIME_PROTOCOL_VERSION } from "@llm-space/runtime/remote-protocol";

import { findFreePort } from "./port";
import { spawnManagedProcess, type ManagedProcess } from "./process-utils";
import { RemoteRuntimeClient } from "./remote-runtime-client";
import { installRemoteServerPackage } from "./remote-server-installer";
import type { SshRemoteRuntimeConfig } from "./ssh-bootstrap-config";
import {
  buildRemoteServerArgs,
  buildSourceRemoteServerCommand,
  buildSshBaseArgs,
  buildTunnelArgs,
} from "./ssh-command";
import { formatSshBootstrapFailure } from "./ssh-error";

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
    let install;
    try {
      install = await installRemoteServerPackage(config);
    } catch (error) {
      throw new Error(
        `SSH remote runtime bootstrap failed during server-install: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error }
      );
    }
    const serverProcess = spawnManagedProcess(
      "remote server",
      "ssh",
      process.env.LLM_SPACE_REMOTE_SERVER_MODE === "source"
        ? [
            ...buildSshBaseArgs(config),
            buildSourceRemoteServerCommand({
              remoteRepo: config.remoteRepo,
              host: "127.0.0.1",
              port: config.remoteServerPort,
              token,
              home: config.remoteHome,
            }),
          ]
        : buildRemoteServerArgs({
            config,
            token,
            entrypoint: install.entrypoint,
          }),
      { collectOutput: false }
    );
    processes.push(serverProcess);
    await _waitForProcessAlive(serverProcess, "server-start", config);

    const tunnelProcess = spawnManagedProcess(
      "ssh tunnel",
      "ssh",
      buildTunnelArgs({ config, localPort })
    );
    processes.push(tunnelProcess);
    await _waitForProcessAlive(tunnelProcess, "tunnel-start", config);

    const client = new RemoteRuntimeClient({
      id: config.id,
      name: config.name,
      baseUrl: `http://127.0.0.1:${localPort}`,
      token,
    });
    await _waitForHealth(client, processes, config);

    return {
      client,
      stop: async () => {
        await client.shutdownRemote().catch(() => undefined);
        client.shutdown();
        await Promise.all(processes.map((process) => process.stop()));
      },
    };
  } catch (error) {
    await Promise.all(processes.map((process) => process.stop()));
    throw error;
  }
}

function _generateToken(): string {
  return `llm-space-${randomBytes(24).toString("base64url")}`;
}

async function _waitForProcessAlive(
  process: ManagedProcess,
  stage: "server-start" | "tunnel-start",
  config: SshRemoteRuntimeConfig
): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 250));
  if (process.child.exitCode !== null || process.child.signalCode !== null) {
    throw new Error(
      formatSshBootstrapFailure({
        stage,
        label: process.label,
        output: process.output(),
        target: config.user ? `${config.user}@${config.host}` : config.host,
      })
    );
  }
}

async function _waitForHealth(
  client: RemoteRuntimeClient,
  processes: ManagedProcess[],
  config: SshRemoteRuntimeConfig
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
          formatSshBootstrapFailure({
            stage: "health-check",
            label: process.label,
            output: process.output(),
            target: config.user ? `${config.user}@${config.host}` : config.host,
          })
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
