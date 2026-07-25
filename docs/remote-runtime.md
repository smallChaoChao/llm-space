English | [中文](./remote-runtime.zh-CN.md)

---

# Remote Runtime over SSH

Remote Runtime lets the desktop UI connect to a Linux machine over SSH and run the LLM Space runtime there. The desktop keeps the window and interaction; the remote machine owns the workspace, model settings, MCP servers, tools, skills, and network access for that runtime.

## Recommended SSH setup

Use your system OpenSSH configuration. LLM Space calls the `ssh` command and intentionally reuses the same files and behavior as your terminal.

On macOS and Linux, the standard config file is:

```text
~/.ssh/config
```

On Windows with OpenSSH, the user config is usually:

```text
%USERPROFILE%\.ssh\config
```

A typical host alias looks like this:

```sshconfig
Host llm-devbox
  HostName 10.37.112.248
  User qiangenchao
  Port 22
  IdentityFile ~/.ssh/id_ed25519
  # Optional examples:
  # ProxyJump jump-host
  # ForwardAgent yes
```

Then add a Remote Server in LLM Space with:

- **Name**: any display name, for example `Devbox`
- **Host**: the OpenSSH host alias, for example `llm-devbox`
- **User**: optional; leave it empty when `User` is already set in `~/.ssh/config`

Advanced fields are only overrides for special cases. Prefer putting SSH-level options such as port, identity file, jump host, proxy command, and agent behavior in `~/.ssh/config`.

## Passwords and passphrases

LLM Space does not store SSH passwords or private-key passphrases.

If your SSH setup needs authentication, use the normal OpenSSH mechanisms: ssh-agent, macOS Keychain, or your system password/passphrase prompt. A quick check is:

```sh
ssh llm-devbox
```

If that command cannot connect from a terminal, fix SSH first before trying LLM Space.

LLM Space may invoke several short `ssh` commands while detecting the platform and preparing the runtime. For the smoothest experience, make sure `ssh <alias>` connects reliably from a terminal, preferably through ssh-agent or your system keychain. Password-only connections may trigger multiple system prompts.

## Connection progress

During Connect, LLM Space reports the main stages:

1. Checking SSH access
2. Detecting remote platform
3. Preparing or downloading the remote runtime
4. Starting the remote runtime
5. Opening the SSH tunnel
6. Verifying the remote runtime
7. Connected

If the connection fails, the Remote Servers page keeps the last stage and the error message so you can tell whether the failure happened during SSH authentication, install, tunnel creation, or runtime health check.

## Host key verification failures

OpenSSH protects you from connecting to a host whose identity changed. If LLM Space reports an SSH host key verification failure, do not blindly delete `known_hosts`.

First confirm the host identity with your infrastructure provider or administrator. After you know the change is expected, update the line reported by OpenSSH, for example:

```text
/Users/bytedance/.ssh/known_hosts line 6
```

LLM Space does not provide an “ignore host key” button because bypassing host key verification can hide a real man-in-the-middle attack.
