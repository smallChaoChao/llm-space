# 修复 Remote Runtime UI 隔离与 SSH 报错体验

本 ExecPlan 是一份活文档。进度追踪、意外发现、决策日志和成果与复盘章节必须随工作推进持续更新。

**创建时代码基线：**

- 分支：`feat/support-ssh-remote`
- Commit SHA：`b3d9368bca0ee8dcf5236aea02f4b9d67abb6a41`
- 时区：`+08:00`（PRC）
- 提交策略：原子提交。该任务是 Remote Runtime Milestone 6 的收口修复，完成后以一个语义完整提交提交。

## 目标与全局视角

完成后，LLM Space Desktop 的 SSH Remote Runtime 连接、断开、设置编辑和状态展示形成一致的 runtime 切换语义：任一时刻只有一个 SSH remote 处于连接态；从 remote 断开或切换到另一个 remote 时，远程 thread tab 自动关闭，workspace 回到 local 并从 local 重新加载；从 Settings / Remote 点击 Connect 成功后设置窗口自动关闭，主界面切到 remote，并由 remote 重新加载文件树和模型等 runtime 级配置；remote server 名称、host 等信息更新后，侧边栏 Remote Status 能实时反映最新配置；SSH host key 变更这类 OpenSSH 安全错误显示为准确、可操作的短错误，而不是把整段 ssh 输出堆到 toast 里。

用户可观察行为：

1. 编辑 remote server 的 name/host/user 后，外部 Remote Status 显示同步更新，不需要关闭重开应用。
2. 点击 Disconnect 或连接另一个 SSH host 后，已打开的 remote thread tab 全部关闭；local thread tab 可保留；左侧文件树回到 local 并重新加载 local workspace。
3. 在 Settings / Remote 点击 Connect 成功后，Settings 自动关闭；主界面切到新 remote，并从 remote 加载 workspace / runtime 设置。
4. Settings 左侧导航中 Remote 排在 Account 下面。
5. host key mismatch / forwarding disabled due to host key check failure 显示明确文案：说明 SSH host key 校验失败、known_hosts 的冲突行、用户应确认主机身份后修复 known_hosts；不误报为 server 未安装。
6. 已连接 host1 时再连接 host2，会自动断开 host1，再连接 host2；连接成功后只有 host2 为默认 runtime。

## 进度追踪

- [x] (2026-07-21 18:44:03+08:00) Phase 1: 探索调研完成，定位 Remote Status、Settings runtime 快照、tab runtime 绑定、SSH bootstrap 报错和多连接管理的主要根因
- [x] (2026-07-21 19:05:00+08:00) Phase 2: 方案撰写完成
- [x] (2026-07-21 19:10:00+08:00) Phase 3: 用户 Review 通过，计划已从 `proposal/` 移动到 `active/`
- [x] (2026-07-21 19:18:00+08:00) Milestone 1: 建立 renderer 内 remote/runtime 状态刷新事件与 Remote Status 同步刷新动作
- [x] (2026-07-21 19:35:00+08:00) Milestone 2: 修复 Settings / Remote 连接成功后的关闭与 remote 数据重载
- [x] (2026-07-21 19:35:00+08:00) Milestone 3: 修复断开/切换 remote 时 thread tab 自动关闭与 local 重载
- [x] (2026-07-21 19:52:00+08:00) Milestone 4: 后端保证 SSH remote 单连接，并优化 SSH 安全错误分类
- [x] (2026-07-21 20:08:00+08:00) Milestone 5: 调整 Settings 导航顺序与补齐测试
- [x] (2026-07-21 20:28:00+08:00) Phase 4.5: 独立代码审计完成，4 个真实发现均已修复
- [x] (2026-07-21 20:30:00+08:00) Phase 5: 结果汇报完成
- [x] (2026-07-21 23:15:00+08:00) Phase 7: 代码提交（用户确认后执行）
- [x] (2026-07-21 23:05:00+08:00) Phase 6: 后续修复完成，处理 disconnect 后 connect 远端 39123 端口占用与 local/remote runtime 切换后 thread tab 未按目标 workspace 重载的问题

## 意外发现

