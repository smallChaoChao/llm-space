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

LLM Space only stores these fields. Put SSH-level options such as port, identity file, jump host, proxy command, and agent behavior in `~/.ssh/config`.

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

## Downloading remote runtime times out

If progress reaches **Downloading remote runtime package** and then fails with a server-install timeout, SSH is already working. The remote Linux machine could not download the `llm-space-server` release archive in time.

Newer LLM Space builds use a two-step install path automatically: first the remote server tries to download the GitHub release archive directly; if that remote download fails, the Desktop app downloads the same archive locally, caches it under the local settings directory, uploads it over SSH to the remote runtime downloads directory, and continues installation from that uploaded archive.

Check from your Mac:

```sh
ssh llm-devbox 'curl -I -L --connect-timeout 15 https://github.com/deer-flow/llm-space/releases/latest'
```

If that hangs or fails but LLM Space still connects successfully, the local download/upload fallback worked.

If the fallback still fails, use the error detail to identify the next boundary: local GitHub download failures require fixing the Desktop machine's network or proxy; upload failures usually mean SSH cannot write to the remote install directory; remote install failures usually mean missing `tar`, low disk space, or permissions under `~/.llm-space/remote-runtime`.
