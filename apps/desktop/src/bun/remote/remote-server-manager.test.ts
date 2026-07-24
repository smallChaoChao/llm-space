import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { RuntimeClient } from "@llm-space/runtime/runtime";
import { RuntimeRouter } from "@llm-space/runtime/runtime";
import { describe, expect, test } from "bun:test";

import { RemoteServerManager } from "./remote-server-manager";
import type { SshRemoteRuntimeConfig } from "./ssh-bootstrap-config";

function _localRuntime(): RuntimeClient {
  return {
    info: () => ({
      id: "local",
      kind: "local",
      name: "Local",
      status: "connected",
      capabilities: [],
    }),
  } as unknown as RuntimeClient;
}

function _remoteRuntime(id: SshRemoteRuntimeConfig["id"]): RuntimeClient {
  return {
    info: () => ({
      id,
      kind: "remote",
      name: id,
      status: "connected",
      capabilities: [],
    }),
  } as unknown as RuntimeClient;
}

function _manager(
  start: (config: SshRemoteRuntimeConfig) => Promise<{
    client: RuntimeClient;
    stop(): Promise<void>;
  }>,
  home = mkdtempSync(path.join(tmpdir(), "llm-space-remote-manager-test-"))
): RemoteServerManager {
  process.env.LLM_SPACE_HOME = home;
  return new RemoteServerManager(new RuntimeRouter(_localRuntime()), start);
}

describe("RemoteServerManager", () => {
  test("connecting a second SSH server disconnects the first", async () => {
    const stopped: string[] = [];
    const manager = _manager((config) =>
      Promise.resolve({
        client: _remoteRuntime(config.id),
        stop: () => {
          stopped.push(config.id);
          return Promise.resolve();
        },
      })
    );

    const [host1] = manager.addServer({
      name: "host1",
      host: "host1",
    });
    const host2 = manager.addServer({
      name: "host2",
      host: "host2",
    })[1];

    await manager.connectServer(host1.id);
    const next = await manager.connectServer(host2.id);

    expect(stopped).toEqual([host1.runtimeId]);
    expect(next.find((server) => server.id === host1.id)?.status).toBe(
      "disconnected"
    );
    expect(next.find((server) => server.id === host2.id)?.status).toBe(
      "connected"
    );
    expect(next.find((server) => server.id === host2.id)?.defaultRuntime).toBe(
      true
    );
  });

  test("loads legacy server config with default install directory", () => {
    const home = mkdtempSync(
      path.join(tmpdir(), "llm-space-remote-manager-test-")
    );
    const settingsDir = path.join(home, "settings");
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      path.join(settingsDir, "remote-servers.json"),
      `${JSON.stringify(
        {
          servers: [
            {
              id: "legacy",
              kind: "ssh",
              name: "legacy host",
              host: "host",
              port: 22,
              remoteHome: "~/.llm-space-server",
              remoteServerPort: 39123,
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const manager = _manager(
      () => {
        throw new Error("unexpected connect");
      },
      home
    );

    expect(manager.listServers()[0]?.remoteInstallDir).toBe(
      "~/.llm-space/remote-runtime"
    );
  });
});