- 观察：`RemoteStatus` 只在 `runtimeId` 变化时调用一次 `listRemoteServers()`，没有监听 remote 配置变更或连接状态变更。
  证据：`apps/desktop/src/components/remote-status.tsx` 的 `useEffect` 依赖只有 `[runtimeId]`，内部把匹配 `runtimeId` 的 server 存到本地 `server` state。

- 观察：Settings 打开时只读取一次 default runtime，打开期间 connect 成功后不会重新读取 runtime，也不会主动关闭 Settings。
  证据：`apps/desktop/src/components/settings/settings-dialog.tsx` 的 `useEffect` 依赖 `[open]`；`RemoteServersPage.run()` 只 `setServers(next)` 和 `setSelectedId(id)`。

- 观察：主界面的 `workspaceRuntimeId` 只在 Settings 关闭后刷新，导致 Settings 内 connect 后页面仍按打开时的 local runtime 渲染。
  证据：`apps/desktop/src/app/page.tsx` 中 `useEffect(() => { if (settingsOpen) return; refreshRuntimes({ syncDefault: true }) }, [settingsOpen])` 明确跳过 Settings 打开期间刷新。

- 观察：已打开 thread tab 有 `runtimeId` 字段，但断开 remote 时不会按 runtime 批量关闭。
  证据：`apps/desktop/src/components/thread-tabs/use-thread-tabs.ts` 提供 `closeAll()`、`handleRemove()` 等能力，但没有 `closeRuntime(runtimeId)`；`RemoteStatus.onDisconnected` 只 `setWorkspaceRuntimeId("local")` 和 `refreshRuntimes()`。

- 观察：SSH bootstrap 早退错误把 `ssh` 输出原样拼到 `SSH remote runtime bootstrap failed during ...`，没有对 OpenSSH 的 host key mismatch 做分类。
  证据：`apps/desktop/src/bun/remote/ssh-remote-runtime.ts` 的 `_waitForProcessAlive()` 直接抛出 `${process.output()}`；`process-utils.ts` 收集 stdout/stderr 最近 20000 字符。

- 观察：当前 `RemoteServerManager.connectServer()` 只处理同一个 server 的重复连接，没有自动断开其它已连接 SSH remote。
  证据：`apps/desktop/src/bun/remote/remote-server-manager.ts` 中 `connectServer(id)` 只读取 `const existing = this._connections.get(id)`，没有遍历 `_connections` 断开其它 id。


- 观察：Disconnect 只关闭本地 SSH 进程，但远端 `bun --filter @llm-space/server dev` 不一定随 SSH session 退出，导致下一次 Connect 仍在远端 39123 启动 server，出现 `Is port 39123 in use?`。
  证据：`startSshRemoteRuntime().stop()` 只 `client.shutdown()` 和 stop ssh/tunnel 本地进程；远端 server 没有显式 shutdown RPC。

- 观察：从 local Connect 到 remote 时，local thread tab 被保留，导致主窗口仍显示 local 文件内容，不符合“重新从正确位置加载所有配置文件刷新窗口”的产品语义。
  证据：此前决策只关闭 remote thread tab；`switchWorkspaceRuntime(remote)` 不关闭 `local` runtime tabs。

## 决策日志

- 决策：本次不引入全局状态库；采用浏览器内轻量 CustomEvent + RPC 返回结果刷新，解决 renderer 内远程状态同步。
  理由：问题只发生在一个 renderer 进程内，状态源仍是 bun 侧 `RemoteServerManager`。用 Zustand 或 React Query 全局化会扩大改动面；事件只作为“配置已变化，请重新读取”的失效通知，长期成本更低。
  日期/作者：2026-07-21 / Codex

- 决策：主界面只自动关闭 remote thread tab，不自动关闭 local thread tab 或 trace tab。
  理由：用户问题是 remote/local 未隔离。关闭 remote thread 是必要隔离；local thread 和 trace 不依赖被断开的 remote runtime，强关会制造无关数据损失和体验回退。
  日期/作者：2026-07-21 / Codex

- 决策：Settings / Remote Connect 成功后自动关闭 Settings，而不是在 Settings 内热切 runtime 页面。
  理由：用户明确要求自动关闭；同时这避免 Settings 内多个 page 使用打开时 runtime 快照导致的半 local 半 remote 状态。关闭后由 Page 统一刷新 default runtime、文件树和模型数据，语义更清晰。
  日期/作者：2026-07-21 / Codex

