import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { SshRemoteRuntimeConfig } from "./ssh-bootstrap-config";

let scenario:
  | "missing-runtime-binary"
  | "non-runtime-failure"
  | "success";
let installCalls = 0;
let connectCalls = 0;
let stopCalls = 0;
let diagnosticCalls = 0;

await mock.module("./port", () => ({
  findFreePort: () => Promise.resolve(40000),
}));

await mock.module("./remote-server-installer", () => ({
  RemoteServerInstallError: class RemoteServerInstallError extends Error {
    readonly stage = "server-install";
  },
  installRemoteServerPackage: () => {
    installCalls += 1;
    return Promise.resolve({
      entrypoint: `/opt/runtime/versions/test-${installCalls}/bin/llm-space-server`,
      version: "test",
      platform: { os: "linux", arch: "x64" },
    });
  },
}));

await mock.module("./remote-exec", () => ({
  execRemoteCommand: () => {
    diagnosticCalls += 1;
    return Promise.resolve({
      stdout: "USER=test\nHOME=/home/test\nPWD=/home/test\nentrypoint_exists:1\nentrypoint_executable:1\n",
      stderr: "",
    });
  },
}));

await mock.module("./remote-runtime-client", () => ({
  RemoteRuntimeClient: class RemoteRuntimeClient {
    connect() {
      connectCalls += 1;
      return Promise.resolve();
    }

    info() {
      return { capabilities: ["streamThread"] };
    }

    shutdownRemote() {
      return Promise.resolve();
    }

    shutdown() {
      return undefined;
    }
  },
}));

await mock.module("./process-utils", () => ({
  spawnManagedProcess: (label: string) => {
    const attempt = installCalls;
    const missing =
      label === "remote server" &&
      scenario === "missing-runtime-binary" &&
      attempt === 1;
    const nonRuntimeFailure =
      label === "remote server" &&
      scenario === "non-runtime-failure" &&
      attempt === 1;
    return {
      label,
      child: {
        exitCode: missing || nonRuntimeFailure ? 127 : null,
        signalCode: null,
      },
      output: () =>
        missing
          ? "bash: line 1: /opt/runtime/versions/test/bin/llm-space-server: No such file or directory"
          : nonRuntimeFailure
            ? "bash: bun: command not found"
            : "",
      stop: () => {
        stopCalls += 1;
        return Promise.resolve();
      },
    };
  },
}));

const { startSshRemoteRuntime } = await import("./ssh-remote-runtime");

const CONFIG: SshRemoteRuntimeConfig = {
  id: "remote:test",
  name: "test",
  host: "host",
  extraArgs: [],
  remoteRepo: "",
  remoteInstallDir: "~/.llm-space/remote-runtime",
  remoteHome: "~/.llm-space-server",
  remoteServerPort: 39123,
  makeDefault: false,
};

beforeEach(() => {
  scenario = "missing-runtime-binary";
  installCalls = 0;
  connectCalls = 0;
  stopCalls = 0;
  diagnosticCalls = 0;
});

describe("startSshRemoteRuntime", () => {
  test("does not reinstall when the runtime binary is missing", async () => {
    await startSshRemoteRuntime(CONFIG).then(
      () => {
        throw new Error("connect should fail");
      },
      (error) => {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain(
          "Remote runtime binary is missing"
        );
        expect((error as Error).message).toContain("Remote diagnostics:");
        expect((error as Error).message).toContain("entrypoint_exists:1");
        expect((error as Error).message).not.toContain("reinstall retry");
      }
    );

    expect(installCalls).toBe(1);
    expect(diagnosticCalls).toBe(1);
    expect(connectCalls).toBe(0);
    expect(stopCalls).toBeGreaterThanOrEqual(1);
  });

  test("does not reinstall for non-runtime startup failures", async () => {
    scenario = "non-runtime-failure";

    await startSshRemoteRuntime(CONFIG).then(
      () => {
        throw new Error("connect should fail");
      },
      (error) => {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("bash: bun: command not found");
      }
    );

    expect(installCalls).toBe(1);
    expect(diagnosticCalls).toBe(0);
  });
});
