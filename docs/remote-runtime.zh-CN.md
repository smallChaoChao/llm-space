[English](./remote-runtime.md) | 中文

---

# 通过 SSH 使用 Remote Runtime

Remote Runtime 允许桌面 UI 通过 SSH 连接一台 Linux 机器，并在远端运行 LLM Space runtime。本地桌面负责窗口和交互；远端机器负责该 runtime 的 workspace、模型配置、MCP、tools、skills 和网络访问。

## 推荐的 SSH 配置方式

使用系统 OpenSSH 配置。LLM Space 调用系统 `ssh` 命令，并复用与你在终端里相同的配置文件和行为。

macOS 和 Linux 的标准配置文件是：

```text
~/.ssh/config
```

Windows OpenSSH 的用户配置通常是：

```text
%USERPROFILE%\.ssh\config
```

典型 Host alias 示例：

```sshconfig
Host llm-devbox
  HostName 10.37.112.248
  User qiangenchao
  Port 22
  IdentityFile ~/.ssh/id_ed25519
  # 可选示例：
  # ProxyJump jump-host
  # ForwardAgent yes
```

然后在 LLM Space 里新增 Remote Server：

- **Name**：展示名，例如 `Devbox`
- **Host**：OpenSSH Host alias，例如 `llm-devbox`
- **User**：可选；如果 `~/.ssh/config` 里已经配置 `User`，这里可以留空

LLM Space 只保存这些字段。端口、私钥、跳板机、代理命令、agent 行为等 SSH 层配置，统一写在 `~/.ssh/config`。

## 密码和私钥 passphrase

LLM Space 不保存 SSH 密码，也不保存私钥 passphrase。

如果你的 SSH 需要认证，请使用 OpenSSH 的标准机制：ssh-agent、macOS Keychain，或系统密码/passphrase 弹窗。最简单的检查方式是：

```sh
ssh llm-devbox
```

如果这个命令在终端里连不上，请先修好 SSH，再回到 LLM Space 连接。

LLM Space 在检测平台和准备 runtime 时可能会调用多次短 `ssh` 命令。为了获得稳定体验，请先确保 `ssh <alias>` 在终端里能稳定连接，最好通过 ssh-agent 或系统 Keychain 完成认证。纯密码连接可能触发多次系统提示。

## 连接进度

点击 Connect 后，LLM Space 会展示关键阶段：

1. 检查 SSH 访问
2. 检测远端平台
3. 准备或下载远端 runtime
4. 启动远端 runtime
5. 建立 SSH tunnel
6. 验证远端 runtime
7. 连接成功

如果连接失败，Remote Servers 页面会保留最后阶段和错误信息，帮助判断失败发生在 SSH 认证、安装、隧道创建，还是 runtime 健康检查。

## Host key 校验失败

OpenSSH 会阻止你连接身份发生变化的主机。如果 LLM Space 报 SSH host key verification failed，不要直接删除 `known_hosts`。

先向基础设施提供方或管理员确认主机身份。确认变更是预期行为之后，再按 OpenSSH 提示更新对应行，例如：

```text
/Users/bytedance/.ssh/known_hosts line 6
```

LLM Space 不提供 “ignore host key” 按钮，因为绕过 host key 校验可能掩盖真实的中间人攻击。

## 下载 remote runtime 超时

如果进度到 **Downloading remote runtime package** 后报 server-install timeout，说明 SSH 已经通了。失败点是远端 Linux 机器没有在限定时间内下载完 `llm-space-server` release 包。

在 Mac 上这样检查远端网络：

```sh
ssh llm-devbox 'curl -I -L --connect-timeout 15 https://github.com/deer-flow/llm-space/releases/latest'
```

如果该命令卡住或失败，需要修远端机器的网络：给远端 shell 配置 `HTTPS_PROXY`/`HTTP_PROXY`，放通 GitHub release 下载，或使用远端能访问的网络/镜像。下载速度取决于远端机器，不取决于运行桌面 app 的 Mac。
