import { describe, expect, test } from "bun:test";

import {
  buildInstallCommand,
  installRemoteServerPackage,
} from "./remote-server-installer";
import { currentDesktopVersion } from "./server-package";
import type { SshRemoteRuntimeConfig } from "./ssh-bootstrap-config";

const CONFIG: SshRemoteRuntimeConfig = {
  id: "remote:test",
  name: "Remote",
  host: "host",
  extraArgs: [],
  remoteRepo: "/legacy repo",
  remoteInstallDir: "/opt/llm space/runtime",
  remoteHome: "/home/user/.llm-space-server",
  remoteServerPort: 39123,
  makeDefault: false,
};

describe("remote server installer", () => {
  test("skips download when matching manifest is already installed", async () => {
    const commands: string[] = [];
    const result = await installRemoteServerPackage(CONFIG, (_config, command) => {
      commands.push(command);
      if (command.includes("uname")) {
        return Promise.resolve({ stdout: "Linux\nx86_64\n", stderr: "" });
      }
      if (command.startsWith("cat ")) {
        return Promise.resolve({
          stdout: JSON.stringify({
            name: "llm-space-server",
            version: currentDesktopVersion(),
            protocolVersion: 1,
            os: "linux",
            arch: "x64",
            entrypoint: "bin/llm-space-server",
            createdAt: "2026-07-21T00:00:00.000Z",
          }),
          stderr: "",
        });
      }
      if (command.includes("ln -sfn")) {
        return Promise.resolve({ stdout: "", stderr: "" });
      }
      throw new Error(`unexpected command: ${command}`);
    });

    expect(result.entrypoint).toBe(
      `/opt/llm space/runtime/versions/${currentDesktopVersion()}/bin/llm-space-server`
    );
    expect(commands.some((command) => command.includes("curl -fL"))).toBe(false);
  });

  test("builds safely quoted install command", () => {
    const command = buildInstallCommand({
      installDir: "/opt/llm space/it's",
      version: "4.2.0",
      assetName: "llm-space-server-4.2.0-linux-x64.tar.gz",
      assetUrl: "https://example.test/a'b.tar.gz",
      packageDir: "/opt/llm space/it's/versions/4.2.0",
    });
    expect(command).toContain("/opt/llm space/it'\\''s");
    expect(command).toContain("https://example.test/a'\\''b.tar.gz");
    expect(command).toContain("--connect-timeout 15 --max-time 240");
    expect(command).toContain("--timeout=30 --tries=3");
    expect(command).not.toContain("/home/user/.llm-space-server");
  });

  test("describes package download timeouts with remote network probe", async () => {
    const promise = installRemoteServerPackage(CONFIG, (_config, command, timeoutMs) => {
      if (command.includes("uname")) {
        return Promise.resolve({ stdout: "Linux\nx86_64\n", stderr: "" });
      }
      if (command.startsWith("cat ")) {
        return Promise.reject(new Error("missing manifest"));
      }
      if (command.includes("curl -fL")) {
        expect(timeoutMs).toBe(300_000);
        return Promise.reject(
          new Error("Remote command timed out after 300000ms.")
        );
      }
      throw new Error(`unexpected command: ${command}`);
    });

    try {
      await promise;
      throw new Error("install should fail");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(
        /Remote runtime package download timed out after 300000ms\..*Check remote network access with: ssh host/s
      );
    }
  });
});
