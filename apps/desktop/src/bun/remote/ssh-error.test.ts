import { describe, expect, test } from "bun:test";

import {
  formatSshBootstrapFailure,
  parseMissingRuntimeBinaryFailure,
} from "./ssh-error";

describe("formatSshBootstrapFailure", () => {
  test("classifies OpenSSH host key failures", () => {
    const message = formatSshBootstrapFailure({
      stage: "tunnel-start",
      label: "ssh tunnel",
      target: "user@host1",
      output: `REMOTE HOST IDENTIFICATION HAS CHANGED!
IT IS POSSIBLE THAT SOMEONE IS DOING SOMETHING NASTY!
Offending ECDSA key in /Users/bytedance/.ssh/known_hosts:6
Error: forwarding disabled due to host key check failure`,
    });

    expect(message).toContain("SSH host key verification failed for user@host1");
    expect(message).toContain("/Users/bytedance/.ssh/known_hosts line 6");
    expect(message).toContain(
      "After confirming it is safe, remove that stale known_hosts entry and reconnect."
    );
    expect(message).toContain("port forwarding was disabled");
    expect(message).not.toContain("REMOTE HOST IDENTIFICATION HAS CHANGED");
  });

  test("gives first-time host key failures a terminal trust action", () => {
    const message = formatSshBootstrapFailure({
      stage: "health-check",
      label: "ssh tunnel",
      target: "qiangenchao@10.37.112.248",
      output: "Host key verification failed.",
    });

    expect(message).toContain(
      "SSH host key verification failed for qiangenchao@10.37.112.248"
    );
    expect(message).toContain(
      "run ssh qiangenchao@10.37.112.248 once in Terminal"
    );
  });

  test("describes host key impact by bootstrap stage", () => {
    const output = `REMOTE HOST IDENTIFICATION HAS CHANGED!
Offending ECDSA key in /Users/bytedance/.ssh/known_hosts:6`;

    expect(
      formatSshBootstrapFailure({
        stage: "server-start",
        label: "remote server",
        output,
      })
    ).toContain("the remote runtime command was not started");
    expect(
      formatSshBootstrapFailure({
        stage: "health-check",
        label: "ssh tunnel",
        output,
      })
    ).toContain("closed before LLM Space could verify the remote runtime");
  });

  test("keeps generic ssh failures concise", () => {
    const message = formatSshBootstrapFailure({
      stage: "server-start",
      label: "remote server",
      output: "bash: bun: command not found",
    });

    expect(message).toBe(
      "SSH remote runtime bootstrap failed during server-start: remote server exited early. bash: bun: command not found"
    );
  });

  test("classifies missing remote runtime binaries", () => {
    const message = formatSshBootstrapFailure({
      stage: "health-check",
      label: "remote server",
      output:
        "bash: line 1: /home/user/.llm-space/remote-runtime/versions/4.4.6-beta.6/bin/llm-space-server: No such file or directory",
    });

    expect(message).toContain("Remote runtime binary is missing");
    expect(message).toContain(
      "/home/user/.llm-space/remote-runtime/versions/4.4.6-beta.6/bin/llm-space-server"
    );
    expect(message).toContain("literal '~' directory");
    expect(message).not.toContain("will reinstall");
    expect(message).not.toContain("health-check");
  });

  test("parses missing remote runtime binary failures", () => {
    expect(
      parseMissingRuntimeBinaryFailure(
        "bash: line 1: /home/user/.llm-space/remote-runtime/versions/4.4.6-beta.6/bin/llm-space-server: No such file or directory"
      )
    ).toEqual({
      path: "/home/user/.llm-space/remote-runtime/versions/4.4.6-beta.6/bin/llm-space-server",
      reason: "missing",
    });
  });

  test("parses non-executable remote runtime binary failures", () => {
    expect(
      parseMissingRuntimeBinaryFailure(
        "bash: line 1: /home/user/.llm-space/remote-runtime/versions/4.4.6-beta.6/bin/llm-space-server: Permission denied"
      )
    ).toEqual({
      path: "/home/user/.llm-space/remote-runtime/versions/4.4.6-beta.6/bin/llm-space-server",
      reason: "not-executable",
    });
  });

  test("classifies authentication failures", () => {
    const message = formatSshBootstrapFailure({
      stage: "server-install",
      label: "remote server installer",
      target: "user@host1",
      output:
        "user@host1: Permission denied (publickey,password,keyboard-interactive).",
    });

    expect(message).toContain("SSH authentication failed for user@host1");
    expect(message).toContain("~/.ssh/config");
    expect(message).toContain("ssh-agent");
  });

  test("does not classify remote filesystem permission errors as authentication", () => {
    const message = formatSshBootstrapFailure({
      stage: "server-install",
      label: "remote server installer",
      target: "user@host1",
      output: "mkdir: cannot create directory '/opt/llm-space': Permission denied",
    });

    expect(message).not.toContain("SSH authentication failed");
    expect(message).toContain("SSH remote runtime bootstrap failed");
  });
});
