# 改造 LLM Space 支持 SSH Remote Runtime

本 ExecPlan 是一份活文档。进度追踪、意外发现、决策日志 和 成果与复盘 章节必须随工作推进持续更新。

**创建时代码基线：**

- 分支：`feat/support-ssh-remote`
- Commit SHA：`11bc12bf500c95db5fd18082b17ea550f563ba0b`
- 时区：`+08:00`（PRC）
- 提交策略：混合。开发中按里程碑提交；合并前可 squash 为一个语义完整的提交。

## 目标与全局视角

完成后，用户可以在本地安装并打开 LLM Space Desktop，使用本地 React UI 连接一台 Linux 服务器；LLM Space 在远端服务器上运行模型调用、agent streaming、MCP、built-in tools、skills、搜索工具和远程 workspace 文件读写。本地机器只负责窗口、交互、设置入口和 SSH bootstrap；远端运行一个 headless `llm-space-server` 进程，提供 LLM Space Runtime RPC。

用户可观察行为是：在 Desktop 设置页添加 SSH 服务器，点击 Connect 后，应用自动检测远端平台、安装或复用匹配版本的 server、启动远端 server、建立 SSH tunnel，并在本地 UI 中打开远程 workspace。用户不连接远程时，现有本地安装、本地 workspace、本地模型配置、本地 MCP、本地 tools、本地打包和 release 流程保持不变。

**需求对齐记录**（Phase 0 产出）：

- 用户原始需求：改造当前仓库，支持通过 SSH 连接远程服务器；使用本地 LLM Space UI，远程使用服务端服务；希望输出完整改造方案。
- Agent 理解：这是一个 Remote Runtime 功能，不是简单 SSH 文件浏览器。正确架构是本地 Desktop 保留 UI 和连接管理，远端单独打包 headless server；客户端通过 SSH 完成安装、启动和隧道，业务协议通过 Runtime RPC 承载。
- 已确认的边界：
  - 做：设计 runtime 抽象、headless server、远程协议、SSH bootstrap、远程设置 UI、打包发布、验证和迁移计划。
  - 不做：不在本计划第一版承诺公网多用户 server、完整 IDE、远程桌面、VS Code 级 extension host、Windows 远端 server、Kubernetes/Docker runtime、跨用户权限模型。
- 关键澄清问答：
  - Q: 是否必须新增服务端包？ → A: 是。Desktop/Electrobun 包不适合在无 GUI Linux 服务器上作为 runtime 运行。
  - Q: 是否影响正常安装使用？ → A: 正确实现下不应影响。默认 runtime 仍是 `local`，远程功能隐藏在显式入口和 feature flag 后。
  - Q: Linux 本地能否直接打 macOS DMG？ → A: 不能。macOS DMG 继续由 macOS 本机或 release CI 的 macOS runner 产出。
  - Q: 改造成本多大？ → A: MVP 约 3-5 周；可产品化发版约 6-10 周；稳定商业体验约 3 个月以上。

## 进度追踪

- [x] (2026-07-19 10:49:54+08:00) Phase 0: 需求对齐完成
- [x] (2026-07-19 10:49:54+08:00) Phase 1: 探索调研完成，确认当前仓库已有 HostServices、Electrobun RPC、StreamThreadController、ModelManager、McpManager、ToolRegistry、LocalFileSystem 等可抽象边界
- [x] (2026-07-19 10:49:54+08:00) Phase 2: 方案撰写完成
- [x] (2026-07-19 10:54:31+08:00) Phase 3: 用户 Review 通过
- [x] (2026-07-19 10:59:20+08:00) Milestone 1: 定义 Runtime 契约并接入 LocalRuntime，默认本地行为不变
- [x] (2026-07-19 11:19:28+08:00) Milestone 2: 抽离可复用 runtime 模块，为 Desktop 和 Server 共享
- [x] (2026-07-19 12:29:34+08:00) Milestone 3: 新增 headless `apps/server` 和 Runtime RPC 协议
- [x] (2026-07-20 11:45:00+08:00) Milestone 4: Desktop 接入 RemoteRuntimeClient，支持手动 URL/token 远程闭环（代码与 RemoteRuntimeClient smoke test 完成；完整 Desktop UI 手动验收待用户本机运行）
- [x] (2026-07-20 18:15:00+08:00) Milestone 5: 新增 SSH bootstrap、server 安装、启动、tunnel 管理（环境变量驱动，要求远端已有源码和依赖；真实 SSH 人工验收待用户环境执行）
- [ ] (2026-07-19 10:49:54+08:00) Milestone 6: Runtime-aware UI 与设置页，支持远程服务器管理和 workspace 绑定
- [ ] (2026-07-19 10:49:54+08:00) Milestone 7: 补齐 MCP、built-in tools、skills、search、network、trace 的远程能力
- [ ] (2026-07-19 10:49:54+08:00) Milestone 8: 打包、release CI、server 版本兼容和自动升级
- [ ] (2026-07-19 10:49:54+08:00) Milestone 9: 文档更新、用户指南和故障排查
- [ ] (2026-07-19 10:49:54+08:00) Phase 4.5: 独立代码审计
- [ ] (2026-07-19 10:49:54+08:00) Phase 5: 结果汇报
- [ ] (2026-07-19 10:49:54+08:00) Phase 7: 代码提交/PR 合并

## 意外发现

- 观察：当前 `packages/core/src/client/transport.ts` 已经有 HTTP SSE transport 抽象，说明 agent streaming 的前端侧并不天然绑定 Electrobun。
  证据：`AgentTransport` 是 `(request, options) => AsyncIterable<AgentEvent>`，`createHttpTransport()` 用 `fetch` + SSE，Desktop 当前另有 `apps/desktop/src/client/rpc-transport.ts` 用 Electrobun 消息模拟 stream。

- 观察：当前 Desktop bun 进程的对象图集中在 `apps/desktop/src/bun/app/start-desktop-app.ts`，这对本地 composition 清晰，但也说明 runtime 能力目前和 Desktop 应用目录耦合。
  证据：该文件直接 new `NetworkSettingsManager`、`McpManager`、`ModelManager`、`SearchSettingsManager`、`SkillsManager`、`StreamThreadController`、`DesktopHost`，并把它们传入 `createMainWindowRPC()`。

- 观察：当前 RPC contract 同时包含模型、文件系统、MCP、tools、skills、search、network、trace、窗口、更新、GitHub auth 等能力；其中只有一部分属于 runtime，另一部分属于 Desktop shell。
  证据：`apps/desktop/src/shared/rpc.ts` 中 `fs*`、`mcp*`、`builtIn*`、`availableModels`、`skills*`、`getSearchSettings` 属于 runtime；`toggleMaximized`、`isFullScreen`、`fsReveal`、`updateStatusChanged`、`executeCommand` 属于本地 shell。

- 观察：Milestone 2 迁移后，`packages/runtime` 已能独立 typecheck，且没有 `electrobun`、`react`、`@llm-space/ui`、`@/`、`apps/desktop/src` import。
  证据：新增 `packages/runtime` workspace；`bun run typecheck` 通过；`rg` 检查禁止 import 无匹配。

- 观察：`mise run build:canary` 曾在 Electrobun CLI 下载阶段因 GitHub 网络超时失败；用户手动重跑后成功。
  证据：失败时 `mise run build:canary` 已输出 Vite `✓ built`，随后下载 electrobun CLI 超时；用户手动重跑后，`apps/desktop/artifacts/` 出现 canary linux x64 安装产物和 update.json。

- 观察：Milestone 3 在沙箱内直接监听 `127.0.0.1` 会因权限/隔离表现为 `EADDRINUSE`，使用 escalated 权限启动本机 loopback server 后成功。
  证据：普通 `bun --filter @llm-space/server dev -- --host 127.0.0.1 --port 39123 ...` 返回 `Failed to start server. Is port 39123 in use?`；escalated 后输出 `llm-space-server listening on http://127.0.0.1:39123`。

- 观察：Milestone 3 已完成本机 headless server smoke test。
  证据：`/health` 带 token 返回 HTTP 200 和 `protocolVersion: 1`；无 token 返回 HTTP 401；`/rpc fs.mkdir` 创建 `/tmp/llm-space-server-test/workspace/demo`；`/rpc fs.write` + `fs.read` 读回 `Remote runtime smoke test`。

- 观察：Milestone 4 已实现 Desktop bun 侧 RemoteRuntimeClient，并通过真实 `apps/server` 完成 HTTP/RPC smoke test。
  证据：启动 server 到 `127.0.0.1:39124` 后，`bun -e` 直接 import `apps/desktop/src/bun/remote/remote-runtime-client.ts`，成功 `connect()`，`info()` 返回 `remote:manual`，`fsMkdir`、`fsWrite`、`fsRead` 在 `/tmp/llm-space-server-test/workspace` 读写成功。

- 观察：Milestone 4 尚未完成完整 Desktop GUI 手动验收。
  证据：当前验证覆盖了 RemoteRuntimeClient 真实 server 交互、typecheck/test/lint，但未在 Electrobun UI 中执行“New Thread -> auto save -> 远端 workspace 文件出现”的人工流程。该项需要用户本机启动 server + Desktop 后确认。

- 观察：当前受限执行环境不允许普通 sandbox 测试监听 `127.0.0.1`，`findFreePort()` 单测不能要求真实 listen/re-listen。
  证据：`port.test.ts` 初版调用 `net.listen(0, "127.0.0.1")` 失败，错误为 `Failed to listen at 127.0.0.1`；已改为函数在 listen 失败时返回高位候选端口，并把单测收缩为“返回合法 TCP port candidate”。真实 Desktop 环境仍应通过 health check 验证 tunnel 是否实际可用。

- 观察：Milestone 5 已实现 SSH bootstrap 的配置解析、命令构造、进程管理、端口选择、远端 server 启动和 tunnel health-check 编排。
  证据：新增 `ssh-bootstrap-config.ts`、`ssh-command.ts`、`port.ts`、`process-utils.ts`、`ssh-remote-runtime.ts` 及对应单测；`registerConfiguredRemoteRuntime()` 同时支持 `LLM_SPACE_REMOTE_BOOTSTRAP=ssh` 和 Milestone 4 的手动 URL/token 模式。

## 决策日志

- 观察：当前开发环境起初没有 `node_modules`，直接运行 `bun run typecheck` 失败，错误是 `tsc: command not found`。沙箱内 `bun install` 因网络连接失败无法下载依赖；经用户已批准的 escalated `bun install` 后依赖安装成功。
  证据：首次 `bun run typecheck` 返回 `/usr/bin/bash: line 1: tsc: command not found`；随后 `bun install` 在沙箱内大量 `ConnectionRefused`；escalated `bun install` 成功安装 3281 packages。

- 观察：Milestone 1 已在 Desktop bun 侧落地 `RuntimeClient`、`LocalRuntimeClient`、`RuntimeRouter`，但尚未抽到 `packages/runtime`。
  证据：新增 `apps/desktop/src/bun/runtime/*` 和 `apps/desktop/src/shared/runtime.ts`；`createMainWindowRPC()` 的 runtime 能力通过 `runtimeRouter.get(runtimeId)` 调用；renderer 侧 `createRpcTransport()` 与 `LocalFileSystemClient` 默认传 `runtimeId: "local"`。

- 决策：功能命名和架构抽象使用 `Runtime` / `Remote Runtime`，不要把核心抽象命名为 `SshClient`。
  理由：SSH 只是第一种连接方式。未来可能接 Docker、Kubernetes、本地 daemon 或 hosted runtime。以 SSH 为中心会把业务能力和传输层耦死。
  日期/作者：2026-07-19 / Codex

- 决策：新增 headless `@llm-space/server` 包，而不是把 Desktop/Electrobun 包传到服务器运行。
  理由：服务器通常无 GUI，不需要 Electrobun、React renderer、auto-update UI、native window。服务端只需要 Bun runtime、RPC server、agent、models、MCP、tools、storage。单独包可以降低体积、依赖、签名和启动复杂度。
  日期/作者：2026-07-19 / Codex

- 决策：远端 server 默认只监听 `127.0.0.1`，通过 SSH tunnel 暴露给本地；业务请求再加一次 bearer token。
  理由：该服务具有读写文件、执行工具、调用模型、管理密钥的能力，不能默认暴露公网。SSH tunnel 复用用户已有 SSH 安全边界，token 防止本机其他进程误连隧道端口。
  日期/作者：2026-07-19 / Codex

- 决策：Milestone 5 的 `findFreePort()` 在受限环境 listen 失败时返回高位候选端口，最终可用性由 tunnel `/health` 校验决定。
  理由：Codex/CI 等受限环境可能禁止监听 loopback，不能让单测依赖真实 socket bind；生产路径仍会在 `ssh -L` 和 `/health` 阶段验证端口是否实际可用，失败会报 `tunnel-start` 或 `health-check`。
  日期/作者：2026-07-20 / Codex

- 决策：Milestone 5 统一入口为 `registerConfiguredRemoteRuntime()`，优先处理 SSH bootstrap，未设置 SSH 时保留手动 URL/token 模式。
  理由：Milestone 4 的手动闭环仍是重要 fallback；SSH bootstrap 是连接层增强，不应删除已有调试路径。
  日期/作者：2026-07-20 / Codex

- 决策：Milestone 3 使用 `LLM_SPACE_HOME` 指向 server home，不在本阶段改造所有 manager 构造参数。
  理由：当前目标是验证单进程 headless server 闭环；设置 `process.env.LLM_SPACE_HOME` 可复用现有 settings/workspace 路径体系，避免在 Milestone 3 扩大改造面。
  日期/作者：2026-07-19 / Codex

- 决策：Milestone 3 的 `--token` 必填，所有 endpoint 包括 `/health` 都要求 bearer token。
  理由：server 拥有文件读写、工具执行和模型调用能力；即使当前只绑定 loopback，也不建立无鉴权默认路径。
  日期/作者：2026-07-19 / Codex

- 决策：Milestone 2 将 `SkillsManager` 迁入 `packages/runtime`，但 Desktop seed markdown 和 `seed.ts` 保留在 Desktop。
  理由：server 需要可复用技能配置/发现逻辑，但 Desktop bundled seed assets 的打包规则与 headless server 不同；本里程碑先保持 seed 资产归属不变，避免扩大包装范围。
  日期/作者：2026-07-19 / Codex

- 决策：Milestone 2 将 built-in file tools 的 native open/reveal 改为依赖注入。
  理由：`packages/runtime` 不能依赖 Desktop native shell；Desktop 注入 `openPath` / `revealInFileManager`，未来 server 可以不注入或注入 no-op。
  日期/作者：2026-07-19 / Codex

- 决策：Milestone 1 先在 `apps/desktop/src/bun/runtime` 落地 runtime 契约，不立即创建 `packages/runtime`。
  理由：当前目标是先让本地 RPC 通过 RuntimeRouter 路由且行为不变；直接移动 managers 到 workspace package 会显著扩大 diff 和回归面，应留到 Milestone 2。
  日期/作者：2026-07-19 / Codex

- 决策：第一阶段先做手动 URL/token 远程闭环，再做自动 SSH bootstrap。
  理由：Remote Runtime 的核心风险在 runtime contract 和 streaming 协议。先绕过 SSH 自动安装，可用更少变量验证架构；SSH bootstrap 另行推进，降低调试复杂度。
  日期/作者：2026-07-19 / Codex

- 决策：远端 settings 默认独立存放到 `~/.llm-space-server`，不默认复用远端 `~/.llm-space`。
  理由：Desktop 数据目录和 headless server 数据目录生命周期不同。复用会增加配置污染和未来迁移风险。用户需要时可以显式指定 `--home`。
  日期/作者：2026-07-19 / Codex

