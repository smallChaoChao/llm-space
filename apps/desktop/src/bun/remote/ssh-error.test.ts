import { describe, expect, test } from "bun:test";

import { formatSshBootstrapFailure } from "./ssh-error";

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
    expect(message).toContain("port forwarding was disabled");
    expect(message).not.toContain("REMOTE HOST IDENTIFICATION HAS CHANGED");
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
});