- 决策：后端 `connectServer(host2)` 在连接 host2 前先断开所有其它 SSH remote；如果 host2 连接失败，默认 runtime 留在 local，而不是回滚 host1。
  理由：需求是“只能有一个 SSH”。连接 host2 前断 host1 可避免双 tunnel、双 server 长时间共存。失败时回滚 host1 会增加隐式副作用和启动耗时；更安全的状态是 local。
  日期/作者：2026-07-21 / Codex

- 决策：SSH host key mismatch 属于安全错误，文案必须要求用户先确认主机身份，再修复 known_hosts；不提供自动删除 known_hosts 的按钮。
  理由：OpenSSH 这类报错可能是真实中间人攻击。自动删除冲突行是短期方便但长期错误的安全设计。
  日期/作者：2026-07-21 / Codex


- 决策：runtime 切换采用“目标 workspace 重新加载”语义：connect remote 时关闭 local 与目标 remote 的旧 thread tabs；disconnect remote 时关闭 remote thread tabs。
  理由：thread tab 的内容来自某个 runtime 的 workspace 文件。跨 runtime 保留 tab 会让用户看到旧位置的文件，短期保留看似方便，但长期会制造 local/remote 混读和写错位置风险。
  日期/作者：2026-07-21 / Codex

- 决策：disconnect remote 时先通过远端 `/shutdown` 显式停止 server，再关闭 SSH server/tunnel 进程；shutdown 请求失败不阻塞本地清理。
  理由：端口占用根因是远端 server 生命周期缺少协议级关闭。依赖 SSH session 退出是隐式副作用，长期不可靠。
  日期/作者：2026-07-21 / Codex

## 成果与复盘

- Phase 4.5 独立审计发现 4 个真实问题，均已修复：
  1. Settings 内 disconnect/remove 当前 remote 未通知主页面，已新增 `onRemoteDisconnected` 通路，断开当前 runtime 时统一切回 local 并关闭 remote tabs。
  2. RemoteStatus stale disconnect 回调可能把新 remote 切回 local，已改为校验断开的 runtime 仍是当前 runtime 才切 local。
  3. `RemoteServerManager` connect/disconnect 无并发保护，已新增 `_operationQueue` 串行化远程连接生命周期操作，避免 SSH handle 泄漏和多 remote 注册竞态。
  4. SSH host key 文案在 `server-start`/`health-check` 阶段不精确，已按 stage 输出不同影响说明，并在 health-check 进程早退时复用分类器。
- 验证结果：`bun test apps/desktop/src/bun/remote/ssh-error.test.ts apps/desktop/src/bun/remote/remote-server-manager.test.ts` 通过，4 pass / 0 fail；`mise run typecheck` 通过；`mise run lint` 通过；`mise run test` 通过，105 pass / 0 fail。

- Milestone 1 已完成：`apps/desktop/src/client/remote-servers.ts` 新增 remote changed 失效事件；remote 配置/连接 mutation 成功后自动通知；`RemoteStatus` 订阅事件并按 `runtimeId` 重新读取 server view，解决 name/host 等外部状态不实时更新。
- Milestone 2 已完成：`RemoteServersPage` 在 Connect 成功后把连接 runtime 回传给 `SettingsDialog` / `Page`；主界面关闭 Settings、切换 workspace runtime、失效 `fs`/`thread` query 并刷新模型。
- Milestone 3 已完成：`useThreadTabs` 新增 `closeRuntime(runtimeId)`；主界面切换离开旧 remote 或断开 remote 时自动关闭对应 remote thread tab，保留 local thread 和 trace tab。
- Milestone 4 已完成：`RemoteServerManager` 连接新 SSH server 前自动断开其它连接；同一 server 已连接时会切回 default runtime；新增 `ssh-error.ts` 分类 OpenSSH host key 安全错误，toast 文案变为短、准确、可操作。
- Milestone 5 已完成：Settings 左侧 `Remote` 已移动到 `Account` 下方；新增 remote manager 和 SSH error 单测；`bun test`、`mise run typecheck`、`mise run lint` 均通过。