## 成果与复盘

Milestone 1 已完成：新增本地 Runtime 抽象和路由，现有 Desktop renderer 到 bun 的 runtime 能力可以携带可选 `runtimeId`，缺省仍为 `local`。本阶段未引入远程 server，也未改变用户可见入口。

### 完成汇报（Phase 5 产出）

**目标达成**：待填写。

**变更概览**：待填写。

**验收结果**：待填写。

**已知风险/遗留**：待填写。

**建议后续**：待填写。

## 上下文与方向

LLM Space 是一个 Bun workspace monorepo。核心工作区是 `packages/*` 和 `apps/*`。桌面应用是 `apps/desktop`，静态站点是 `apps/web`，共享领域库是 `packages/core`，共享 React UI 是 `packages/ui`。

当前桌面应用是 Electrobun 应用，不是普通网站。`apps/desktop/src/mainview/main.tsx` 挂载 React UI；`apps/desktop/src/bun/` 是 Bun 主进程，负责窗口、菜单、文件系统、模型配置、MCP、agent streaming、GitHub auth、更新等。renderer 和 bun 主进程通过 `apps/desktop/src/shared/rpc.ts` 定义的 Electrobun RPC 通信。

当前 Thread Playground 的运行入口由 `packages/ui` 的 `HostServices` seam 注入。`apps/desktop/src/host/host-services.tsx` 当前提供一个 module-level `transport = createRpcTransport()`，模型客户端 `createElectrobunModelClient()` 直接调用 Electrobun RPC。`apps/desktop/src/client/local-file-system.ts` 提供 `LocalFileSystemClient`，也是直接调用 `fs*` Electrobun RPC。换言之，当前 UI 已经基本不直接 import bun 主进程能力，但 renderer client 到 bun RPC 的能力还默认认为 runtime 是本地。

当前 agent streaming 的本地链路是：

```text
ThreadPlayground / Zustand run()
  -> @llm-space/core/client streamThread()
  -> AgentTransport
  -> apps/desktop/src/client/rpc-transport.ts
  -> electrobun.rpc sendStreamThreadRequest
  -> apps/desktop/src/bun/streaming/StreamThreadController.run()
  -> @llm-space/core/server streamAgent()
  -> receiveStreamThreadResponse messages
  -> reduceMessages()
  -> UI rerender
```

当前文件系统链路是：

```text
FileSystemTree / ThreadTabs
  -> LocalFileSystemClient
  -> electrobun.rpc request fsLs/fsRead/fsWrite/...
  -> createMainWindowRPC handlers
  -> LocalFileSystem under ~/.llm-space/workspace
```

本计划中的术语定义：

- Runtime：LLM Space 的执行环境，拥有 workspace、模型配置、MCP、tools、skills、agent streaming 等能力。本地 runtime 是当前 bun 主进程；远程 runtime 是未来的 `llm-space-server`。
- Remote Runtime：运行在远端 Linux 服务器的 Runtime，通过 Runtime RPC 提供能力。
- SSH bootstrap：本地 Desktop 使用用户 SSH 配置连接远端、检测平台、安装 server、启动 server、建立隧道的过程。
- Runtime RPC：Desktop 和 `llm-space-server` 之间的业务协议。它不是 Electrobun RPC；Electrobun RPC 只保留为 renderer 到本地 bun 主进程的桌面内部协议。
- RuntimeId：标识 runtime 的稳定 id。建议类型为 `"local" | \\`remote:${string}\\``。

## 工作计划

第一步先引入 Runtime 契约，保证本地行为不变。新增 `RuntimeClient`、`RuntimeId`、`RuntimeInfo`、`RuntimeCapabilities` 等类型，位置建议在新包 `packages/runtime` 或先在 `apps/desktop/src/bun/runtime` 内落地。为了长期复用，本计划推荐新增 `packages/runtime`，但第一阶段可以只抽 contract，不立即移动所有 manager。`LocalRuntimeClient` 包装现有 `ModelManager`、`McpManager`、`StreamThreadController`、`ToolRegistry`、`LocalFileSystem`、`SkillsManager`、`SearchSettingsManager`、`NetworkSettingsManager`。`createMainWindowRPC()` 不再直接调用每个 manager，而是通过 `RuntimeRouter` 找到 `local` runtime 调用。所有旧 RPC 入参在未传 `runtimeId` 时默认 `local`。

第二步抽离 server 可复用代码。把 `apps/desktop/src/bun/models`、`mcp`、`streaming`、`tools`、`skills`、`search`、`network` 中不依赖 Electrobun 的部分迁到 `packages/runtime/src/`。Desktop 只保留 window/menu/update/deep-link/GitHub auth/native reveal 等 shell 能力。迁移时保持导出兼容，减少一次性 diff：Desktop 内可以先建立 re-export wrapper，再逐步替换 import。

第三步新增 headless server app。新增 `apps/server/package.json`、`apps/server/src/index.ts`、`apps/server/src/http-server.ts`、`apps/server/src/runtime-rpc.ts`。server 启动时解析 `--host`、`--port`、`--token`、`--home`，默认 host 为 `127.0.0.1`，默认 home 为 `~/.llm-space-server`。server 复用 `packages/runtime` 创建 runtime object graph，对外提供 `/health`、`/rpc` 和 `/stream`。`/health` 返回版本、commit、protocolVersion、capabilities、homePath、workspacePath。`/rpc` 承载普通 request/response，`/stream` 承载 agent streaming。streaming 可选 WebSocket 或 SSE；若想复用 `createHttpTransport()`，第一版优先 SSE。但由于需要显式 abort 和多流复用，产品化版本建议 WebSocket。

第四步 Desktop 接入 RemoteRuntimeClient，但先不自动 SSH。新增 `apps/desktop/src/bun/remote/remote-runtime-client.ts`，它通过 `http://127.0.0.1:<port>` 调 server 的 `/rpc` 和 `/stream`。新增内部开发入口，允许用户或开发者填写 Remote URL + token。完成后可以手动在服务器启动 `llm-space-server`，手动建立 `ssh -L`，本地 UI 使用远端 runtime 读写文件并跑 agent。

第五步实现 SSH bootstrap。新增 `RemoteConnectionManager`，通过本地 `ssh` 命令而非自行实现 SSH 协议。它读取用户配置，执行远端 `uname -s`、`uname -m`、`command -v bun` 或直接上传自包含 server bundle，选择匹配 `linux-x64` 或 `linux-arm64` 的 server 包，上传到 `~/.llm-space-server/bin/<version>/`，启动 server，生成 token，建立本地随机端口到远端 `127.0.0.1:<remotePort>` 的 tunnel，并维护进程生命周期。支持断开、重连、日志收集和健康检查。第一版只支持 OpenSSH 标准配置和 key/ssh-agent；password/passphrase UI 可以后置。

第六步做 runtime-aware UI。设置页新增 Remote Servers tab；用户可以添加、编辑、删除、连接、断开服务器。workspace/thread 与 runtime 绑定。旧 thread 没有 runtime 字段时默认 `local`。文件树、模型设置、MCP 设置、tools、skills、search/network 设置需要显示当前 runtime，避免用户不知道配置作用于本地还是远端。第一版可用全局 active runtime 简化；长期版本应 per workspace/per tab。

第七步补齐能力并收口安全。MCP stdio 在远端执行，remote MCP URL 从远端访问；built-in tools 使用远端 workspace root；skills 读取远端 home/settings；search/network settings 作用于远端 server 的 outbound fetch；trace 是否本地或远端需要明确，建议 remote thread 的 trace 由远端产生再返回本地 UI。所有远程请求要求 bearer token，server 拒绝非 loopback bind，除非用户显式 `--host 0.0.0.0 --i-know-this-is-dangerous`，该能力可以第一版不提供。

第八步补齐打包发布。保留 `mise run pack` 语义不变，只打 Desktop。新增 `mise run build:server`、`mise run pack:server`、`mise run pack:server:linux-x64`、`mise run pack:server:linux-arm64`。release CI 在现有 macOS Desktop DMG 之外上传 server tarball。Desktop 连接远端时按 server version/protocolVersion/capabilities 检查兼容性，不兼容则自动上传当前 bundled server 包或提示升级。

第九步更新文档和故障排查。更新 AGENTS 或项目文档中的架构、Tooling、Releases、Remote Runtime 使用指南、安全模型、server 包发布说明、SSH 故障排查。文档更新放在功能里程碑之后，避免中间态文档失真。

### Milestone 1: 定义 Runtime 契约并接入 LocalRuntime

**范围**：新增 runtime 类型和 local runtime wrapper，Desktop RPC 默认仍走本地 runtime。

**成果**：存在 `RuntimeClient` / `RuntimeRouter` / `LocalRuntimeClient`，但用户不开远程功能时所有行为等价。

**命令**：

```sh
mise run test
mise run typecheck
```

**验收**（刚性量化指标）：

- `mise run test` 全部 PASS，0 skipped。
- `mise run typecheck` 零错误。
- `fsLs/fsRead/fsWrite` 在未传 `runtimeId` 时仍访问 `~/.llm-space/workspace`。
- `availableModels`、`mcpListServers`、`builtInListTools` 未传 `runtimeId` 时返回本地配置。

### Milestone 2: 抽离可复用 runtime 模块

**范围**：把不依赖 Electrobun 的 runtime 能力从 `apps/desktop/src/bun` 抽到 `packages/runtime/src`，Desktop 通过 package import 使用。

**成果**：`packages/runtime` 提供 model、mcp、streaming、tools、skills、search、network、storage composition。Desktop 目录只保留 shell 相关逻辑和少量 wrapper。

**命令**：

```sh
mise run test
mise run typecheck
mise run build:canary
```

**验收**：

- `mise run test` 全部 PASS，0 skipped。
- `mise run typecheck` 零错误。
- `mise run build:canary` 成功产出 Desktop build。
- `apps/desktop/src/bun/app/start-desktop-app.ts` 不再直接 import 被迁移的 manager 实现文件，只通过 `@llm-space/runtime` 或本地 wrapper import。

### Milestone 3: 新增 headless server 和 Runtime RPC

**范围**：新增 `apps/server`，提供 `/health`、`/rpc`、`/stream`，复用 runtime object graph。

**成果**：可以在本机启动 `llm-space-server`，用 curl 调 `/health`，用测试调用 fs/model/stream 能力。

**命令**：

```sh
bun --filter @llm-space/server dev -- --host 127.0.0.1 --port 39123 --token test-token --home /tmp/llm-space-server-test
curl -fsS -H 'Authorization: Bearer test-token' http://127.0.0.1:39123/health
bun test apps/server
mise run typecheck
```

**验收**：

- `/health` 返回 HTTP 200，body 包含 `ok: true`、`protocolVersion`、`version`、`capabilities`。
- 缺失或错误 token 的 `/rpc` 返回 HTTP 401。
- server 只监听传入 host；默认 host 为 `127.0.0.1`。
- `bun test apps/server` 全部 PASS，0 skipped。
- `mise run typecheck` 零错误。

### Milestone 4: Desktop 手动远程闭环

**范围**：新增 `RemoteRuntimeClient`，通过手动配置 URL/token 连接 server；先不做 SSH 自动安装。

**成果**：开发者可手动启动 server 和 SSH tunnel，本地 Desktop 使用远端 workspace 进行文件读写和 agent streaming。

**命令**：

```sh
# terminal A: 远端或本机模拟 server
bun --filter @llm-space/server dev -- --host 127.0.0.1 --port 39123 --token test-token --home /tmp/llm-space-server-test

# terminal B: 本地 Desktop
LLM_SPACE_ENABLE_REMOTE_RUNTIME=1 mise run dev

mise run test
mise run typecheck
```

**验收**：

- Desktop 可添加 Remote URL `http://127.0.0.1:39123` 和 token。
- 文件树显示的是 server home 下的 workspace，不是本地 `~/.llm-space/workspace`。
- 新建或保存 thread 后，文件出现在 server home workspace 下。
- agent run 的模型调用发生在 server 进程，Desktop 本地 `StreamThreadController` 不参与该 run。
- 不设置 `LLM_SPACE_ENABLE_REMOTE_RUNTIME` 时 UI 不出现远程入口，本地功能不变。

### Milestone 5: SSH bootstrap、安装、启动和 tunnel

**范围**：Desktop bun 进程新增 SSH 连接管理。通过 OpenSSH 命令检测远端平台、上传 server 包、启动 server、建立 tunnel。

**成果**：用户输入 SSH host/user/key 后，点击 Connect 即可建立 Remote Runtime。

**命令**：

```sh
mise run test
mise run typecheck
# 需要一台测试 Linux 服务器或本机 sshd：
LLM_SPACE_ENABLE_REMOTE_RUNTIME=1 mise run dev
```

**验收**：

- 对 linux-x64 服务器，能安装 `llm-space-server-<version>-linux-x64` 到 `~/.llm-space-server/bin/<version>/`。
- 对 linux-arm64 服务器，能选择 `linux-arm64` 包；无匹配包时给出明确错误。
- server 远端监听 `127.0.0.1:<remotePort>`，本地 tunnel 监听 `127.0.0.1:<localPort>`。
- 连接成功后 `/health` 通过 tunnel 返回 HTTP 200。
- Disconnect 后本地 ssh/tunnel 进程退出，server 进程按策略退出或保留，策略必须在 UI 中明确。
- SSH 失败时错误信息包含阶段：`detect-platform` / `upload-server` / `start-server` / `open-tunnel` / `health-check`。

### Milestone 6: Runtime-aware UI 与设置页

**范围**：新增 Remote Servers 设置页，workspace/thread runtime 绑定，模型/MCP/tools/skills/search/network 设置显示当前 runtime。

**成果**：用户能区分本地和远程配置；旧数据默认 local；可以同时保留多个 remote server 配置。

**命令**：

```sh
mise run test
mise run typecheck
mise run lint
```

**验收**：

- 旧 thread JSON 无 `runtimeId` 时被 normalize 为 `local`。
- 新 thread 可保存 runtime 绑定；重新打开后绑定不丢失。
- Settings 中 Remote Servers 可增删改查，敏感字段不以明文写入普通 JSON。
- Model/MCP 页面显示当前 runtime 名称，例如 `Runtime: Local` 或 `Runtime: my-linux-server`。
- `mise run lint` 零告警。

### Milestone 7: 补齐 MCP、tools、skills、search、network、trace 的远程能力

**范围**：让 remote runtime 对齐本地 runtime 的关键能力。MCP stdio 在远端执行；built-in tools 使用远端 workspace；skills/search/network 设置归属远端。

**成果**：远程 thread 中 tool call 实际在远端执行，路径和环境变量来自远端。

**命令**：

```sh
mise run test
mise run typecheck
# 若新增集成测试：
bun test apps/server packages/runtime apps/desktop/src/bun/remote
```

**验收**：

- 远程 MCP stdio server 的进程在远端 server 机器上启动。
- 远程 built-in file/web/skill tools 返回的路径和结果基于远端 workspace。
- 远程 search/network settings 写入 `~/.llm-space-server/settings`，不修改本地 `~/.llm-space/settings`。
- 本地 runtime 的 MCP/tools/skills/search/network 行为不变。
- 新增测试全部 PASS，0 skipped。

### Milestone 8: 打包、release CI、server 版本兼容和自动升级

**范围**：新增 server 打包命令、产物命名、release 上传；Desktop 连接时校验 server 版本和协议，必要时自动升级。

**成果**：发布后包含 Desktop 包和 server 包；Desktop 可将匹配 server 包安装到远端。

**命令**：

