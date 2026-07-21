import { mkdtempSync } from "node:fs";
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
  }>
): RemoteServerManager {
  process.env.LLM_SPACE_HOME = mkdtempSync(
    path.join(tmpdir(), "llm-space-remote-manager-test-")
  );
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
      remoteRepo: "/repo",
    });
    const host2 = manager.addServer({
      name: "host2",
      host: "host2",
      remoteRepo: "/repo",
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
});