- Phase 6 后续修复：新增 server `/shutdown` 端点与 `RemoteRuntimeClient.shutdownRemote()`；SSH remote handle stop 时先请求远端 server 自停，避免 disconnect 后 connect 因远端 39123 残留而失败。主页面 `switchWorkspaceRuntime()` 改为跨 runtime 切换时关闭旧 runtime thread tabs；connect 到 remote 时额外清理目标 remote 的旧 tabs，确保窗口从目标 workspace 重新加载。补充验证：`bun test apps/desktop/src/bun/remote/remote-runtime-client.test.ts apps/server/src/http-server.test.ts apps/desktop/src/bun/remote/remote-server-manager.test.ts` 通过，8 pass / 0 fail；`mise run typecheck` 通过；`bun run lint -- <changed files>` 通过。

## 上下文与方向

当前仓库在 `feat/support-ssh-remote` 分支上，Remote Runtime 正处于 SSH 支持开发阶段。已有关键结构：

- `packages/runtime/src/runtime/runtime-router.ts`：bun 侧 runtime 注册、默认 runtime 切换和 `get(runtimeId)` 路由。
- `apps/desktop/src/bun/remote/remote-server-manager.ts`：持久化 remote server 配置，连接 SSH remote，注册 `remote:${id}` runtime，并设置 default runtime。
- `apps/desktop/src/components/settings/remote-servers-page.tsx`：Settings / Remote 页，负责增删改查和 Connect / Disconnect。
- `apps/desktop/src/components/remote-status.tsx`：侧边栏 remote 状态卡片，当前只按 `runtimeId` 首次加载 server 信息。
- `apps/desktop/src/app/page.tsx`：主页面状态，持有 `workspaceRuntimeId`，渲染 `FileSystemTreeView(runtimeId)`、`RemoteStatus(runtimeId)`、`ThreadTabs` 和 Settings overlay。
- `apps/desktop/src/components/thread-tabs/use-thread-tabs.ts`：维护已打开 tab，每个 thread tab 已包含 `runtimeId`，tab id 是 `thread:${runtimeId}:${path}`。
- `apps/desktop/src/components/settings/settings-dialog.tsx`：Settings 对话框，打开时读取 default runtime 并将其传给 Models/MCP/Network/Search/Skills 页面。
- `apps/desktop/src/bun/remote/ssh-remote-runtime.ts`：SSH bootstrap，启动远端 server 和 tunnel，等待 health check。

当前主要设计缺口不是 Runtime RPC 本身，而是 renderer 缺少统一的“remote connection changed”边界动作。长期正确的边界应是：bun 侧只负责远程连接事实；renderer 收到连接变化后，统一执行 runtime 切换、remote tab 关闭、Query cache 失效、文件树重载和 Settings 关闭。

## 工作计划

第一步建立 renderer 内的 remote 状态失效机制。新增一个小模块，例如 `apps/desktop/src/client/remote-events.ts` 或放在 `client/remote-servers.ts` 中，导出 `REMOTE_SERVERS_CHANGED_EVENT`、`notifyRemoteServersChanged()`、`subscribeRemoteServersChanged()`。`addRemoteServer`、`updateRemoteServer`、`removeRemoteServer`、`connectRemoteServer`、`disconnectRemoteServer`、`setDefaultRuntime` 成功后触发事件。事件不携带复杂状态，只表示“远程服务器列表或默认 runtime 已变化”，消费者重新通过 RPC 读取事实。

第二步让 `RemoteStatus` 实时刷新。它在 `runtimeId` 变化时刷新，也订阅 remote changed 事件刷新。编辑 server 后即使 `runtimeId` 不变，也能重新 `listRemoteServers()` 并显示新 name/host/user。Disconnect 成功后触发事件，再调用主界面传入的 `onDisconnected(runtimeId)`。

第三步让 `RemoteServersPage` 在 Connect 成功后通知父级关闭 Settings。给 `RemoteServersPage` 增加可选 prop，例如 `onConnected?: (runtimeId: RuntimeId) => void`。`run()` 区分 connect/disconnect/remove；connect 成功后从返回的 `RemoteServerView[]` 找到当前 id 的 `runtimeId`，调用 `onConnected(runtimeId)`。`SettingsDialog` 继续只负责布局，将 `onRemoteConnected` 向上传入；`Page` 收到后关闭 Settings、设置 `workspaceRuntimeId` 为新 remote、刷新 runtimes、失效 query cache，并切换到 files sidebar。