```sh
mise tasks ls
mise run pack
mise run pack:server
mise run typecheck
```

**验收**：

- `mise run pack` 语义不变，只产出 Desktop 本地包。
- `mise run pack:server` 产出至少当前平台 server tarball。
- CI matrix 产出 `llm-space-server-<version>-linux-x64.tar.gz` 和 `llm-space-server-<version>-linux-arm64.tar.gz`。
- Desktop 连接 protocolVersion 不兼容的 server 时拒绝使用，并提示升级。
- Desktop 自动升级 server 时保留远端 `settings/` 和 `workspace/`。

### Milestone 9: 文档更新

**范围**：更新受本次改动影响的仓库文档。

**成果**：架构、Tooling、Release、Remote Runtime 用户指南、故障排查都可从仓库文档中找到。

**命令**：

```sh
mise run lint
mise run typecheck
```

**验收**：

- `AGENTS.md` 或项目文档包含 Remote Runtime 架构说明。
- Tooling 文档包含 `build:server` / `pack:server` / release server artifacts。
- 用户指南包含 SSH 配置、连接、断开、日志、常见错误。
- 安全文档说明 server 默认 loopback + SSH tunnel + token。
- `mise run lint` 和 `mise run typecheck` 仍通过。

## 具体步骤

以下命令均在仓库根目录 `/data00/home/qiangenchao/ai_projects/llm-space` 执行。

1. 记录基线并确认工作树状态：

```sh
git status --short
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
```

预期输出：分支为 `feat/support-ssh-remote`；SHA 与本计划头部一致或记录新的变更；工作树如有用户既有改动，不得回滚。

2. 新建 runtime contract：

```sh
mkdir -p packages/runtime/src
```

新增文件建议：

```text
packages/runtime/package.json
packages/runtime/tsconfig.json
packages/runtime/src/index.ts
packages/runtime/src/types.ts
packages/runtime/src/local-runtime-client.ts
packages/runtime/src/runtime-router.ts
packages/runtime/src/protocol.ts
```

预期输出：`@llm-space/runtime` 可被 root tsconfig typecheck。

3. 接入 Desktop local runtime：

编辑：

```text
apps/desktop/src/bun/app/start-desktop-app.ts
apps/desktop/src/bun/rpc/index.ts
apps/desktop/src/shared/rpc.ts
apps/desktop/src/client/local-file-system.ts
apps/desktop/src/client/rpc-transport.ts
apps/desktop/src/host/host-services.tsx
```

预期结果：不使用远程功能时，Desktop 仍通过 `local` runtime 调用原有 managers。

4. 抽离 runtime 模块：

移动或包装：

```text
apps/desktop/src/bun/models -> packages/runtime/src/models
apps/desktop/src/bun/mcp -> packages/runtime/src/mcp
apps/desktop/src/bun/streaming -> packages/runtime/src/streaming
apps/desktop/src/bun/tools -> packages/runtime/src/tools
apps/desktop/src/bun/skills -> packages/runtime/src/skills
apps/desktop/src/bun/search -> packages/runtime/src/search
apps/desktop/src/bun/network -> packages/runtime/src/network
```

预期结果：Desktop import 更新为 `@llm-space/runtime`；Electrobun-specific 代码不进入 `packages/runtime`。

5. 新建 server app：

```sh
mkdir -p apps/server/src
```

新增：

```text
apps/server/package.json
apps/server/tsconfig.json
apps/server/src/index.ts
apps/server/src/http-server.ts
apps/server/src/auth.ts
apps/server/src/rpc.ts
apps/server/src/stream.ts
```

预期结果：`bun --filter @llm-space/server dev -- --host 127.0.0.1 --port 39123 --token test-token --home /tmp/llm-space-server-test` 可启动。

6. 新增 Desktop remote client 和连接管理：

```text
apps/desktop/src/bun/remote/remote-runtime-client.ts
apps/desktop/src/bun/remote/remote-connection-manager.ts
apps/desktop/src/bun/remote/ssh-process.ts
apps/desktop/src/bun/remote/server-bootstrap.ts
apps/desktop/src/bun/remote/remote-server-settings.ts
```

预期结果：本地 bun 主进程可管理 remote runtime 连接状态，renderer 通过现有 Electrobun RPC 获取状态和触发连接。

7. 新增 UI：

```text
apps/desktop/src/components/settings/remote-servers-page.tsx
apps/desktop/src/client/remote-servers.ts
```

修改：

```text
apps/desktop/src/components/settings/settings-dialog.tsx
apps/desktop/src/shared/commands.ts
apps/desktop/src/host/host-services.tsx
```

预期结果：Settings 出现 Remote Servers tab；feature flag 关闭时隐藏。

8. 新增打包命令：

修改：

```text
package.json
mise.toml
.github/workflows/release.yml
.github/workflows/ci.yml
```

预期结果：`mise tasks ls` 出现 server build/pack 任务；Desktop pack 语义不变。

9. 运行验证：

```sh
mise run test
mise run lint
mise run typecheck
mise run build:canary
mise run pack
mise run pack:server
```

预期输出：全部命令零错误；`pack` 仍产出 Desktop 包；`pack:server` 产出 server tarball。

## 验证与验收

- [ ] 本地回归：`mise run test` 全部 PASS，0 skipped。
- [ ] 类型检查：`mise run typecheck` 零错误。
- [ ] Lint：`mise run lint` 零告警。
- [ ] Desktop 构建：`mise run build:canary` 成功。
- [ ] Desktop 打包兼容：`mise run pack` 成功，且不强制构建 server 包。
- [ ] Server 打包：`mise run pack:server` 成功产出 server tarball。
- [ ] Server health：启动 `llm-space-server --host 127.0.0.1 --port 39123 --token test-token --home /tmp/llm-space-server-test` 后，`curl -fsS -H 'Authorization: Bearer test-token' http://127.0.0.1:39123/health` 返回 HTTP 200 且包含 `ok: true`。
- [ ] Server auth：不带 token 请求 `/rpc` 返回 HTTP 401。
- [ ] 手动远程闭环：通过手动 SSH tunnel 连接 server 后，本地 UI 读写远端 workspace 文件，新增 thread 文件实际出现在远端 home 下。
- [ ] Agent remote execution：远程 thread 的 agent run 由 server 进程执行；关闭本地 Desktop 的 local `StreamThreadController` 不影响远程 run，或测试中能通过日志明确看到远端收到 stream request。
- [ ] MCP remote execution：远程 runtime 下新增 stdio MCP 后，MCP server 进程在远端机器运行。
- [ ] 旧数据兼容：旧 thread JSON 无 `runtimeId` 时打开为 local；保存后不破坏现有 thread schema 的必要字段。
- [ ] Feature flag：不设置 `LLM_SPACE_ENABLE_REMOTE_RUNTIME=1` 时，Remote UI 不可见，本地工作流和当前 main 行为一致。

## 文档更新

需要更新：

- `AGENTS.md` 或项目默认文档：补充 Remote Runtime 架构、server 包、SSH bootstrap、安全模型。
- `mise.toml` 任务说明：新增 `build:server`、`pack:server` 等。
- `package.json` scripts：新增 server build/test/pack 脚本。
- `.github/workflows/ci.yml`：增加 server typecheck/build。
- `.github/workflows/release.yml`：增加 server artifacts 上传。
- 新增 `docs/remote-runtime.md`：用户使用指南，包含添加 SSH server、连接、断开、日志、故障排查。
- 新增 `docs/remote-runtime-security.md` 或并入用户指南：说明 loopback bind、SSH tunnel、bearer token、敏感信息存储。

文档更新必须在功能里程碑完成后进行，避免记录中间态。

## 幂等性与恢复

- Runtime contract 和 wrapper 的新增可重复执行；若中断，先运行 `git status --short` 判断哪些文件已创建，再继续。
- 模块迁移必须避免一次性删除旧路径。优先增加 `packages/runtime` 实现，再在 `apps/desktop/src/bun/*` 留 re-export wrapper；所有 import 更新完成且测试通过后再删除 wrapper。
- Server bootstrap 上传目录包含版本号：`~/.llm-space-server/bin/<version>/`。重复上传同版本应覆盖临时目录后原子 rename，避免半安装目录被使用。
- SSH tunnel 失败时不得删除远端 `workspace/` 和 `settings/`；最多清理本次启动的临时 pid/token/log 文件。
- Server 自动升级必须保留 `~/.llm-space-server/settings`、`workspace`、`logs`。只替换 `bin/<version>`。
- 如果远程协议不兼容，Desktop 必须拒绝继续调用 runtime，并显示升级提示；不得尝试用旧协议继续写文件。
- 回滚路径：禁用 `LLM_SPACE_ENABLE_REMOTE_RUNTIME` 后，所有远程入口隐藏；本地 runtime 继续可用。若某次迁移破坏本地功能，应优先恢复 `local` 默认路径，而不是继续推进远程功能。

## 产物与备注

本计划调研时读取的关键文件：

```text
package.json
mise.toml
apps/desktop/src/shared/rpc.ts
apps/desktop/src/bun/app/start-desktop-app.ts
apps/desktop/src/bun/rpc/index.ts
apps/desktop/src/bun/streaming/stream-thread.ts
apps/desktop/src/client/rpc-transport.ts
apps/desktop/src/client/local-file-system.ts
apps/desktop/src/host/host-services.tsx
packages/core/src/client/transport.ts
packages/core/src/server/index.ts
```

包数量建议：

```text
Desktop:
- macOS arm64 DMG
- macOS x64 DMG
- Linux x64 tar/installer，保持现状

Server:
- llm-space-server-<version>-linux-x64.tar.gz
- llm-space-server-<version>-linux-arm64.tar.gz
```

第一版内部 dogfood 可以只产出当前 Desktop 包 + `linux-x64` server 包。正式远程功能至少应有 `linux-x64` 和 `linux-arm64` server 包。

## 接口与依赖

建议核心类型：

```ts
export type RuntimeId = "local" | `remote:${string}`;

export type RuntimeCapability =
  | "streamThread"
  | "filesystem"
  | "models"
  | "mcp"
  | "builtinTools"
  | "skills"
  | "search"
  | "network"
  | "traces";

export interface RuntimeInfo {
  id: RuntimeId;
  kind: "local" | "remote";
  name: string;
  status: "connected" | "connecting" | "disconnected" | "error";
  capabilities: RuntimeCapability[];
  version: string;
  protocolVersion: number;
  commit?: string;
  platform?: {
    os: "linux" | "darwin" | "windows";
    arch: "x64" | "arm64";
  };
}

export interface RuntimeHealthResponse {
  ok: true;
  version: string;
  commit: string;
  protocolVersion: number;
  capabilities: RuntimeCapability[];
  homePath: string;
  workspacePath: string;
}

export interface RuntimeClient {
  info(): Promise<RuntimeInfo>;

  streamThread(
    request: AgentStreamRequest,
    options: { signal?: AbortSignal }
  ): AsyncIterable<AgentEvent>;

  fsLs(path: string): Promise<FileNode[]>;
  fsMkdir(path: string): Promise<void>;
  fsCp(src: string, dest: string): Promise<void>;
  fsMv(src: string, dest: string): Promise<void>;
  fsRm(path: string): Promise<void>;
  fsRead(path: string): Promise<Thread>;
  fsWrite(path: string, thread: Thread): Promise<void>;

  availableModels(): Promise<ModelProviderGroup[]>;
  builtinProviders(): Promise<ModelProviderGroup[]>;
  getDefaultModel(): Promise<ModelConfig | null>;
  setDefaultModel(model: ModelConfig | null): Promise<ModelConfig | null>;

  mcpListServers(): Promise<McpServerView[]>;
  mcpListTools(serverId: string): Promise<McpServerToolsResponse>;
  mcpCallTool(input: {
    serverId: string;
    toolName: string;
    arguments: Record<string, unknown>;
  }): Promise<McpCallToolResponse>;

  builtInListTools(): Promise<BuiltinTool[]>;
  builtInCallTool(input: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<{ contentText: string }>;
}
```

建议 Runtime RPC envelope：

```ts
export interface RuntimeRpcRequest<TParams = unknown> {
  id: string;
  method: string;
  params: TParams;
}

export type RuntimeRpcResponse<TResult = unknown> =
  | { id: string; ok: true; result: TResult }
  | {
      id: string;
      ok: false;
      error: { code: string; message: string; detail?: unknown };
    };
```

建议 SSH server 配置类型：

```ts
export interface RemoteServerConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  auth:
    | { type: "sshAgent" }
    | { type: "privateKey"; keyPath: string; passphraseKeychainRef?: string }
    | { type: "password"; keychainRef: string };
  remoteHome?: string;
  remoteWorkspace?: string;
}
```

依赖策略：

- SSH 第一版使用系统 `ssh` / `scp` / `sftp` 命令，不引入 JS SSH 库。理由是用户已有 `~/.ssh/config`、ProxyCommand、JumpHost、ssh-agent 行为可复用。
- Runtime HTTP server 优先使用 Bun 内置 `Bun.serve`，避免引入 Express/Hono，除非路由复杂度实际上升。
- Streaming 第一版可选 SSE 以复用 `createHttpTransport()` 心智；产品化建议 WebSocket，因为 abort、多路复用和重连状态更清晰。

## Milestone 1 验证记录

- `bun install`：通过 escalated 网络访问安装依赖，成功安装 3281 packages。
- `node_modules/.bin/prettier --write ...`：格式化本次新增/修改的 runtime、RPC、client、ExecPlan 文件，成功。
- `bun run typecheck`：通过，零错误。
- `bun run test`：74 pass，0 fail，0 skipped。
- `git diff --check`：通过，未发现 whitespace error。

## 后续修复记录（Phase 6）

暂无。

---

[2026-07-19 10:49:54+08:00] 修改说明：创建 SSH Remote Runtime ExecPlan 草案，等待用户 Review。理由：用户要求使用 harness-exec-plan 完整输出改造方案。

---

[2026-07-19 10:59:20+08:00] 修改说明：用户确认计划后，将 ExecPlan 移入 active，并完成 Milestone 1 的本地 Runtime 契约、LocalRuntime 路由和验证记录。理由：按计划开始执行，先保证本地行为不变。

---

## Milestone 2 验证记录

- `bun install`：新增 `@llm-space/runtime` workspace 后刷新 workspace 依赖链接；一次普通沙箱安装因 registry 连接失败，随后 escalated `bun install` 成功。执行过程中 husky 尝试写 `.git/config` 报只读，但依赖解析和 lockfile 更新完成。
- `bun run typecheck`：通过，零错误。
- `bun run test`：74 pass，0 fail，0 skipped。
- `bun run lint`：通过，零错误。
- `rg` 禁止 import 检查：`packages/runtime/src` 中没有 `electrobun`、`react`、`@llm-space/ui`、`@/`、`apps/desktop/src` import。
- `git diff --check`：通过，未发现 whitespace error。
- `mise run build:canary`：用户手动重跑后成功，`apps/desktop/artifacts/` 产出 `canary-linux-x64-LLMSpace-canary-Setup.tar.gz`、`canary-linux-x64-LLMSpace-canary.tar.zst`、`canary-linux-x64-update.json`。

## Milestone 2 细化方案 Review 草案

本节是在 Milestone 1 完成后追加的 Milestone 2 执行方案。目标是在不改变用户可见行为的前提下，把未来 `apps/server` 需要复用的运行时模块从 Desktop 专属目录中解耦出来。用户确认本节后，才开始代码迁移。

### Milestone 2 的目标

Milestone 2 不做远程 server、不做 SSH、不做 UI。它只做结构迁移：让 Desktop 当前依赖的 runtime 能力可以被未来 headless server import。完成后，Desktop 仍然正常启动，`runtimeId` 默认仍是 `local`，所有用户行为不变。

