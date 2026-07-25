import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { RuntimeClient } from "@llm-space/runtime/runtime";
import { RuntimeRouter } from "@llm-space/runtime/runtime";

import { RemoteServerManager } from "./remote-server-manager";
import type { SshRemoteRuntimeConfig } from "./ssh-bootstrap-config";

type StartSshRemoteRuntime = ConstructorParameters<
  typeof RemoteServerManager
>[1];

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
  start: StartSshRemoteRuntime,
  home = mkdtempSync(path.join(tmpdir(), "llm-space-remote-manager-test-")),
  onStatusChanged?: ConstructorParameters<typeof RemoteServerManager>[2]
): RemoteServerManager {
  process.env.LLM_SPACE_HOME = home;
  return new RemoteServerManager(
    new RuntimeRouter(_localRuntime()),
    start,
    onStatusChanged
  );
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
    expect(manager.listServers()[0]).not.toHaveProperty("port");
  });

  test("drops advanced ssh overrides from current config version", () => {
    const home = mkdtempSync(
      path.join(tmpdir(), "llm-space-remote-manager-test-")
    );
    const settingsDir = path.join(home, "settings");
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      path.join(settingsDir, "remote-servers.json"),
      `${JSON.stringify(
        {
          version: 2,
          servers: [
            {
              id: "explicit-22",
              kind: "ssh",
              name: "explicit 22",
              host: "host",
              user: "user",
              port: 22,
              identityFile: "/tmp/key",
              remoteRepo: "/tmp/repo",
              remoteHome: "~/.llm-space-server",
              remoteServerPort: 39123,
              remoteInstallDir: "~/.llm-space/remote-runtime",
              localPort: 40000,
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

    const [server] = manager.listServers();
    expect(server).toMatchObject({
      name: "explicit 22",
      host: "host",
      user: "user",
      remoteInstallDir: "~/.llm-space/remote-runtime",
      remoteHome: "~/.llm-space-server",
      remoteServerPort: 39123,
    });
    expect(server).not.toHaveProperty("port");
    expect(server).not.toHaveProperty("identityFile");
    expect(server).not.toHaveProperty("remoteRepo");
    expect(server).not.toHaveProperty("localPort");
  });

  test("uses only name host and user for managed ssh config", async () => {
    let sshConfig: SshRemoteRuntimeConfig | undefined;
    const manager = _manager((config) => {
      sshConfig = config;
      return Promise.resolve({
        client: _remoteRuntime(config.id),
        stop: () => Promise.resolve(),
      });
    });

    const [server] = manager.addServer({
      name: "devbox",
      host: "devbox",
      user: "qiangenchao",
    });

    await manager.connectServer(server.id);

    expect(sshConfig).toMatchObject({
      name: "devbox",
      host: "devbox",
      user: "qiangenchao",
      port: undefined,
      identityFile: undefined,
      remoteRepo: "",
      remoteInstallDir: "~/.llm-space/remote-runtime",
      remoteHome: "~/.llm-space-server",
      remoteServerPort: 39123,
      localPort: undefined,
    });
  });

  test("cleans local state when disconnect stop fails", async () => {
    const statuses: string[] = [];
    const manager = _manager(
      (config) =>
        Promise.resolve({
          client: _remoteRuntime(config.id),
          stop: () => Promise.reject(new Error("stop failed")),
        }),
      undefined,
      ({ servers }) => statuses.push(servers[0]?.status ?? "missing")
    );

    const [server] = manager.addServer({ name: "host", host: "host" });
    await manager.connectServer(server.id);
    try {
      await manager.disconnectServer(server.id);
      throw new Error("disconnect should fail");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("stop failed");
    }

    const [view] = manager.listServers();
    expect(view?.status).toBe("disconnected");
    expect(view?.defaultRuntime).toBe(false);
    expect(statuses.at(-1)).toBe("disconnected");
  });

  test("publishes connection progress stages", async () => {
    const stages: string[] = [];
    const manager = _manager(
      (config, options) => {
        options?.onProgress?.({
          stage: "server-install",
          message: "Downloading remote runtime package",
        });
        options?.onProgress?.({
          stage: "server-start",
          message: "Starting remote runtime",
        });
        options?.onProgress?.({
          stage: "tunnel-start",
          message: "Opening SSH tunnel",
        });
        options?.onProgress?.({
          stage: "health-check",
          message: "Verifying remote runtime",
        });
        return Promise.resolve({
          client: _remoteRuntime(config.id),
          stop: () => Promise.resolve(),
        });
      },
      undefined,
      ({ servers }) => {
        const stage = servers[0]?.stage;
        if (stage) stages.push(stage);
      }
    );

    const [server] = manager.addServer({ name: "host", host: "host" });
    const next = await manager.connectServer(server.id);

    expect(stages).toContain("ssh-check");
    expect(stages).toContain("server-install");
    expect(stages).toContain("server-start");
    expect(stages).toContain("tunnel-start");
    expect(stages).toContain("health-check");
    expect(stages).toContain("connected");
    expect(next[0]?.stageLabel).toBe("Connected");
  });
});
