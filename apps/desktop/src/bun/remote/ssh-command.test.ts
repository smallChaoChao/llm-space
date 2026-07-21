import { describe, expect, test } from "bun:test";

import type { SshRemoteRuntimeConfig } from "./ssh-bootstrap-config";
import {
  buildRemoteServerCommand,
  buildSshBaseArgs,
  buildSshTarget,
  buildTunnelArgs,
  shellQuote,
} from "./ssh-command";

const CONFIG: SshRemoteRuntimeConfig = {
  id: "remote:ssh-manual",
  name: "SSH host",
  host: "host",
  user: "user",
  port: 2222,
  identityFile: "/key file",
  extraArgs: ["-J", "jump"],
  remoteRepo: "/repo path/llm-space",
  remoteHome: "/tmp/home path",
  remoteServerPort: 39123,
  makeDefault: true,
};

describe("ssh command builders", () => {
  test("builds target and base args", () => {
    expect(buildSshTarget(CONFIG)).toBe("user@host");
    expect(buildSshBaseArgs(CONFIG)).toEqual([
      "-p",
      "2222",
      "-o",
      "BatchMode=yes",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=2",
      "-i",
      "/key file",
      "-J",
      "jump",
      "user@host",
    ]);
  });

  test("builds tunnel args with ExitOnForwardFailure", () => {
    expect(buildTunnelArgs({ config: CONFIG, localPort: 40000 })).toContain(
      "ExitOnForwardFailure=yes"
    );
    expect(buildTunnelArgs({ config: CONFIG, localPort: 40000 })).toContain(
      "127.0.0.1:40000:127.0.0.1:39123"
    );
  });

  test("shell quotes remote server command", () => {
    expect(shellQuote("a'b$c")).toBe("'a'\\''b$c'");
    const command = buildRemoteServerCommand({
      remoteRepo: "/repo path/llm-space",
      host: "127.0.0.1",
      port: 39123,
      token: "tok'en$;",
      home: "/tmp/home path",
    });
    expect(command).toContain("cd '/repo path/llm-space'");
    expect(command).toContain("--token 'tok'\\''en$;'");
    expect(command).toContain("--home '/tmp/home path'");
  });
});