### 当前代码边界观察

当前需要迁移的 runtime 能力主要在：

```text
apps/desktop/src/bun/models
apps/desktop/src/bun/mcp
apps/desktop/src/bun/streaming
apps/desktop/src/bun/tools
apps/desktop/src/bun/skills
apps/desktop/src/bun/search
apps/desktop/src/bun/network
apps/desktop/src/bun/storage
apps/desktop/src/bun/runtime
```

其中大部分模块不依赖 Electrobun，但存在 3 类不同耦合：

1. 纯 runtime，可直接迁移。
   - `models/*`
   - `mcp/*`
   - `streaming/*`
   - `search/*`
   - `network/*`
   - `storage/*`
   - `runtime/*`

2. runtime 逻辑里混入 Desktop shell 能力，需要先切 seam。
   - `tools/built-in/fs.ts` 依赖 `apps/desktop/src/bun/fs` 的 `openPath` / `revealInFileManager`。
   - `tools/built-in/built-in-tools-module.ts` 依赖 `DesktopModule`。
   - `skills/seed.ts` 依赖 `getLlmSpaceHomePath()`，且 seed skills 文件当前放在 Desktop 目录。

3. Desktop shell，暂不迁移。
   - `analytics`
   - `auth`
   - `app/window/menu/update/deep-link`
   - `commands`
   - `fs/trash/reveal/open native file manager`
   - `traces` 第一阶段暂不迁移，等远程 trace 语义确定。

### 推荐迁移策略

采用“新增 package + re-export wrapper + 分批改 import”的低风险策略。

第一步新增 workspace package：

```text
packages/runtime/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── models/
    ├── mcp/
    ├── streaming/
    ├── tools/
    ├── skills/
    ├── search/
    ├── network/
    ├── storage/
    └── runtime/
```

`@llm-space/runtime` 是 Node/Bun-only package，不给 browser/renderer 使用。它可以依赖：

```text
@llm-space/core
@earendil-works/pi-ai
@earendil-works/pi-agent-core
@modelcontextprotocol/sdk
gray-matter
skills-handler
```

它不能依赖：

```text
electrobun
React
@llm-space/ui
apps/desktop/src/*
```

第二步先迁移纯 runtime 模块，不迁移 shell seam：

```text
apps/desktop/src/bun/models      -> packages/runtime/src/models
apps/desktop/src/bun/mcp         -> packages/runtime/src/mcp
apps/desktop/src/bun/streaming   -> packages/runtime/src/streaming
apps/desktop/src/bun/search      -> packages/runtime/src/search
apps/desktop/src/bun/network     -> packages/runtime/src/network
apps/desktop/src/bun/storage     -> packages/runtime/src/storage
apps/desktop/src/bun/runtime     -> packages/runtime/src/runtime
```

Desktop 原路径保留 wrapper，例如：

```ts
// apps/desktop/src/bun/models/index.ts
export { ModelManager } from "@llm-space/runtime/models";
```

这样可以先保证旧 import 不立刻全部改完，降低冲突。

第三步处理 built-in tools seam。把工具核心逻辑迁到：

```text
packages/runtime/src/tools/
├── tool-registry.ts
└── built-in/
    ├── fs.ts
    ├── web.ts
    ├── misc.ts
    └── built-in-tools-module.ts
```

但 `fs.ts` 不直接 import Desktop native reveal/open。改成依赖注入：

```ts
export interface FsBuiltInToolsDependencies {
  workspaceRoot: string;
  findSkill: (name: string) => SkillContent | null;
  openPath?: (path: string) => Promise<void> | void;
  revealPath?: (path: string) => Promise<void> | void;
}
```

Desktop 调用时注入：

```ts
createBuiltInToolsModule({
  env: process.env,
  findSkill: skillsManager.findSkill.bind(skillsManager),
  getSearchSettings: searchSettings.get.bind(searchSettings),
  workspaceRoot,
  openPath,
  revealPath: revealInFileManager,
});
```

未来 server 调用时可以不注入 native reveal/open，或注入 no-op/明确报错实现。这样 server 不会依赖 Electrobun/native shell。

第四步处理 `DesktopModule` 命名问题。`createBuiltInToolsModule()` 实际只需要一个工具注册 module，不应该依赖 DesktopHost 类型。迁到 runtime 后定义通用接口：

```ts
export interface RuntimeModule {
  id: string;
  register(tools: ToolRegistry): void;
  start?(): Promise<RuntimeModuleCleanup | void> | RuntimeModuleCleanup | void;
}
```

DesktopHost 可改为使用 `RuntimeModule`，或保留 `DesktopModule` 作为 alias：

```ts
export type DesktopModule = RuntimeModule;
```

第五步处理 skills seed。建议 Milestone 2 不移动 markdown seed 文件，先只迁移 `SkillsManager`，把默认 managed skills 目录作为构造参数注入：

```ts
new SkillsManager({ managedSkillsDir });
```

Desktop 继续由 `apps/desktop/src/bun/skills/seed.ts` 负责把 bundled markdown seed 到 `getManagedSkillsDir()`。未来 server 再决定是否复用 seed skills 或定义自己的 seed 来源。这样避免把 static markdown asset copy 规则一起引入 Milestone 2。

第六步逐步改 Desktop imports。优先让 composition root 直接使用 `@llm-space/runtime`：

```ts
import {
  ModelManager,
  McpManager,
  StreamThreadController,
} from "@llm-space/runtime";
```

若 diff 过大，可保留 wrapper，先只保证 `packages/runtime` 可独立 typecheck。最终验收是 Desktop 不从迁移后的实现文件 import，或者旧路径只是 re-export。

### 不在 Milestone 2 做的事情

- 不新增 `apps/server`。
- 不新增 Runtime HTTP/WebSocket RPC。
- 不新增 SSH 连接管理。
- 不改 Settings UI。
- 不改 release workflow。
- 不解决远程 trace 归属。
- 不做 server 包打包。

这些留给 Milestone 3 及之后。

### 文件级执行清单

新增：

```text
packages/runtime/package.json
packages/runtime/tsconfig.json
packages/runtime/src/index.ts
packages/runtime/src/runtime/index.ts
packages/runtime/src/tools/index.ts
```

移动或复制后删除旧实现：

```text
apps/desktop/src/bun/models/**      -> packages/runtime/src/models/**
apps/desktop/src/bun/mcp/**         -> packages/runtime/src/mcp/**
apps/desktop/src/bun/streaming/**   -> packages/runtime/src/streaming/**
apps/desktop/src/bun/search/**      -> packages/runtime/src/search/**
apps/desktop/src/bun/network/**     -> packages/runtime/src/network/**
apps/desktop/src/bun/storage/**     -> packages/runtime/src/storage/**
apps/desktop/src/bun/runtime/**     -> packages/runtime/src/runtime/**
apps/desktop/src/bun/tools/tool-registry.ts -> packages/runtime/src/tools/tool-registry.ts
apps/desktop/src/bun/tools/built-in/{misc,web}.ts -> packages/runtime/src/tools/built-in/
```

谨慎迁移，需改 seam：

```text
apps/desktop/src/bun/tools/built-in/fs.ts
apps/desktop/src/bun/tools/built-in/built-in-tools-module.ts
```

保留 Desktop wrapper：

```text
apps/desktop/src/bun/models/index.ts
apps/desktop/src/bun/mcp/index.ts
apps/desktop/src/bun/streaming/index.ts
apps/desktop/src/bun/search/index.ts
apps/desktop/src/bun/network/index.ts
apps/desktop/src/bun/storage/index.ts
apps/desktop/src/bun/runtime/index.ts
apps/desktop/src/bun/tools/tool-registry.ts
apps/desktop/src/bun/tools/built-in/index.ts
apps/desktop/src/bun/tools/built-in/built-in-tools-module.ts
```

如果 wrapper 造成测试路径混乱，可以在同一里程碑后半段删除 wrapper 并全量改 import。但默认先 wrapper，降低风险。

### 验证命令

Milestone 2 完成后必须运行：

```sh
bun run typecheck
bun run test
bun run lint
```

如果迁移 package exports 或 tsconfig，额外运行：

```sh
mise run build:canary
```

### 刚性验收

- `bun run typecheck` 零错误。
- `bun run test` 全部 PASS，0 skipped。
- `bun run lint` 零告警。
- `mise run build:canary` 成功。
- `packages/runtime` 中不得出现 `electrobun`、`react`、`@llm-space/ui`、`@/` import。
- Desktop 正常 composition root 仍能创建：`startDesktopApp()` 使用 runtime package 后 typecheck 通过。
- `mise run pack` 语义不变，不新增 server 包构建。

### 主要风险与缓解

风险 1：移动文件导致大量相对 import 断裂。
缓解：先复制到 `packages/runtime` 并修 import，再用 wrapper 保持 Desktop 旧路径；每迁一组跑一次 `bun run typecheck`。

风险 2：built-in fs tools 依赖 Desktop native reveal/open。
缓解：把 native 能力改为依赖注入；runtime package 只定义可选接口，不 import Desktop shell。

风险 3：settings 路径仍依赖 `@llm-space/core/server getSettingsDir()`，未来 server home 不可配置。
缓解：Milestone 2 可保留现状以降低风险；但在代码里预留 manager constructor options，如 `settingsDir?: string`，后续 server 传入 `~/.llm-space-server/settings`。若时间不够，至少在决策日志记录为 Milestone 3 前置改造。

风险 4：tests 仍在 Desktop 路径，迁移后测试引用错。
缓解：测试随被测模块迁到 `packages/runtime/src/**.test.ts`；DesktopHost 相关测试仍留在 Desktop。

### Milestone 2 建议拆分顺序

1. 新增 `packages/runtime` package skeleton，并加入 root typecheck。
2. 移动 `runtime/*`、`models/*`，跑 `bun run typecheck`。
3. 移动 `search/*`、`network/*`、`storage/*`，跑 `bun run typecheck`。
4. 移动 `streaming/*`，改 shared RPC type import，跑 `bun run typecheck`。
5. 移动 `mcp/*`，跑 `bun run typecheck`。
6. 移动 `tools/tool-registry.ts` 和 built-in `misc/web`，跑 tests。
7. 切 built-in `fs` 的 native seam，移动 built-in module，跑 tests。
8. 处理 `skills/skills-manager.ts`，保留 Desktop seed，跑 tests。
9. 全量 `bun run typecheck && bun run test && bun run lint && mise run build:canary`。

[2026-07-19 11:02:59+08:00] 修改说明：追加 Milestone 2 细化方案草案，等待用户 Review。理由：用户要求继续但同样先出方案，Milestone 2 影响面较大，按 ExecPlan 纪律先暂停确认。

---

[2026-07-19 11:20:00+08:00] 修改说明：执行 Milestone 2，把 Desktop runtime 模块迁入 `packages/runtime` 并记录验证结果；`build:canary` 因 GitHub 下载 electrobun CLI 超时未完全通过。理由：用户确认 Milestone 2 方案后开始实现。

---

[2026-07-19 11:19:28+08:00] 修改说明：补充用户手动 `mise run build:canary` 成功后的验证结果，并将 Milestone 2 标记完成。理由：构建产物已生成，后续复验 typecheck/test/lint/diff 均通过。

---

## Milestone 3 验证记录

- `bun install`：新增 `@llm-space/server` workspace 后刷新 workspace 依赖链接；普通沙箱解析依赖时 registry 连接失败，escalated `bun install` 成功并更新 lockfile。
- `bun --filter @llm-space/server dev -- --help`：退出码 0，输出包含 `--host`、`--port`、`--token`、`--home`。
- `bun --filter @llm-space/server dev -- --host 127.0.0.1 --port 39123 --home /tmp/llm-space-server-test`：退出码 1，明确输出 `--token is required.`。
- `bun run typecheck`：通过，零错误。
- `bun run test`：81 pass，0 fail，0 skipped。
- `bun run lint`：通过，零错误。
- `git diff --check`：通过，无 whitespace error。
- runtime 禁止依赖检查：`packages/runtime/src` 中没有 `electrobun`、`react`、`@llm-space/ui`、`@/`、`apps/desktop/src` import。
- 手动 smoke test：escalated 启动 `@llm-space/server` 到 `127.0.0.1:39123`；`/health` 带 token 返回 200；无 token 返回 401；`/rpc fs.mkdir` 创建 workspace 目录；`/rpc fs.write` 和 `fs.read` 成功读回 thread title。

## Milestone 3 细化方案 Review 草案

本节是在 Milestone 2 完成后追加的 Milestone 3 执行方案。目标是新增一个本机可运行的 headless server app：`apps/server` / `@llm-space/server`。它复用 `packages/runtime` 创建本地进程内 runtime，并通过 HTTP 暴露最小 Runtime RPC。用户确认本节后，才开始代码实现。

### Milestone 3 的目标

总目标不是“让 `bun --filter @llm-space/server dev` 不报错”。总目标是为 LLM Space 构建 SSH Remote Runtime 能力：本地 Desktop UI 通过 SSH 连接远程机器，在远程机器上启动 headless runtime server，并把 agent、模型、MCP、tools、workspace 文件读写放到远端执行。

Milestone 3 只是这个总目标中的一个中间里程碑：先做出可独立运行的 headless server 和最小 Runtime RPC。它验证未来 SSH tunnel 背后的服务端协议是否成立。当前 `bun --filter @llm-space/server dev` 报 `No packages matched the filter` 只是 Milestone 3 缺失的表象，不是本项目改造的最终目标。

Milestone 3 需要解决当前用户执行以下命令时报 `No packages matched the filter` 的问题：

```sh
bun --filter @llm-space/server dev -- \
  --host 127.0.0.1 \
  --port 39123 \
  --token test-token \
  --home /tmp/llm-space-server-test
```

完成后，上述命令应能启动一个 headless server。用户可以用 `curl` 验证 `/health`、`/rpc` 和 `/stream`。本里程碑仍不做 SSH 自动安装，不做 Desktop UI 连接远程 server，不做 release server 包，只验证 server runtime 和协议在本机成立。

### 当前前置状态

Milestone 1 已完成：Desktop 内部 runtime 能力通过 `RuntimeRouter` 路由，`runtimeId` 缺省为 `local`。

Milestone 2 已完成：运行时能力已迁入 `packages/runtime`，当前仓库有：

```text
packages/runtime/src/runtime/types.ts
packages/runtime/src/runtime/local-runtime-client.ts
packages/runtime/src/models
packages/runtime/src/mcp
packages/runtime/src/streaming
packages/runtime/src/tools
packages/runtime/src/skills
packages/runtime/src/search
packages/runtime/src/network
packages/runtime/src/storage
```

当前 `apps/` 目录还只有：

```text
apps/desktop/package.json
apps/web/package.json
```

因此 `@llm-space/server` 尚不存在，`bun --filter @llm-space/server ...` 报错是预期行为。

### 关键技术决策

#### 决策 1：新增 `apps/server`，不把 server 放进 `packages/runtime`

`packages/runtime` 是库，只提供 runtime object graph 和类型。`apps/server` 是进程入口，负责解析 CLI 参数、启动 HTTP server、处理鉴权、管理进程生命周期。二者职责不同，必须分开。

新增结构：

```text
apps/server/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── args.ts
    ├── auth.ts
    ├── errors.ts
    ├── http-server.ts
    ├── json.ts
    ├── runtime-factory.ts
    ├── rpc.ts
    ├── rpc-contract.ts
    └── stream.ts
```

#### 决策 2：Milestone 3 使用 Bun.serve + HTTP JSON RPC + SSE stream