第四步为 `useThreadTabs` 增加 `closeRuntime(runtimeId)`。该方法只关闭 `type === "thread" && tab.runtimeId === runtimeId` 的 thread tab，保留 local thread 和 trace tab；若 active tab 被关闭，则选择剩余最后一个 tab 或 `null`。在 `Page` 中，remote disconnect 或 remote connected-to-new-host 时调用 `tabs.closeRuntime(oldRemoteRuntimeId)`。

第五步收敛主界面 runtime 切换。新增本地函数 `switchWorkspaceRuntime(nextRuntimeId, options)`，负责：关闭旧 remote tab（当旧 runtime 是 remote 且不同于 next）、设置 `workspaceRuntimeId`、失效 React Query 中与 `fs` / `thread` / runtime 配置相关的缓存、必要时切换 sidebar 到 files。对于断开 remote，调用 `switchWorkspaceRuntime("local")`。对于连接 remote，调用 `switchWorkspaceRuntime(newRuntimeId)`。这样 Settings 关闭和外部 RemoteStatus 断开走同一套路径。

第六步后端保证单 SSH 连接。修改 `RemoteServerManager.connectServer(id)`：如果要连接的 id 已 connected，直接 setDefaultRuntime 并返回；否则先断开 `_connections` 中所有其它 id（包括 connected/error/connecting 中有 handle 的），把 default runtime 置回 local，再启动目标 id。连接目标失败时保留错误在目标 id 上，default runtime 保持 local。补单测覆盖“连接 host2 会 stop host1 handle、unregister host1 runtime、只保留 host2”。如当前类不易注入 fake SSH handle，则可先重构为注入 `startRuntime` 函数，默认值仍是 `startSshRemoteRuntime`。

第七步优化 SSH 报错分类。新增函数，例如 `formatSshBootstrapError(stage, label, output)` 或 `classifySshError(output)`。匹配以下 OpenSSH 输出：

- `REMOTE HOST IDENTIFICATION HAS CHANGED`
- `Offending .* key in .*known_hosts:\d+`
- `forwarding disabled due to host key check failure`
- `Password authentication is disabled to avoid man-in-the-middle attacks`

命中后返回短文案：`SSH host key verification failed for <target>. OpenSSH reports that the host key changed. Confirm the host identity, then update <known_hosts path> (offending line <line>). Port forwarding was disabled by SSH, so LLM Space did not start the remote runtime.` 同时把原始输出保留在 Error `cause` 或 debug log（如当前无日志设施，则不展示到 toast）。其它错误继续展示现有 bootstrap stage，但截断输出到合理长度。

第八步调整 Settings 页面顺序。把 `PAGES` 中 Remote 项从 Network 后移到 Account 后，满足“Remote 在 Account 下面”。同时确认 `SettingsTab` 类型无需改动。

第九步验证。优先运行窄测试：新增/修改的 remote manager、ssh error classifier、thread tab hook 如能独立测试则运行对应测试；再运行 `mise run typecheck`。若依赖环境允许，再运行 `mise run test`。如果完整测试耗时或因网络/平台限制失败，必须记录失败原因和已通过的窄验证。

## 具体步骤

1. 在仓库根目录确认基线：

```sh
git status --short
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
```

预期：分支为 `feat/support-ssh-remote`；允许存在本计划文件和后续代码改动，不回滚用户无关改动。

2. 新增或修改 renderer remote 事件模块：

```sh
$EDITOR apps/desktop/src/client/remote-servers.ts
```

预期：所有 remote mutating client 方法成功后触发 remote changed 事件；list/get 方法不触发。

3. 修改 `RemoteStatus`：

```sh
$EDITOR apps/desktop/src/components/remote-status.tsx
```

预期：订阅 remote changed 事件；`runtimeId` 不变时也能刷新 name/host；disconnect 后把断开的 runtimeId 传给父级。

4. 修改 Settings remote 连接回调：

```sh
$EDITOR apps/desktop/src/components/settings/remote-servers-page.tsx
$EDITOR apps/desktop/src/components/settings/settings-dialog.tsx
```