本阶段优先用 Bun 内置 `Bun.serve`，不引入 Express/Hono。原因：server 路由少，Bun.serve 足够；新增框架会增加打包和远端部署变量。

协议分三类：

```text
GET  /health     健康检查和能力发现
POST /rpc        普通 request/response Runtime RPC
POST /stream     agent streaming，使用 text/event-stream
```

`/stream` 第一版使用 SSE，而不是 WebSocket。原因：`@llm-space/core/client` 已有 `createHttpTransport()` 使用 SSE 的心智模型；MVP 只需要“一次请求、一条 stream、由 AbortController 取消 HTTP 请求”。复杂的多路复用和显式 abort 留给 Milestone 4/5。

#### 决策 3：server 默认只监听 loopback

默认参数：

```text
--host 127.0.0.1
--port 39123
--home ~/.llm-space-server
--token 必填或开发模式自动生成并打印
```

建议 Milestone 3 令 `--token` 必填。没有 token 直接启动失败，错误说明必须提供 `--token`。这样避免开发阶段形成无鉴权习惯。

后续 SSH tunnel 场景中，远端 server 也会监听 `127.0.0.1:<remotePort>`，本地通过 SSH `-L` 暴露到 `127.0.0.1:<localPort>`。

#### 决策 4：server home 通过环境变量复用现有 `getSettingsDir()` 体系

当前 `ModelManager`、`McpManager`、`SearchSettingsManager`、`NetworkSettingsManager`、`SkillsManager` 内部通过 `@llm-space/core/server` 的 `getSettingsDir()` 解析 settings 路径，而 `getSettingsDir()` 又基于 LLM Space home。

Milestone 3 不先大改所有 manager constructor，而是在 server 启动最早阶段设置：

```ts
process.env.LLM_SPACE_HOME = resolvedHome;
```

然后再创建 runtime managers。这样 `settings/` 和 `workspace/` 都落到：

```text
<home>/settings
<home>/workspace
```

例如：

```text
/tmp/llm-space-server-test/settings/models.json
/tmp/llm-space-server-test/workspace
```

这是最小闭环路径。后续如需支持同一进程多 runtime，再改 managers 接收显式 `settingsDir`。

#### 决策 5：Milestone 3 的 built-in tools 注入 server-safe seam

server 复用 `createBuiltInToolsModule()` 时：

```ts
createBuiltInToolsModule({
  env: process.env,
  findSkill: skillsManager.findSkill.bind(skillsManager),
  getSearchSettings: searchSettings.get.bind(searchSettings),
  workspaceRoot,
  openPath: undefined,
  revealPath: undefined,
});
```

`present_files` 在 server 中不会打开本地图形界面；没有 `openPath/revealPath` 时应返回 OK 或明确 no-op。Milestone 3 验证重点不是 GUI reveal，而是 runtime server 能独立执行工具。

### CLI 参数设计

`apps/server/src/args.ts` 定义：

```ts
export interface ServerArgs {
  host: string;
  port: number;
  token: string;
  home: string;
}
```

支持：

```text
--host <host>       默认 127.0.0.1
--port <port>       默认 39123
--token <token>     必填，非空字符串
--home <path>       默认 ~/.llm-space-server，支持 ~ 展开
--help              打印帮助并退出
```

解析规则：

- 未知参数：启动失败，退出码 1。
- `--port` 不是 1-65535 整数：启动失败，退出码 1。
- `--token` 缺失或空：启动失败，退出码 1。
- `--home` 解析为绝对路径；相对路径用 `process.cwd()` resolve。

验收命令：

```sh
bun --filter @llm-space/server dev -- --help
bun --filter @llm-space/server dev -- --port nope --token test-token
bun --filter @llm-space/server dev -- --host 127.0.0.1 --port 39123 --token test-token --home /tmp/llm-space-server-test
```

### HTTP 鉴权设计

所有 endpoint 都要求：

```text
Authorization: Bearer <token>
```

包括 `/health`。这样最简单，也符合后续 SSH tunnel 场景。

`apps/server/src/auth.ts`：

```ts
export function verifyBearerToken(request: Request, token: string): boolean {
  return request.headers.get("authorization") === `Bearer ${token}`;
}
```

失败响应：

```text
HTTP 401
Content-Type: application/json
```

body：

```json
{
  "ok": false,
  "error": {
    "code": "unauthorized",
    "message": "Missing or invalid bearer token."
  }
}
```

### `/health` 设计

请求：

```sh
curl -fsS \
  -H 'Authorization: Bearer test-token' \
  http://127.0.0.1:39123/health
```

响应：

```ts
export interface ServerHealthResponse {
  ok: true;
  version: string;
  protocolVersion: 1;
  capabilities: RuntimeCapability[];
  homePath: string;
  workspacePath: string;
  platform: {
    os: NodeJS.Platform;
    arch: string;
  };
}
```

其中 `version` 读取 `apps/server/package.json` 或 root/desktop 版本。Milestone 3 可先用 `apps/server/package.json` 的 `version`，保持与当前项目版本一致。

### `/rpc` 设计

请求 envelope：

```ts
export interface RuntimeRpcRequest<TParams = unknown> {
  id: string;
  method: RuntimeRpcMethod;
  params?: TParams;
}
```

响应 envelope：

```ts
export type RuntimeRpcResponse<TResult = unknown> =
  | { id: string; ok: true; result: TResult }
  | {
      id: string;
      ok: false;
      error: { code: string; message: string; detail?: unknown };
    };
```

第一版支持这些 method，覆盖手动验证闭环：

```text
runtime.info
fs.ls
fs.mkdir
fs.read
fs.write
fs.realpath
models.available
models.builtinProviders
models.getDefault
mcp.listServers
builtinTools.list
search.get
network.get
skills.getSettings
```

第一版可暂不支持 destructive 或复杂 mutating method，例如 provider 更新、mcp add/update/remove、tool call、skills add/remove。原因：Milestone 3 目标是 server 独立启动和最小可观测读写；完整能力留给 Milestone 4/7。

但文件写入需要支持 `fs.write`，否则无法验证 workspace 确实写入 server home。`fs.write` 的 payload 使用现有 `Thread` 类型。

示例：

```sh
curl -fsS \
  -H 'Authorization: Bearer test-token' \
  -H 'Content-Type: application/json' \
  http://127.0.0.1:39123/rpc \
  -d '{
    "id": "1",
    "method": "fs.mkdir",
    "params": { "path": "demo" }
  }'
```

响应：

```json
{ "id": "1", "ok": true, "result": null }
```

未知 method：

```json
{
  "id": "1",
  "ok": false,
  "error": {
    "code": "method_not_found",
    "message": "Runtime RPC method not found: unknown.method"
  }
}
```

### `/stream` 设计

请求：

```ts
export interface StreamRequestBody {
  request: AgentStreamRequest;
}
```

响应：

```text
Content-Type: text/event-stream
```

事件格式复用 core HTTP transport 约定：

```text
data: [START]

data: {"type":"..."}

data: [DONE]
```

实现上用 `ReadableStream` 包装 `runtime.streamThread()`。给这次 stream 分配 `streamId = crypto.randomUUID()`。如果 HTTP request 被取消，则 abort 对应 `AbortController` 或调用 `runtime.abortStream({ streamId })`。

Milestone 3 的 `/stream` 验收可以先做“无真实 API key 的失败路径”或“连接 tester”后置。刚性验收重点是 endpoint 能接受合法 JSON、鉴权生效、错误能以 SSE 或 HTTP JSON 明确返回。真实模型调用依赖用户环境变量/API key，不作为 CI 必选项。

### runtime-factory 设计

`apps/server/src/runtime-factory.ts` 创建 server 进程内 runtime：

```ts
export interface ServerRuntimeContext {
  runtime: LocalRuntimeClient;
  homePath: string;
  workspacePath: string;
  stop(): Promise<void>;
}
```

步骤：

1. 解析并创建 `homePath`。
2. 在任何 manager 构造前设置 `process.env.LLM_SPACE_HOME = homePath`。
3. 创建 `NetworkSettingsManager`，使代理设置尽早生效。
4. 创建 `McpManager`、`ModelManager`、`SearchSettingsManager`、`SkillsManager`。
5. 创建 `LocalFileSystem`：`createLocalFileSystem(homePath)`。
6. 创建 `StreamThreadController(modelManager)`。server 暂不接 analytics。
7. 创建 `ToolRegistry`，注册 built-in tools module，freeze。
8. 创建 `LocalRuntimeClient`。
9. `stop()` 时关闭 streaming、MCP manager。

server 不需要 DesktopHost。可以直接用 runtime package 的 `RuntimeModule` 和 `ToolRegistry`：

```ts
const tools = new ToolRegistry();
const module = createBuiltInToolsModule(...);
module.register(tools);
tools.freeze();
```

### package 和 task 设计

新增 `apps/server/package.json`：

```json
{
  "name": "@llm-space/server",
  "version": "4.2.0",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "bun src/index.ts",
    "start": "bun src/index.ts",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@llm-space/core": "workspace:*",
    "@llm-space/runtime": "workspace:*"
  }
}
```

新增 `apps/server/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["bun"],
    "lib": ["ESNext", "DOM"]
  },
  "include": ["src"]
}
```

更新 root `package.json`：

```json
"dev:server": "bun --filter @llm-space/server dev",
"typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p packages/runtime/tsconfig.json && tsc --noEmit -p packages/ui/tsconfig.json && tsc --noEmit -p apps/desktop/tsconfig.json && tsc --noEmit -p apps/web/tsconfig.json && tsc --noEmit -p apps/server/tsconfig.json"
```

更新 `mise.toml` 新增任务：

```toml
[tasks."dev:server"]
description = "Run the headless LLM Space runtime server"
run = "bun run dev:server"
```

Milestone 3 暂不新增 `build:server` / `pack:server`，因为那属于 Milestone 8 包装发布。

### 测试设计

新增测试文件：

```text
apps/server/src/args.test.ts
apps/server/src/auth.test.ts
apps/server/src/rpc.test.ts
```

测试要求：

- `args.test.ts`：覆盖默认值、必填 token、非法 port、home 路径 resolve。
- `auth.test.ts`：覆盖正确 bearer、缺失 bearer、错误 bearer。
- `rpc.test.ts`：用 fake/minimal runtime 测 `/rpc` dispatch，不启动真实模型请求，不依赖外部网络。

如果 Bun.serve 集成测试成本较低，可以新增：

```text
apps/server/src/http-server.test.ts
```

启动一个随机端口 server，测试：

- `/health` 正确 token 返回 200。
- `/health` 无 token 返回 401。
- `/rpc` `runtime.info` 返回 ok。

端口应使用 `port: 0` 或随机可用端口，避免固定端口占用导致测试 flaky。

### 手动验收步骤

1. 安装/刷新 workspace：

```sh
bun install
```

2. 启动 server：

```sh
rm -rf /tmp/llm-space-server-test
bun --filter @llm-space/server dev -- \
  --host 127.0.0.1 \
  --port 39123 \
  --token test-token \
  --home /tmp/llm-space-server-test
```

预期 stdout：

```text
llm-space-server listening on http://127.0.0.1:39123
home: /tmp/llm-space-server-test
workspace: /tmp/llm-space-server-test/workspace
```

3. 验证 health：

```sh
curl -fsS \
  -H 'Authorization: Bearer test-token' \
  http://127.0.0.1:39123/health
```

预期 JSON：

```json
{
  "ok": true,
  "protocolVersion": 1,
  "capabilities": ["streamThread", "filesystem", "models"]
}
```

4. 验证无 token 失败：

```sh
curl -i http://127.0.0.1:39123/health
```

预期：

```text
HTTP/1.1 401 Unauthorized
```

5. 验证 RPC 写 workspace：

```sh
curl -fsS \
  -H 'Authorization: Bearer test-token' \
  -H 'Content-Type: application/json' \
  http://127.0.0.1:39123/rpc \
  -d '{"id":"1","method":"fs.mkdir","params":{"path":"demo"}}'
```

预期：

```json
{ "id": "1", "ok": true, "result": null }
```

文件系统断言：

```sh
test -d /tmp/llm-space-server-test/workspace/demo
```

6. 验证写入并读回 thread：

```sh
curl -fsS \
  -H 'Authorization: Bearer test-token' \
  -H 'Content-Type: application/json' \
  http://127.0.0.1:39123/rpc \
  -d '{
    "id":"2",
    "method":"fs.write",
    "params":{
      "path":"demo/thread.json",
      "thread":{"title":"Remote runtime smoke test","messages":[]}
    }
  }'

curl -fsS \
  -H 'Authorization: Bearer test-token' \
  -H 'Content-Type: application/json' \
  http://127.0.0.1:39123/rpc \
  -d '{"id":"3","method":"fs.read","params":{"path":"demo/thread.json"}}'
```

预期读回 title 包含：

```text
Remote runtime smoke test
```

### 自动验证命令

Milestone 3 完成后必须运行：

```sh
bun run typecheck
bun run test
bun run lint
git diff --check
```

可选但建议运行：

```sh
mise run dev:server -- --help
```

或者直接：

```sh
bun --filter @llm-space/server dev -- --help
```

### 刚性验收标准

- `bun --filter @llm-space/server dev -- --help` 退出码 0，输出包含 `--host`、`--port`、`--token`、`--home`。
- 无 `--token` 启动退出码 1，并输出 `--token is required` 或等价明确错误。
- 正确 token 请求 `/health` 返回 HTTP 200，JSON `ok: true`、`protocolVersion: 1`。
- 无 token 请求 `/health` 返回 HTTP 401。
- `/rpc` `fs.mkdir` 能在 `<home>/workspace` 下创建目录。
- `/rpc` `fs.write` + `fs.read` 能写入并读回 thread JSON。
- `bun run typecheck` 零错误。
- `bun run test` 全部 PASS，0 skipped。
- `bun run lint` 零错误。
- `packages/runtime` 仍无 Desktop/UI/Electrobun import。
- `mise run pack` / Desktop packaging 语义不变；Milestone 3 不新增 server 打包产物。

### 不在 Milestone 3 做的事情

- 不做 Desktop UI 添加 Remote Runtime。
- 不做 Desktop `RemoteRuntimeClient`。
- 不做 SSH bootstrap。
- 不做 server 二进制/tarball 打包。
- 不做 WebSocket 多路复用。
- 不做完整 MCP 管理写操作。
- 不做公网访问和多用户权限模型。
- 不要求真实模型 API key 可用；`/stream` 真实 agent run 作为手动增强验收，不作为 CI 必选。

### 风险与缓解

风险 1：`ModelManager` 等 manager 仍通过 `LLM_SPACE_HOME` 取 settings，server 启动顺序如果错，会写到用户本地 `~/.llm-space`。

缓解：`runtime-factory.ts` 必须在任何 manager 构造前设置 `process.env.LLM_SPACE_HOME = homePath`；新增测试或手动验收检查 `/tmp/llm-space-server-test/settings` 被创建。

风险 2：`fs.write` 传入的 thread JSON 过于简化，可能被 `LocalFileSystem` normalize/validate 拒绝。

缓解：使用项目 parser 可接受的最小 Thread shape；若最小 shape 不稳定，测试中先通过 `fs.write` 写由现有 normalize helper 创建的 thread fixture，或者改为先只验证 `fs.mkdir`/`fs.ls`，但最终手动验收必须覆盖 thread write/read。

风险 3：SSE `/stream` 的 abort 和错误语义容易复杂化。

缓解：Milestone 3 只实现单请求单 stream。HTTP 连接关闭时调用 abort；错误事件用 `data: {"type":"error"...}` 或 HTTP 500 JSON，二选一并写入测试。完整 stream 协议留给 Desktop RemoteRuntimeClient 阶段继续收敛。

风险 4：Bun.serve 测试端口占用导致 flaky。

缓解：测试使用 `port: 0` 或封装 `startServer({ port: 0 })` 返回实际 URL；测试结束必须 `server.stop(true)`。

### Milestone 3 建议拆分顺序

1. 新增 `apps/server/package.json`、`tsconfig.json`、`src/index.ts`，让 `bun --filter @llm-space/server dev -- --help` 可运行。
2. 实现 `args.ts` 和 `auth.ts`，补单测。
3. 实现 `runtime-factory.ts`，确保 `LLM_SPACE_HOME` 设置在 manager 构造前。
4. 实现 `/health`，用 curl 验证 200/401。
5. 实现 `/rpc` envelope 和最小 method：`runtime.info`、`fs.mkdir`、`fs.ls`、`fs.write`、`fs.read`。
6. 实现 `/stream` SSE skeleton，可先覆盖鉴权和请求格式，真实模型调用作为手动增强验收。
7. 更新 root scripts 和 `mise.toml` 的 `dev:server`。
8. 跑 `bun install` 刷新 workspace，执行 typecheck/test/lint。
9. 执行手动 curl smoke test，并把输出摘要记录回 ExecPlan。

[2026-07-19 11:29:45+08:00] 修改说明：追加 Milestone 3 详细方案草案，等待用户 Review。理由：用户要求产出详细的 Milestone 3 方案，且当前 `@llm-space/server` 尚不存在，必须先明确 server app、协议和验证边界。

[2026-07-19 11:36:00+08:00] 修改说明：修正 Milestone 3 目标表述，明确总目标是构建 SSH Remote Runtime 能力，`@llm-space/server` 只是服务端子里程碑。理由：用户指出“解决 bun filter 报错”不是项目真实目标，原表述容易把手段误写成目标。

---

[2026-07-19 12:29:34+08:00] 修改说明：完成 Milestone 3，实现 `apps/server` headless server、HTTP 鉴权、`/health`、最小 `/rpc` 和 `/stream` skeleton，并记录自动/手动验证结果。理由：用户确认继续后执行服务端基础里程碑。

---

## Milestone 4 验证记录

- `bun run typecheck`：通过，零错误。
- `bun run test`：92 pass，0 fail，0 skipped。
- `bun run lint`：通过，零错误。
- `git diff --check`：通过，无 whitespace error。
- runtime 禁止依赖检查：`packages/runtime/src` 中没有 `electrobun`、`react`、`@llm-space/ui`、`@/`、`apps/desktop/src` import。
- `RemoteRuntimeClient` 单测：覆盖 `/health` bearer auth、`/rpc` envelope、RPC `ok:false` 错误、SSE `[START]`/event/`[DONE]` 解析。
- 真实 server smoke test：`apps/server` 监听 `127.0.0.1:39124`，Desktop `RemoteRuntimeClient` 连接成功，`info()` 返回 remote capabilities，`fs.mkdir`/`fs.write`/`fs.read` 成功读回 title `Desktop RemoteRuntimeClient smoke`。
- 待人工验收：使用 Electrobun Desktop UI 在 `LLM_SPACE_ACTIVE_RUNTIME_ID=remote:manual` 下新建 thread，确认文件写入 `/tmp/llm-space-server-test/workspace`。

## Milestone 4 细化方案 Review 草案

本节是在 Milestone 3 完成且用户确认 server smoke test 没问题后追加的 Milestone 4 执行方案。总目标仍然是构建 SSH Remote Runtime 能力。Milestone 4 的职责是把 Desktop bun 进程接到一个已经运行的 Runtime Server 上，使现有 Desktop UI 在开发开关下可以把默认 runtime 从 `local` 切到 `remote:<id>`。本里程碑仍不做 SSH 自动安装，也不做正式 Remote Servers 设置页。

### Milestone 4 的目标

完成后，开发者可以手动启动 server：

```sh
bun --filter @llm-space/server dev -- \
  --host 127.0.0.1 \
  --port 39123 \
  --token test-token \
  --home /tmp/llm-space-server-test
```

再用环境变量启动 Desktop：

```sh
LLM_SPACE_ENABLE_REMOTE_RUNTIME=1 \
LLM_SPACE_REMOTE_RUNTIME_URL=http://127.0.0.1:39123 \
LLM_SPACE_REMOTE_RUNTIME_TOKEN=test-token \
LLM_SPACE_ACTIVE_RUNTIME_ID=remote:manual \
mise run dev
```

预期 Desktop 仍显示同一套本地 React UI，但默认 runtime 指向远端 server。用户在 UI 中创建/打开/保存 thread 时，文件应落到：

```text
/tmp/llm-space-server-test/workspace
```

而不是本地：

```text
~/.llm-space/workspace
```

这一步验证未来 SSH tunnel 的核心等价物：Desktop 访问 `http://127.0.0.1:<localPort>`，只不过 Milestone 4 的这个端口是手动启动的本机 server，不是 SSH 自动转发来的远程 server。

### 当前前置状态

已完成：

```text
Milestone 1: RuntimeRouter + LocalRuntime，runtimeId 缺省 local
Milestone 2: packages/runtime，运行时能力可被 server 复用
Milestone 3: apps/server，HTTP /health、/rpc、/stream skeleton，最小 fs read/write smoke test 通过
```

当前 Desktop renderer 侧已有可选 `runtimeId` 参数：

```text
apps/desktop/src/client/local-file-system.ts
apps/desktop/src/client/rpc-transport.ts
apps/desktop/src/shared/rpc.ts
```

但现在默认实现仍等价于 local。要让现有 UI 在不大改组件树的情况下切到 remote，需要引入“默认 runtime”概念：当 renderer 不显式传 `runtimeId` 时，由 bun 进程的 `RuntimeRouter` 决定默认 runtime 是 local 还是 remote。

### 关键技术决策

#### 决策 1：Milestone 4 不做正式 UI，用环境变量做手动远程闭环

本里程碑只做开发/内部验证入口，不做 Settings UI。原因：UI 设计会牵涉多 server 管理、secret 存储、workspace/tab 绑定、错误态展示，这属于 Milestone 6。

Milestone 4 使用环境变量：

```text
LLM_SPACE_ENABLE_REMOTE_RUNTIME=1
LLM_SPACE_REMOTE_RUNTIME_URL=http://127.0.0.1:39123
LLM_SPACE_REMOTE_RUNTIME_TOKEN=test-token
LLM_SPACE_REMOTE_RUNTIME_ID=remote:manual       # 可选，默认 remote:manual
LLM_SPACE_ACTIVE_RUNTIME_ID=remote:manual       # 可选；设置后 Desktop 默认 runtime 指向 remote
```

如果 `LLM_SPACE_ENABLE_REMOTE_RUNTIME` 未设置，Desktop 行为必须完全保持本地默认。

#### 决策 2：`RuntimeRouter` 增加 default runtime，而不是让 renderer 到处传 remote id

当前许多 renderer client 是模块级 singleton，例如：

```ts
const rpcTransport = createRpcTransport();
export const localFs = new LocalFileSystemClient();
```

如果 Milestone 4 要让 UI 真实切 remote，最小风险方式不是改所有组件 props，而是让“不传 runtimeId”表示“使用 bun 侧默认 runtime”。

因此需要调整：

```ts
class RuntimeRouter {
  setDefaultRuntime(id: RuntimeId): void;
  get(runtimeId?: RuntimeId): RuntimeClient; // runtimeId 缺省时使用 defaultRuntimeId
}
```

默认值仍是：

```text
local
```

当 Desktop 启动时检测到：

```text
LLM_SPACE_ENABLE_REMOTE_RUNTIME=1
LLM_SPACE_ACTIVE_RUNTIME_ID=remote:manual
```

则：

```ts
runtimeRouter.register("remote:manual", remoteRuntime);
runtimeRouter.setDefaultRuntime("remote:manual");
```

这让旧 UI 的 `availableModels({})`、`fsRead({ path })`、`sendStreamThreadRequest({ streamId, request })` 走 remote，而无需改 ThreadPlayground 组件结构。

#### 决策 3：renderer 默认 client 不再主动填 `runtimeId: "local"`

Milestone 1 中 `LocalFileSystemClient` 和 `createRpcTransport()` 默认会写入 `runtimeId: "local"`。这会绕过 `RuntimeRouter` 默认 runtime，阻止环境变量切 remote。

Milestone 4 需要改成：

```ts
new LocalFileSystemClient(); // 不传 runtimeId，走 bun default runtime
new LocalFileSystemClient("local"); // 显式 local
new LocalFileSystemClient("remote:..."); // 显式 remote

createRpcTransport(); // 不传 runtimeId，走 bun default runtime
createRpcTransport("local"); // 显式 local
```

实现上：

```ts
constructor(private readonly _runtimeId?: RuntimeId) {}
```

发送 RPC 时只在 `_runtimeId` 有值时附加字段：

```ts
{ ...this._scope(), path }
```

这样不开 remote 时仍然 local，因为 bun router 默认 local；开 remote 时可以全局切 default。

#### 决策 4：新增 Desktop bun 侧 `RemoteRuntimeClient`

新增：

```text
apps/desktop/src/bun/remote/
├── index.ts
├── remote-runtime-client.ts
├── remote-runtime-config.ts
└── remote-runtime-manager.ts
```

`RemoteRuntimeClient` 实现 `RuntimeClient`，通过 HTTP 调 `apps/server`：

```ts
new RemoteRuntimeClient({
  id: "remote:manual",
  name: "Manual Remote",
  baseUrl: "http://127.0.0.1:39123",
  token: "test-token",
});
```

职责：

- `health()` / `info()`：调用 `/health` 并转换为 `RuntimeInfo`。
- 普通方法：通过 `/rpc` 调 server method。
- `streamThread()`：通过 `/stream` 发起 SSE stream，把 server events 转成 `RuntimeStreamResponsePayload` 回调。
- 错误处理：HTTP 非 2xx、RPC `ok:false`、协议版本不兼容都抛明确错误。

Milestone 4 的 `RemoteRuntimeClient` 必须支持当前 server 已实现的 method：

```text
runtime.info
fs.ls
fs.mkdir
fs.read
fs.write
fs.realpath
models.available
models.builtinProviders
models.getDefault
mcp.listServers
builtinTools.list
search.get
network.get
skills.getSettings
```

对于 server 还没有实现的 `RuntimeClient` 方法，RemoteRuntimeClient 可以抛：

```text
Remote runtime method is not implemented yet: <method>
```

但不要静默 fallback 到 local。静默 fallback 会破坏“到底在哪执行”的可信性。

#### 决策 5：协议类型应上移到 `packages/runtime`，避免 Desktop import `apps/server`

当前 Milestone 3 的协议类型在：

```text
apps/server/src/rpc-contract.ts
```

Milestone 4 中 Desktop 也需要同一套 envelope 和 protocolVersion。Desktop 不应该 import `apps/server/src/*`。

因此需要新增或迁移到：

```text
packages/runtime/src/remote-protocol.ts
```

导出：

```ts
export const REMOTE_RUNTIME_PROTOCOL_VERSION = 1;
export interface RemoteRuntimeHealthResponse { ... }
export type RemoteRuntimeRpcMethod = ...;
export interface RemoteRuntimeRpcRequest<TParams = unknown> { ... }
export type RemoteRuntimeRpcResponse<TResult = unknown> = ...;
```

然后：

```text
apps/server/src/rpc-contract.ts -> re-export 或改 import packages/runtime/remote-protocol
apps/desktop/src/bun/remote/remote-runtime-client.ts -> import packages/runtime/remote-protocol
```

#### 决策 6：Milestone 4 的 Desktop UI 验收只覆盖 workspace 和无工具 thread，不承诺完整远程工具执行

原因：当前 `HostServices.executeTool`、MCP call、built-in tool call 等 renderer client 仍是 local 默认或只部分 runtime-aware。完整“工具调用也远端执行”属于 Milestone 7。

Milestone 4 的 UI 验收限定为：

```text
文件树读取 remote workspace
新建 thread 写 remote workspace
打开 thread 读 remote workspace
无工具 agent run 通过 remote /stream 发给 server
```

如果用户打开 MCP/Tools/Settings 页面，未实现的远程写操作可以报清晰错误，不作为 Milestone 4 验收失败。

### 文件级修改计划

#### 1. `packages/runtime` 增加远程协议类型

新增：

```text
packages/runtime/src/remote-protocol.ts
```

修改：

```text
packages/runtime/src/index.ts
packages/runtime/package.json exports
apps/server/src/rpc-contract.ts
```

目标：server 和 desktop 共享 protocolVersion、health response、RPC envelope、method union。

#### 2. `RuntimeRouter` 支持 default runtime

修改：

```text
packages/runtime/src/runtime/runtime-router.ts
```

新增能力：

```ts
private _defaultRuntimeId: RuntimeId = "local";
setDefaultRuntime(id: RuntimeId): void;
getDefaultRuntimeId(): RuntimeId;
get(runtimeId?: RuntimeId): RuntimeClient;
```

规则：

- `setDefaultRuntime("missing")` 必须抛错。
- `unregister(defaultRuntime)` 必须抛错或自动回 local；建议抛错，避免意外切走。
- `local` 不能 unregister。

新增测试：

```text
packages/runtime/src/runtime/runtime-router.test.ts
```

覆盖 default runtime 行为。

#### 3. renderer client 默认不显式填 local

修改：

```text
apps/desktop/src/client/local-file-system.ts
apps/desktop/src/client/rpc-transport.ts
```

从：

```ts
constructor(private readonly _runtimeId: RuntimeId = "local") {}
createRpcTransport(runtimeId: RuntimeId = "local")
```

改为：

```ts
constructor(private readonly _runtimeId?: RuntimeId) {}
createRpcTransport(runtimeId?: RuntimeId)
```

发送 payload 时：

```ts
private _scope(): RuntimeScopedParams {
  return this._runtimeId ? { runtimeId: this._runtimeId } : {};
}
```

这样无 remote env 时仍走 router default local；有 remote env 时可全局切 remote。

#### 4. 新增 Desktop RemoteRuntimeClient

新增：

```text
apps/desktop/src/bun/remote/remote-runtime-config.ts
apps/desktop/src/bun/remote/remote-runtime-client.ts
apps/desktop/src/bun/remote/remote-runtime-manager.ts
apps/desktop/src/bun/remote/index.ts
```

`remote-runtime-config.ts`：

```ts
export interface ManualRemoteRuntimeConfig {
  enabled: boolean;
  id: RuntimeId;
  name: string;
  baseUrl: string;
  token: string;
  makeDefault: boolean;
}

export function readManualRemoteRuntimeConfig(
  env: NodeJS.ProcessEnv
): ManualRemoteRuntimeConfig | null;
```

环境变量解析：

```text
LLM_SPACE_ENABLE_REMOTE_RUNTIME=1
LLM_SPACE_REMOTE_RUNTIME_URL=<url>
LLM_SPACE_REMOTE_RUNTIME_TOKEN=<token>
LLM_SPACE_REMOTE_RUNTIME_ID=<runtime id, default remote:manual>
LLM_SPACE_ACTIVE_RUNTIME_ID=<runtime id>
```

校验：

- `enabled` 非 1/true 时返回 null。
- URL 缺失时报错或忽略？建议报错，避免用户以为远程已启用。
- token 缺失时报错。
- runtime id 必须以 `remote:` 开头。

`remote-runtime-client.ts`：

- `_rpc(method, params)` POST `/rpc`。
- `_health()` GET `/health`。
- `streamThread()` POST `/stream`，解析 SSE。
- `shutdown()` abort active streams。