预期：Connect 成功后调用父级回调；Settings 自动关闭。

5. 修改 tab hook 和 Page runtime 切换：

```sh
$EDITOR apps/desktop/src/components/thread-tabs/use-thread-tabs.ts
$EDITOR apps/desktop/src/app/page.tsx
```

预期：断开或切换 remote 时自动关闭旧 remote thread tab；`workspaceRuntimeId` 切换后文件树重新挂载并加载目标 runtime。

6. 修改 remote manager 和 SSH 错误分类：

```sh
$EDITOR apps/desktop/src/bun/remote/remote-server-manager.ts
$EDITOR apps/desktop/src/bun/remote/ssh-remote-runtime.ts
```

预期：单 SSH 连接由后端保证；host key mismatch 返回短、准确、可操作错误。

7. 调整 Settings 导航顺序：

```sh
$EDITOR apps/desktop/src/components/settings/settings-dialog.tsx
```

预期：Remote 在 Account 下面。

8. 补测试并运行：

```sh
bun test apps/desktop/src/bun/remote/ssh-command.test.ts apps/desktop/src/bun/remote/ssh-bootstrap-config.test.ts apps/desktop/src/bun/remote/remote-runtime-config.test.ts
mise run typecheck
mise run test
```

预期：测试全部 PASS，0 skipped；typecheck 零错误。

## 验证与验收

刚性验收标准：

1. 自动化：`mise run typecheck` 零错误。
2. 自动化：新增或修改的单测全部 PASS，0 skipped。
3. 自动化：如运行 `mise run test`，必须全部 PASS，0 skipped；如环境限制导致无法运行，需记录具体命令和失败原因。
4. 手动 UI：编辑已连接 remote server 的 name 后，侧边栏 Remote Status 在不重启、不重开应用的情况下显示新 name。
5. 手动 UI：Settings / Remote 点击 Connect 成功后，Settings 自动关闭；左侧文件树显示 remote workspace；Models/MCP/Search/Skills 再打开时读取 remote runtime。
6. 手动 UI：Remote Status 点击 Disconnect 后，所有 `runtimeId` 为该 remote 的 thread tab 关闭，local thread tab 保留；文件树回到 local workspace。
7. 手动 UI：已连接 host1，再在 Settings / Remote 连接 host2，host1 自动断开，host1 的 thread tab 关闭；只有 host2 的 Remote Status 显示 connected/default。
8. 手动 UI：连接 host key changed 的 SSH 目标时，toast 描述包含 `SSH host key verification failed`、`known_hosts` 路径和冲突行号；不显示“server 未安装”类误导文案。
9. 手动 UI：Settings 左侧导航顺序为 General、Account、Remote、Models...，Remote 位于 Account 下一项。

## 文档更新

已评估：本次是未完成 Remote Runtime 功能的 UI 隔离和错误体验修复，不改变公开文档中的使用说明；暂不更新用户文档。若实施后新增了用户可见 SSH host key 故障排查文案，可在后续 Remote Runtime 文档里补充，不作为本次必需项。

## 幂等性与恢复

- Renderer remote changed 事件是失效通知，可重复触发；消费者重新读取 RPC 事实，重复触发不会造成状态污染。
- `closeRuntime(runtimeId)` 可重复调用；目标 runtime 没有 tab 时 no-op。
- `connectServer(host2)` 在断开 host1 后连接 host2 失败，应保持 local 默认 runtime；用户可重新点击 host1 Connect 恢复。
- SSH bootstrap 失败路径必须 stop 已启动的 server/tunnel 进程；现有 `startSshRemoteRuntime()` catch 已 `Promise.all(processes.map(stop))`，修改时不得破坏。
- 若改动导致 Settings runtime 切换异常，可回退 renderer 事件模块和 Page 切换逻辑，不影响后端 remote 配置文件格式。

## 产物与备注

本计划创建时的关键定位结果：