SSE 解析建议实现私有小 parser，不从 `apps/server` import。只处理当前 server 格式：按空行分隔 event，读取 `data:` 行；`[START]` 忽略，`[DONE]` 结束，JSON object 按 `AgentEvent` 处理，`{type:"error"}` 转 error。

`remote-runtime-manager.ts`：

```ts
export async function registerManualRemoteRuntime({
  runtimeRouter,
  env,
}: {
  runtimeRouter: RuntimeRouter;
  env: NodeJS.ProcessEnv;
}): Promise<RemoteRuntimeClient | null>;
```

步骤：

1. 读 env config。
2. 创建 RemoteRuntimeClient。
3. 调 `/health`。
4. 校验 `protocolVersion === REMOTE_RUNTIME_PROTOCOL_VERSION`。
5. `runtimeRouter.register(id, client)`。
6. 如果 `LLM_SPACE_ACTIVE_RUNTIME_ID === id`，调用 `setDefaultRuntime(id)`。
7. 返回 client，供 shutdown 时关闭。

#### 5. Desktop composition root 注册 remote runtime

修改：

```text
apps/desktop/src/bun/app/start-desktop-app.ts
```

在创建 `runtimeRouter` 后、创建 RPC 前：

```ts
const remoteRuntime = await registerManualRemoteRuntime({
  runtimeRouter,
  env: process.env,
});
```

shutdown 加：

```ts
["remote runtime", () => remoteRuntime?.shutdown()];
```

注意：如果 env 启用但远程连接失败，建议启动失败而不是静默 local。理由：开发者显式启用 remote，失败时应该立刻知道，不要误以为在远端执行。

#### 6. Desktop RPC 增加默认 runtime 查询

修改：

```text
apps/desktop/src/shared/rpc.ts
apps/desktop/src/bun/rpc/index.ts
```

新增 request：

```ts
getDefaultRuntime: {
  params: Record<string, never>;
  response: {
    runtimeId: RuntimeId;
  }
}
```

`listRuntimes` 已有。Milestone 4 不一定需要 UI 使用，但对调试和后续 UI 有用。

### Desktop RemoteRuntimeClient 方法映射表

Milestone 4 至少实现：

| RuntimeClient 方法     | Remote RPC method         | Milestone 4 验收                    |
| ---------------------- | ------------------------- | ----------------------------------- |
| `info()`               | `/health` + local cache   | 必须                                |
| `availableModels()`    | `models.available`        | 必须                                |
| `builtinProviders()`   | `models.builtinProviders` | 必须                                |
| `getDefaultModel()`    | `models.getDefault`       | 必须                                |
| `fsLs()`               | `fs.ls`                   | 必须                                |
| `fsMkdir()`            | `fs.mkdir`                | 必须                                |
| `fsRead()`             | `fs.read`                 | 必须                                |
| `fsWrite()`            | `fs.write`                | 必须                                |
| `fsRealpath()`         | `fs.realpath`             | 必须                                |
| `mcpListServers()`     | `mcp.listServers`         | 必须                                |
| `builtInListTools()`   | `builtinTools.list`       | 必须                                |
| `getSearchSettings()`  | `search.get`              | 必须                                |
| `getNetworkSettings()` | `network.get`             | 必须                                |
| `skillsGetSettings()`  | `skills.getSettings`      | 必须                                |
| `streamThread()`       | `/stream`                 | skeleton 必须，真实模型调用手动增强 |

暂不支持的方法必须抛明确错误：

```text
Remote runtime method is not implemented yet: fs.cp
Remote runtime method is not implemented yet: mcp.addServer
```

不要 fallback local。

### 自动测试设计

新增测试：

```text
packages/runtime/src/runtime/runtime-router.test.ts
apps/desktop/src/bun/remote/remote-runtime-config.test.ts
apps/desktop/src/bun/remote/remote-runtime-client.test.ts
```

`runtime-router.test.ts`：

- 默认 runtime 是 local。
- 注册 remote 后可 `setDefaultRuntime(remote)`。
- `get(undefined)` 返回 default runtime。
- 不能 unregister local。
- 不能 unregister 当前 default runtime。

`remote-runtime-config.test.ts`：

- feature flag 未开返回 null。
- 缺 URL/token 抛明确错误。
- 默认 id 是 `remote:manual`。
- 非 `remote:` id 抛错。
- `LLM_SPACE_ACTIVE_RUNTIME_ID` 匹配 id 时 `makeDefault: true`。

`remote-runtime-client.test.ts`：

用 `Bun.serve({ port: 0 })` 起 fake server，覆盖：

- GET `/health` 带 Authorization。
- POST `/rpc` envelope 正确。
- RPC `ok:false` 转 throw。
- HTTP 401/500 转 throw。
- `/stream` 能解析 `[START]`、一个 JSON event、`[DONE]`。

测试 server 必须 `server.stop(true)`。

### 手动验收步骤

1. 启动 server：

```sh
rm -rf /tmp/llm-space-server-test
bun --filter @llm-space/server dev -- \
  --host 127.0.0.1 \
  --port 39123 \
  --token test-token \
  --home /tmp/llm-space-server-test
```

2. 启动 Desktop：

```sh
LLM_SPACE_ENABLE_REMOTE_RUNTIME=1 \
LLM_SPACE_REMOTE_RUNTIME_URL=http://127.0.0.1:39123 \
LLM_SPACE_REMOTE_RUNTIME_TOKEN=test-token \
LLM_SPACE_ACTIVE_RUNTIME_ID=remote:manual \
mise run dev
```

3. 在 Desktop UI 中执行：

```text
New Thread
输入任意内容或改标题
等待自动保存
```

4. 终端验证：

```sh
find /tmp/llm-space-server-test/workspace -type f -name '*.json' -maxdepth 4
```

预期：能看到 Desktop 创建的 thread JSON。

5. 反向验证本地默认目录没有新增同名文件：

```sh
find ~/.llm-space/workspace -type f -name '*.json' -mmin -2
```

预期：没有本次新建 remote thread，或至少能通过文件内容确认本次操作写在 remote home。

6. 验证打开远端已有 thread：

```sh
cat /tmp/llm-space-server-test/workspace/<path>.json
```

Desktop UI 重新打开后应能显示该 thread。

### 自动验证命令

Milestone 4 完成后必须运行：

```sh
bun run typecheck
bun run test
bun run lint
git diff --check
```

如网络/环境允许，追加：

```sh
mise run build:canary
```

### 刚性验收标准

- `bun run typecheck` 零错误。
- `bun run test` 全部 PASS，0 skipped。
- `bun run lint` 零错误。
- `git diff --check` 无 whitespace error。
- 不设置 `LLM_SPACE_ENABLE_REMOTE_RUNTIME` 时，Desktop 默认 runtime 仍是 local。
- 设置 remote env 且 server 可达时，`RuntimeRouter.list()` 至少包含 `local` 和 `remote:manual`。
- 设置 `LLM_SPACE_ACTIVE_RUNTIME_ID=remote:manual` 时，未显式传 `runtimeId` 的 Desktop fs/model/stream RPC 走 remote。
- remote server 不可达时，Desktop 启动失败并给出包含 remote URL 的明确错误；不静默 fallback local。
- Desktop UI 新建 thread 后，文件写入 `/tmp/llm-space-server-test/workspace`。
- `packages/runtime` 仍没有 Desktop/UI/Electrobun import。

### 不在 Milestone 4 做的事情

- 不做 SSH bootstrap。
- 不做 Remote Servers 正式设置页。
- 不做 keychain/secret 持久化。
- 不做 per-tab/per-workspace runtime 绑定。
- 不做完整远程 MCP add/update/remove。
- 不做完整远程 tool execution 语义。
- 不做 server 包打包和自动升级。
- 不承诺真实模型 API key 下的 agent run 必然成功；只保证 Desktop 能把 stream 请求发到 remote `/stream` 并处理协议。

### 风险与缓解

风险 1：renderer client 继续显式传 `runtimeId: "local"`，导致 active remote 不生效。

缓解：Milestone 4 必须把默认 client 改为“不传 runtimeId”，用测试或代码检查确认 `new LocalFileSystemClient()` 和 `createRpcTransport()` 的 payload 无 runtimeId。

风险 2：remote server 的 `/rpc` method 不完整，用户误操作设置页时看到错误。

缓解：未实现方法抛明确错误，不 fallback local。Milestone 4 手动验收只覆盖 workspace read/write 和基础列表。完整设置页归 Milestone 6/7。

风险 3：全局 default runtime 会让 trace/workbench 或 share flow 意外走 remote。

缓解：Milestone 4 仅在 `LLM_SPACE_ENABLE_REMOTE_RUNTIME=1` 下启用，且作为开发验证入口。Trace 和 share flow 暂不纳入验收；如发现它们因 default runtime 受影响，记录到 Milestone 6 的 per-workspace runtime 绑定设计中。

风险 4：SSE parser 边界错误导致 stream 卡住。

缓解：RemoteRuntimeClient 单测使用 fake server 输出 `[START]`、JSON event、`[DONE]`，验证 async iterator/回调能结束。真实模型调用不是本里程碑硬验收。

### Milestone 4 建议拆分顺序

1. 把 remote protocol 类型从 `apps/server/src/rpc-contract.ts` 上移到 `packages/runtime/src/remote-protocol.ts`，server 改用共享协议。
2. 修改 `RuntimeRouter` 支持 default runtime，并补测试。
3. 修改 renderer `LocalFileSystemClient` / `createRpcTransport` 默认不传 `runtimeId`。
4. 新增 `RemoteRuntimeClient`，实现 `/health`、`/rpc`、`/stream`。
5. 新增 env config parser 和 `registerManualRemoteRuntime()`。
6. Desktop composition root 根据 env 注册 remote runtime，并可设为 default。
7. 新增 `getDefaultRuntime` RPC，便于调试。
8. 补单测，运行 typecheck/test/lint。
9. 启动 server + Desktop 手动验证远程 workspace 写入。

[2026-07-20 11:23:32+08:00] 修改说明：追加 Milestone 4 详细方案草案，等待用户 Review。理由：用户确认 Milestone 3 后要求设计 Desktop RemoteRuntimeClient，且该里程碑需要先明确默认 runtime、协议共享、环境变量入口和手动验收边界。

---

[2026-07-20 11:45:00+08:00] 修改说明：完成 Milestone 4 的代码实现和自动验证，新增 RemoteRuntimeClient、环境变量注册、RuntimeRouter 默认 runtime、共享 remote protocol，并记录真实 server smoke test。理由：用户确认 Milestone 4 后继续实现 Desktop RemoteRuntimeClient。

---

## Milestone 5 验证记录

- `bun run typecheck`：通过，零错误。
- `bun run test`：100 pass，0 fail，0 skipped。
- `bun run lint`：通过，零错误。
- `git diff --check`：通过，无 whitespace error。
- 新增 SSH bootstrap 单测覆盖：配置解析、SSH target/base args/tunnel args、shell quote、端口候选、RuntimeRouter/RemoteRuntimeClient 既有路径。
- 未执行真实 SSH 人工验收：当前环境没有用户提供的远端 SSH host/repo。该项需用户在真实 Mac + Linux 环境中按 Milestone 5 手动验收命令执行。

## Milestone 5 细化方案 Review 草案

本节是在 Milestone 4 完成后追加的 Milestone 5 执行方案。总目标仍然是构建 SSH Remote Runtime 能力。Milestone 5 的职责是把 Milestone 4 的“手动启动 server + 手动填写 URL/token”推进为“Desktop 通过 SSH 自动启动远端 server、建立本地 tunnel、注册 RemoteRuntimeClient”。本里程碑仍不做正式 Remote Servers UI，不做 server tarball/release 自动安装；先用环境变量驱动 SSH bootstrap，验证端到端 SSH 自动化链路。

### Milestone 5 的目标

完成后，开发者在有 UI 的本机执行：

```sh
LLM_SPACE_ENABLE_REMOTE_RUNTIME=1 \
LLM_SPACE_REMOTE_BOOTSTRAP=ssh \
LLM_SPACE_REMOTE_SSH_HOST=<linux-host> \
LLM_SPACE_REMOTE_SSH_USER=<user> \
LLM_SPACE_REMOTE_SSH_PORT=22 \
LLM_SPACE_REMOTE_SSH_IDENTITY_FILE=~/.ssh/id_ed25519 \
LLM_SPACE_REMOTE_REPO=/path/to/llm-space \
LLM_SPACE_REMOTE_HOME=/tmp/llm-space-server-test \
LLM_SPACE_ACTIVE_RUNTIME_ID=remote:ssh-manual \
mise run dev
```

Desktop bun 进程自动完成：

```text
1. 读取 SSH bootstrap 环境变量
2. 用系统 ssh 连接远端
3. 远端启动 apps/server，绑定 127.0.0.1:<remotePort>
4. 本地建立 ssh -N -L 127.0.0.1:<localPort>:127.0.0.1:<remotePort>
5. 通过 http://127.0.0.1:<localPort>/health 校验 server
6. 注册 RemoteRuntimeClient(remote:ssh-manual)
7. 如 ACTIVE_RUNTIME_ID 匹配，则设为 RuntimeRouter default
```

用户在 Desktop UI 中新建/保存 thread 后，文件写到远端：

```text
<LLM_SPACE_REMOTE_HOME>/workspace
```

而不是本机 `~/.llm-space/workspace`。

### 当前前置状态

已完成：

```text
Milestone 1: RuntimeRouter + LocalRuntime
Milestone 2: packages/runtime
Milestone 3: apps/server，可用 /health /rpc /stream
Milestone 4: Desktop RemoteRuntimeClient，可手动 URL/token 连接 server
```

当前仍缺：

```text
SSH 连接配置解析
SSH 命令封装
远端 server 启动命令
本地端口选择
ssh -L tunnel 生命周期管理
启动失败诊断
进程退出清理
```

### 关键技术决策

#### 决策 1：Milestone 5 使用系统 OpenSSH，不引入 JS SSH 库

使用系统命令：

```text
ssh
```

不引入 `ssh2` 或其他 JS SSH 库。理由：用户已有 `~/.ssh/config`、ProxyCommand、JumpHost、ssh-agent、known_hosts、私钥 passphrase 等复杂行为，OpenSSH 已经解决。JS SSH 库会绕过这些成熟能力，增加兼容成本。

Milestone 5 的 SSH 配置第一版只拼接非交互参数：

```text
ssh -p <port>
ssh -i <identityFile>
ssh -o BatchMode=yes
ssh -o ExitOnForwardFailure=yes
ssh -o ServerAliveInterval=15
ssh -o ServerAliveCountMax=2
```

说明：

- `BatchMode=yes`：避免 Desktop 进程卡在密码/passphrase 交互。第一版要求 ssh-agent 或无 passphrase key 可用。
- `ExitOnForwardFailure=yes`：tunnel 建立失败时立即退出，避免误以为 remote 可用。
- 不禁用 host key 校验；known_hosts 行为交给 OpenSSH。

#### 决策 2：Milestone 5 不上传 server 包，远端先要求已有源码仓库

本阶段不做 server tarball、rsync/scp 上传、版本自动安装。远端要求已经有同一分支源码仓库，并通过：

```text
LLM_SPACE_REMOTE_REPO=/path/to/llm-space
```

指定。Desktop 远端启动命令是：

```sh
cd <repo> && bun --filter @llm-space/server dev -- \
  --host 127.0.0.1 \
  --port <remotePort> \
  --token <token> \
  --home <remoteHome>
```