- `RemoteStatus` stale 的直接原因：只依赖 `runtimeId`，没有配置更新订阅。
- Settings connect 后不刷新的直接原因：`SettingsDialog` 打开时只读取一次 runtime；`Page` 在 `settingsOpen` 为 true 时主动跳过 `refreshRuntimes()`。
- remote thread 不关闭的直接原因：tab 层已有 `runtimeId`，但没有 runtime 级关闭动作；disconnect 回调只切 `workspaceRuntimeId`。
- 多 SSH 连接的直接原因：`RemoteServerManager.connectServer()` 不断开其它 `_connections`。
- SSH 报错不准确的直接原因：早退错误原样拼接 OpenSSH 输出，没有安全错误分类。

## 接口与依赖

计划新增或调整的内部接口：

```ts
// apps/desktop/src/client/remote-servers.ts
export function subscribeRemoteServersChanged(listener: () => void): () => void;
export function notifyRemoteServersChanged(): void;

// apps/desktop/src/components/thread-tabs/use-thread-tabs.ts
interface ThreadTabs {
  closeRuntime(runtimeId: RuntimeId): void;
}

// apps/desktop/src/components/settings/remote-servers-page.tsx
export function RemoteServersPage(props: {
  onConnected?: (runtimeId: RuntimeId) => void;
}): JSX.Element;

// apps/desktop/src/components/settings/settings-dialog.tsx
export function SettingsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  onRemoteConnected?: (runtimeId: RuntimeId) => void;
}): JSX.Element;
```

计划新增纯函数（具体文件可按实现调整）：

```ts
function formatSshBootstrapFailure(input: {
  stage: "server-start" | "tunnel-start" | "health-check";
  label: string;
  output: string;
  target?: string;
}): string;
```

不新增外部 npm/bun 依赖。

[2026-07-21 19:05:00+08:00] 修改说明：创建计划草案，记录 6 个用户反馈问题的根因、修复路径、验收标准和实施顺序。理由：用户显式触发 `harness-exec-plan`，且任务涉及跨 renderer/bun/runtime 的中型改动，必须先方案 Review 再实现。

[2026-07-21 19:10:00+08:00] 修改说明：用户确认方案，计划进入 active 阶段。理由：Phase 3 Review 已通过，可以开始实现。

[2026-07-21 19:18:00+08:00] 修改说明：完成 renderer remote changed 事件和 Remote Status 订阅刷新。理由：Remote Status 的状态源应以 bun 侧列表为准，renderer 事件只做失效通知。

[2026-07-21 19:35:00+08:00] 修改说明：完成 Settings Connect 关闭、主界面 runtime 切换、remote thread 自动关闭和 Remote 导航顺序调整。理由：remote/local 隔离必须在一个主界面切换边界内完成，避免 Settings 和 workspace 使用不同 runtime 快照。

[2026-07-21 19:52:00+08:00] 修改说明：完成后端单 SSH 连接约束和 SSH host key 错误分类。理由：单连接必须由状态源头保证，host key mismatch 属于安全错误，必须优先给准确可操作文案。

[2026-07-21 20:08:00+08:00] 修改说明：完成测试验证和 lint/typecheck。理由：功能改动已覆盖自动化验证，进入独立审计前需要先保证基础质量门禁通过。

[2026-07-21 20:28:00+08:00] 修改说明：根据独立审计修复 Settings 断开/删除当前 remote、RemoteStatus stale disconnect、RemoteServerManager 并发连接泄漏、SSH host key 分阶段文案和 health-check 分类遗漏。理由：审计发现均为真实 runtime lifecycle 风险，必须在汇报前修复。

[2026-07-21 20:30:00+08:00] 修改说明：完成最终验证和结果汇报记录。理由：代码、测试、lint、typecheck 均已达成计划验收。


[2026-07-21 23:05:00+08:00] 修改说明：根据用户后续反馈进入 Phase 6。修复 disconnect 后 connect 因远端 server 未显式关闭导致的 39123 端口占用；调整 runtime 切换语义为关闭旧 workspace thread tabs 并重新从当前 runtime 加载配置/文件树/模型。理由：remote server 生命周期和 workspace UI 生命周期必须有清晰边界，不能依赖隐式 SSH session 清理或保留跨 runtime 的旧 tab。

[2026-07-21 23:15:00+08:00] 修改说明：用户确认提交 Git，Phase 7 标记完成并准备创建原子提交。理由：本轮 Phase 6 修复已通过测试、typecheck 和 lint 验证。