理由：当前阶段要验证 SSH bootstrap 和 tunnel，不要同时引入打包/上传/升级。server 安装和版本兼容属于 Milestone 8。

#### 决策 3：token 由 Desktop 本地生成，不来自用户配置

Milestone 4 手动模式用固定 `LLM_SPACE_REMOTE_RUNTIME_TOKEN`。Milestone 5 SSH bootstrap 模式中 token 应由 Desktop bun 进程生成：

```ts
crypto.randomUUID() + random bytes
```

并通过远端启动命令传入：

```text
--token <generated-token>
```

本地 `RemoteRuntimeClient` 使用同一个 token 连接 tunnel URL。token 不写入普通日志；错误日志中也要避免打印完整 token。

#### 决策 4：本地端口自动选择，远端端口可配置或默认

环境变量：

```text
LLM_SPACE_REMOTE_LOCAL_PORT       可选；默认自动选择空闲端口
LLM_SPACE_REMOTE_SERVER_PORT      可选；默认 39123
```

推荐默认：

- remote server port：`39123`
- local tunnel port：自动选择空闲端口，减少本地端口冲突

如果用户显式设置 local port，冲突时启动失败并报明确错误。

#### 决策 5：先用 long-running ssh remote command 启动 server，不做远端 daemon

Milestone 5 远端 server 进程依附于一个 SSH session：

```text
ssh <host> 'cd <repo> && bun --filter @llm-space/server dev -- ...'
```

另开一个 SSH session 建 tunnel：

```text
ssh -N -L <localPort>:127.0.0.1:<remotePort> <host>
```

Desktop shutdown 时同时 kill 两个 child process。

不使用 `nohup` / systemd / daemon。理由：daemon 会引入 pidfile、日志、旧进程清理、版本升级、孤儿进程等问题，属于产品化阶段。

#### 决策 6：bootstrap 成功以 tunnel health check 为准

启动顺序：

```text
1. spawn remote server ssh command
2. 等待远端 stdout 包含 listening 或等待短暂时间
3. spawn tunnel ssh command
4. 轮询 http://127.0.0.1:<localPort>/health
5. health 200 + protocolVersion 匹配 = bootstrap 成功
```

不要只凭 SSH process 未退出判断成功。唯一可信信号是通过 tunnel 的 `/health`。

### 新增环境变量设计

Milestone 5 新增 SSH bootstrap 配置：

```text
LLM_SPACE_REMOTE_BOOTSTRAP=ssh
LLM_SPACE_REMOTE_SSH_HOST=<host>                 必填
LLM_SPACE_REMOTE_SSH_USER=<user>                 可选；缺省使用 ssh config/current user
LLM_SPACE_REMOTE_SSH_PORT=<port>                 可选；默认 22
LLM_SPACE_REMOTE_SSH_IDENTITY_FILE=<path>        可选
LLM_SPACE_REMOTE_SSH_EXTRA_ARGS=<string>         可选；谨慎支持，见风险
LLM_SPACE_REMOTE_REPO=<remote repo path>         必填
LLM_SPACE_REMOTE_HOME=<remote server home>       默认 ~/.llm-space-server
LLM_SPACE_REMOTE_SERVER_PORT=<remote port>       默认 39123
LLM_SPACE_REMOTE_LOCAL_PORT=<local port>         可选；缺省自动选择
LLM_SPACE_REMOTE_RUNTIME_ID=remote:ssh-manual    可选；默认 remote:ssh-manual
LLM_SPACE_REMOTE_RUNTIME_NAME=<name>             可选；默认 SSH <host>
LLM_SPACE_ACTIVE_RUNTIME_ID=remote:ssh-manual    可选；匹配时设为 default
```

和 Milestone 4 手动 URL 模式的关系：

- `LLM_SPACE_REMOTE_BOOTSTRAP=ssh`：走 SSH bootstrap。
- 未设置 `LLM_SPACE_REMOTE_BOOTSTRAP`：仍支持 Milestone 4 的手动 URL/token。
- 两套模式都要求 `LLM_SPACE_ENABLE_REMOTE_RUNTIME=1`。

### 文件级修改计划

新增：

```text
apps/desktop/src/bun/remote/ssh-bootstrap-config.ts
apps/desktop/src/bun/remote/ssh-bootstrap-config.test.ts
apps/desktop/src/bun/remote/ssh-command.ts
apps/desktop/src/bun/remote/ssh-command.test.ts
apps/desktop/src/bun/remote/port.ts
apps/desktop/src/bun/remote/port.test.ts
apps/desktop/src/bun/remote/ssh-remote-runtime.ts
apps/desktop/src/bun/remote/ssh-remote-runtime.test.ts
apps/desktop/src/bun/remote/process-utils.ts
```

修改：

```text
apps/desktop/src/bun/remote/remote-runtime-manager.ts
apps/desktop/src/bun/remote/index.ts
apps/desktop/src/bun/app/start-desktop-app.ts
```

可能修改：

```text
apps/desktop/src/bun/remote/remote-runtime-client.ts
```

### 模块职责设计

#### `ssh-bootstrap-config.ts`

定义：

```ts
export interface SshRemoteRuntimeConfig {
  id: RuntimeId;
  name: string;
  host: string;
  user?: string;
  port: number;
  identityFile?: string;
  extraArgs: string[];
  remoteRepo: string;
  remoteHome: string;
  remoteServerPort: number;
  localPort?: number;
  makeDefault: boolean;
}

export function readSshRemoteRuntimeConfig(
  env: NodeJS.ProcessEnv
): SshRemoteRuntimeConfig | null;
```

校验：

- feature flag 未开：返回 null。
- `LLM_SPACE_REMOTE_BOOTSTRAP !== "ssh"`：返回 null。
- host 缺失：抛明确错误。
- remoteRepo 缺失：抛明确错误。
- port 非 1-65535：抛明确错误。
- runtime id 必须 `remote:` 开头。
- identityFile 支持 `~` 展开。

#### `ssh-command.ts`

职责：构造 SSH 参数，不执行命令。

```ts
export function buildSshBaseArgs(config: SshRemoteRuntimeConfig): string[];
export function buildSshTarget(config: SshRemoteRuntimeConfig): string;
export function shellQuote(value: string): string;
export function buildRemoteServerCommand(input: {
  remoteRepo: string;
  host: string;
  port: number;
  token: string;
  home: string;
}): string;
```

要求：

- 所有远端路径和 token 都必须 shell quote。
- 不在日志中打印完整 token。
- SSH target：有 user 时 `<user>@<host>`，否则 `<host>`。

#### `port.ts`

职责：选择本地空闲端口。

```ts
export async function findFreePort(host = "127.0.0.1"): Promise<number>;
```

实现：用 Node `net.createServer()` listen port 0，拿到实际 port 后 close。

#### `process-utils.ts`

职责：封装 child process 生命周期。

```ts
export interface ManagedProcess {
  label: string;
  child: ChildProcess;
  stop(): Promise<void>;
}

export function spawnManagedProcess(...): ManagedProcess;
```

stop 策略：

1. `child.kill("SIGTERM")`
2. 等待 N ms
3. 未退出则 `SIGKILL`

#### `ssh-remote-runtime.ts`

核心 bootstrap：

```ts
export interface SshRemoteRuntimeHandle {
  client: RemoteRuntimeClient;
  stop(): Promise<void>;
}

export async function startSshRemoteRuntime(
  config: SshRemoteRuntimeConfig
): Promise<SshRemoteRuntimeHandle>;
```

流程：

1. 生成 token。
2. 选择 localPort。
3. spawn remote server SSH command。
4. spawn tunnel SSH command。
5. 轮询 `/health`。
6. 创建并 connect `RemoteRuntimeClient`。
7. 返回 handle。

健康检查轮询：

```text
timeout: 30s
interval: 500ms
```

失败时：

- 停掉 remote server process。
- 停掉 tunnel process。
- 抛含阶段信息的错误，例如：
  ```text
  SSH remote runtime bootstrap failed during health-check: <reason>
  ```

#### `remote-runtime-manager.ts`

现有函数：

```ts
registerManualRemoteRuntime(...)
```

改为：

```ts
export interface RegisteredRemoteRuntime {
  client: RemoteRuntimeClient;
  stop(): Promise<void> | void;
}

export async function registerConfiguredRemoteRuntime(...): Promise<RegisteredRemoteRuntime | null>;
```

逻辑：

```text
if SSH config exists -> startSshRemoteRuntime -> register client
else manual URL config -> existing manual flow
else null
```

`start-desktop-app.ts` 只调用统一函数。

### 验证方式

#### 自动测试

新增单测覆盖：

```text
ssh-bootstrap-config.test.ts
ssh-command.test.ts
port.test.ts
ssh-remote-runtime.test.ts（mock spawn/fetch，不连真实 SSH）
```

`ssh-bootstrap-config.test.ts`：

- feature flag 未开返回 null。
- bootstrap 非 ssh 返回 null。
- 缺 host/repo 抛错。
- 默认值正确。
- active id 匹配时 makeDefault true。

`ssh-command.test.ts`：

- 构造 target：host / user@host。
- 包含 `BatchMode=yes`、`ExitOnForwardFailure=yes`。
- identityFile 展开后传 `-i`。
- remote server command 对 path/token 做 shell quote。

`port.test.ts`：

- `findFreePort()` 返回 1-65535。
- 返回端口可被重新 listen。

`ssh-remote-runtime.test.ts`：

- 用依赖注入 mock `spawn`、`findFreePort`、`fetchHealth`。
- 验证顺序：server ssh -> tunnel ssh -> health -> client。
- health 失败时 stop 两个 process。
- tunnel process 早退时 bootstrap 失败。

#### 手动验收：真实 SSH

前提：远端 Linux 已有同分支源码和依赖：

```sh
cd /path/to/llm-space
bun install
bun --filter @llm-space/server dev -- --help
```

本机 Desktop 启动：

```sh
LLM_SPACE_ENABLE_REMOTE_RUNTIME=1 \
LLM_SPACE_REMOTE_BOOTSTRAP=ssh \
LLM_SPACE_REMOTE_SSH_HOST=<linux-host> \
LLM_SPACE_REMOTE_SSH_USER=<user> \
LLM_SPACE_REMOTE_SSH_PORT=22 \
LLM_SPACE_REMOTE_SSH_IDENTITY_FILE=~/.ssh/id_ed25519 \
LLM_SPACE_REMOTE_REPO=/path/to/llm-space \
LLM_SPACE_REMOTE_HOME=/tmp/llm-space-server-ssh-test \
LLM_SPACE_ACTIVE_RUNTIME_ID=remote:ssh-manual \
mise run dev
```

验收：

1. Desktop 启动不要求手动启动 server。
2. Desktop log 显示 remote runtime registered。
3. 新建 thread 并保存。
4. 远端执行：

```sh
find /tmp/llm-space-server-ssh-test/workspace -type f -name '*.json' -maxdepth 4
```

能看到新文件。

5. 退出 Desktop 后，远端 server 进程和本地 tunnel 进程退出。远端可验证：

```sh
ps aux | grep llm-space-server | grep -v grep
```

### 自动验证命令

Milestone 5 完成后必须运行：

```sh
bun run typecheck
bun run test
bun run lint
git diff --check
```

如果环境允许，继续运行：

```sh
mise run build:canary
```

### 刚性验收标准

- `bun run typecheck` 零错误。
- `bun run test` 全部 PASS，0 skipped。
- `bun run lint` 零错误。
- `git diff --check` 无 whitespace error。
- 不设置 `LLM_SPACE_REMOTE_BOOTSTRAP=ssh` 时，Milestone 4 手动 URL/token 模式仍可用。
- 设置 SSH bootstrap env 后，不需要手动启动 server，Desktop 能注册 `remote:ssh-manual`。
- SSH bootstrap 成功后，RemoteRuntimeClient 的 baseUrl 是本地 loopback tunnel URL，而不是远端公网 IP。
- SSH bootstrap 失败时错误包含阶段：`config` / `server-start` / `tunnel-start` / `health-check`。
- Desktop shutdown 时关闭 remote server SSH process 和 tunnel SSH process。
- 远端 server 绑定 `127.0.0.1`，不绑定 `0.0.0.0`。
- token 不以完整值出现在普通日志中。

### 不在 Milestone 5 做的事情

- 不做正式 Remote Servers UI。
- 不做密码输入 UI。
- 不做 keychain 存储。
- 不做 server 包上传/安装。
- 不做远端 daemon/systemd。
- 不做多 remote server 管理。
- 不做 Windows remote。
- 不做公网 HTTP 直连。
- 不解决完整远程 tool execution；仍沿用 Milestone 4 已定义的未实现方法报错策略。

### 风险与缓解

风险 1：SSH 命令卡住等待密码或 passphrase。

缓解：使用 `BatchMode=yes`，第一版要求 ssh-agent/无 passphrase key。失败时明确提示：

```text
SSH authentication failed or requires interaction. Configure ssh-agent or use a key without interactive passphrase for this test.
```

风险 2：远端已有旧 server 进程占用 `39123`。

缓解：允许 `LLM_SPACE_REMOTE_SERVER_PORT` 配置；health check 失败时输出 remote port。后续 Milestone 8 再做自动端口选择/远端旧进程管理。

风险 3：远端没有 bun 或依赖未安装。

缓解：Milestone 5 错误信息明确包含 remote command stderr；文档要求远端先 `bun install`。自动安装留给 Milestone 8。

风险 4：shell quoting 错误导致路径或 token 被解释。

缓解：集中实现 `shellQuote()` 并单测覆盖空格、单引号、`$`、`;`。

风险 5：进程清理不彻底留下 orphan server。

缓解：server 进程依附 SSH session，不 daemonize；Desktop shutdown 对 managed processes 执行 SIGTERM/SIGKILL。手动验收用 `ps` 检查。

风险 6：直接远端 IP HTTP 访问绕开 tunnel。

缓解：Milestone 5 设计中 RemoteRuntimeClient 只连接本地 loopback tunnel URL；远端 server command 固定 `--host 127.0.0.1`。

### Milestone 5 建议拆分顺序

1. 实现 `ssh-bootstrap-config.ts` + 单测。
2. 实现 `ssh-command.ts` + shell quote 单测。
3. 实现 `port.ts` + 单测。
4. 实现 `process-utils.ts`。
5. 实现 `ssh-remote-runtime.ts`，先用依赖注入 mock 写单测。
6. 改 `remote-runtime-manager.ts`，统一 manual URL 和 SSH bootstrap 两种注册路径。
7. 改 `start-desktop-app.ts` shutdown 清理 remote handle。
8. 跑 typecheck/test/lint。
9. 用真实 SSH 环境手动验收。
10. 更新 ExecPlan 的进度、意外发现和验证记录。

[2026-07-20 17:51:37+08:00] 修改说明：追加 Milestone 5 SSH bootstrap 详细方案草案，等待用户 Review。理由：用户要求详细开始 Milestone 5 设计，且 SSH bootstrap 会引入进程、端口、远端命令、安全和清理边界，必须先明确方案再实现。

---

[2026-07-20 18:15:00+08:00] 修改说明：完成 Milestone 5 环境变量驱动的 SSH bootstrap 实现与自动验证，保留真实 SSH 手动验收为用户环境验证项。理由：SSH bootstrap 需要真实远端机器；当前代码层已覆盖配置、命令、进程、端口、health-check 和 manager 集成。

---

[2026-07-20 18:45:00+08:00] 修改说明：完成 Milestone 6 第一阶段实现（Remote Servers 配置/RPC/Settings 页面），并记录剩余 runtime-aware workspace/thread 绑定工作。理由：Milestone 6 范围较大，先交付可配置远程服务器的 UI 与 bun 管理层。
