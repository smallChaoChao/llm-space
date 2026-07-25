# Remote Runtime 导入后跨 workspace tab 串线与断开白屏修复计划

本 ExecPlan 是自包含的活文档。后续实现时，必须随着每个里程碑推进同步更新进度追踪、意外发现、决策日志和成果与复盘。

**当前计划版本：**
- 创建时间：`2026-07-25 23:41:02+08:00`
- 分支：`feat/support-ssh-remote`
- Git 基线：`7e1f93577129dd77d1d970ca8b176fd94d8157d0`
- 时区：PRC (`+08:00`)
- 提交策略：用户确认计划后，以一个语义完整的原子提交修复；不处理已有 active plan 的归档、不切 release、不改无关 remote SSH 流程。

## 目标与全局视角

用户在客户端测试 SSH Remote Runtime 时观察到两个问题：

1. 连接远程服务器后，把本地 thread JSON 拖入窗口执行 import。import 后，顶部 tab 区出现了本地其他 thread 的 tab，但左侧文件树没有对应文件。文件树与 tab 所属 workspace 不一致。
2. 此时点击右下角 `Disconnect` 后页面白屏；重启后仍白屏。该问题属于高严重度，因为一次断开远端会让已持久化的坏 tab 状态在重启后继续触发渲染崩溃。

完成本计划后，用户能稳定完成以下行为：

- 在 remote workspace 导入 thread 后，只看到当前 workspace 的 tab；本地 workspace 的旧 tab 不会混入 remote 主编辑区。
- 断开 remote 时，remote 相关 tab 被同步移除或隔离，不会再对已注销 runtime 发起 read/write/run。
- 如果 localStorage 中已经残留失效 remote tab，应用启动时会先做同步净化或在 pane 层安全降级，不会白屏。
- 文件读失败、runtime 不存在、thread 缺失等错误只关闭对应 tab 并显示 toast，不允许在 render 阶段抛异常击穿整页。

**需求边界：**

- 做：修复 tab runtime 作用域、断开 remote 的状态清理、stale persisted tab 的启动恢复、ThreadTabPane 的错误渲染防线，并补测试。
- 不做：不重构整个 remote runtime 连接协议；不改变 SSH host key trust 流程；不改变 thread JSON parser 语义；不做真实远端 E2E 自动化。
- 不做：不继续修复已有 `docs/plans/active/2026-07-25/*` 中与本问题无关的 pack-server、模型 provider、host key 等事项。

## 进度追踪

- [x] `2026-07-25 23:41:02+08:00` Phase 0：需求对齐完成。用户明确要求先用 systematic-debugging 定义 bug 原因，再用 harness-exec-plan 创建修复方案。
- [x] `2026-07-25 23:50:00+08:00` Phase 1：根因调查完成。已从 import、tab persistence、runtime switch、remote disconnect、ThreadTabPane 错误路径逐层追踪。
- [x] `2026-07-25 23:58:00+08:00` Phase 2：方案草案创建完成。
- [x] `2026-07-26 00:04:00+08:00` Phase 3：用户 Review 通过，计划已从 `proposal/` 移到 `active/`。
- [x] `2026-07-26 00:12:00+08:00` Milestone 1：提取 tab runtime 作用域纯逻辑并补单测。
- [x] `2026-07-26 00:20:00+08:00` Milestone 2：主界面只渲染当前 workspace runtime 的 tab，跨 runtime tab 不再出现在同一个 tab strip。
- [x] `2026-07-26 00:27:00+08:00` Milestone 3：remote disconnect 与 runtime 切换执行同步安全清理，避免已注销 runtime 的 pane 继续渲染或写盘。
- [x] `2026-07-26 00:30:00+08:00` Milestone 4：ThreadTabPane 错误态改为 render-safe，不让读失败或 runtime 不存在导致白屏。
- [x] `2026-07-26 00:32:00+08:00` Milestone 5：启动恢复净化 persisted tabs，处理已存在的坏 localStorage 状态。
- [x] `2026-07-26 00:45:00+08:00` Milestone 6：聚合验证：单测、typecheck、lint，必要时做 CEF 手动验证。
- [x] `2026-07-26 00:52:00+08:00` Phase 5：结果汇报。
- [ ] Phase 7：原子提交。

## 意外发现

- 观察：当前 `apps/desktop/src/lib/import-threads.ts` 已经不再使用 `localFs`，而是通过 `createFileSystemClient(runtimeId)` 写入目标 runtime，并在写入 thread 时覆盖 `{ ...thread, runtimeId }`。证据：`apps/desktop/src/lib/import-threads.ts:28-74`。这说明“拖入本地 thread 后写到了本地 workspace”不是当前 HEAD 的主要根因。
- 观察：`apps/desktop/src/app/page.tsx` 的 import 成功路径已经传入 runtime：`refreshTree` 带 `{ runtimeId }`，打开 tab 使用 `openTab(path, runtimeId)`。证据：`apps/desktop/src/app/page.tsx:390-419`。这进一步排除 import helper 本身作为主要根因。
- 观察：`useThreadTabs()` 从 `localStorage` 全量恢复 `llm-space:open-app-tabs`，恢复结果包含所有 runtime 的 tab，且 `ThreadTabs` 渲染时直接使用 `tabs.tabs`，没有按当前 `workspaceRuntimeId` 过滤。证据：`apps/desktop/src/components/thread-tabs/use-thread-tabs.ts:198-235`、`apps/desktop/src/app/page.tsx:686-704`。这是“左侧文件树只显示当前 runtime，但顶部出现其他 runtime tab”的直接原因。
- 观察：`switchWorkspaceRuntime()` 试图通过 `closeRuntime(current)` 和切换 remote 前 `closeRuntime(nextRuntimeId)` 来规避串线，但这是命令式清理，不是渲染层不变量。任何恢复时序、disconnect 时序、异常中断或 localStorage 残留都可能让非当前 runtime tab 进入主编辑区。证据：`apps/desktop/src/app/page.tsx:323-339`。
- 观察：remote disconnect 会在 bun 侧先 unregister runtime，再由 renderer 的 `onDisconnected(runtimeId)` 切回 local。两者之间存在短暂窗口；若此时 remote ThreadTabPane 还在渲染或重读，会请求不存在的 runtime。证据：`apps/desktop/src/components/remote-status.tsx:57-61` 调用 disconnect 后才触发 renderer transition；`apps/desktop/src/bun/remote/remote-server-manager.ts` 的 `_disconnectServer()` 会 unregister runtime。
- 观察：`ThreadTabPane` 在 query error 后依赖 effect 显示 toast 并 close tab，但 render 阶段仍会把 `isLoading=false`、`initialValue=undefined` 传入 `ThreadPlayground`。`ThreadPlayground` 在非 loading 且没有 initialValue 时抛出 `initialValue is required when not loading`，effect 来不及执行，导致整页白屏。证据：`apps/desktop/src/components/thread-tabs/thread-tab-pane.tsx:53-77` 与 `packages/ui/src/components/thread-playground/thread-playground.tsx:120-121`。
- 观察：重启后仍白屏的原因是 bad tab state 已写入 `llm-space:open-app-tabs`。启动时 `useThreadTabs` 的异步校验要等 mount effect 才运行；但 stale remote tab 会先进入第一次 render 并触发上述 ThreadPlayground render throw。证据：`apps/desktop/src/components/thread-tabs/use-thread-tabs.ts:307-368`。

## 决策日志

- 决策：本次不把问题归咎于 import writer。理由：当前 HEAD 的 import 已经 runtime-scoped；继续修 import helper 是短期误判，会错过真正导致白屏的 tab 生命周期问题。日期/作者：`2026-07-25` / Codex。
- 决策：把“主编辑区只渲染当前 workspace runtime 的 tab”设为硬不变量。理由：左侧文件树、模型 provider、HostServices、query key 都以 runtime 为作用域；tab strip 如果跨 runtime 混合，会长期制造 UI 与数据源不一致。日期/作者：`2026-07-25` / Codex。
- 决策：保留跨 runtime tab 的持久化能力先不删除，但渲染入口必须过滤当前 runtime；以后若要支持多 workspace 并存，应显式设计 workspace switcher，而不是让所有 runtime tab 混在一个 tab strip。理由：这是最低熵修复，既修 bug，又不破坏未来扩展空间。日期/作者：`2026-07-25` / Codex。
- 决策：ThreadTabPane 必须在 query error 时返回安全错误占位或 `null`，不能继续挂载 `ThreadPlayground`。理由：React render throw 会击穿当前页面，且 toast/close effect 无法作为第一道防线。日期/作者：`2026-07-25` / Codex。
- 决策：disconnect 成功后应同步清理对应 runtime 的 query cache 与可见 tab，并持久化清理结果；如果 stop 失败但 runtime 已注销，也要保证 renderer 不白屏。理由：renderer 不能假设远端 runtime 在 disconnect 请求 resolve 前后仍可用。日期/作者：`2026-07-25` / Codex。

## 成果与复盘

`2026-07-26 00:04:00+08:00` 用户确认两个关键决策：断开 remote 后关闭该 remote tabs；tab strip 只显示当前 workspace runtime 的 tabs。计划进入实现阶段。

Milestone 1 完成：新增 `apps/desktop/src/components/thread-tabs/tab-runtime-scope.ts`，提取 `filterTabsForRuntime`、`chooseActiveTabForRuntime`、`removeTabsForRuntime` 三个纯函数；新增 `apps/desktop/src/components/thread-tabs/tab-runtime-scope.test.ts` 覆盖 local/remote 同路径隔离、active fallback、失效 runtime 空态、移除指定 runtime tabs。

验证：`bun test apps/desktop/src/components/thread-tabs/tab-runtime-scope.test.ts` 通过，5 pass / 0 fail / 0 skipped。

Milestone 2 完成：`PageWorkspace` 现在通过 `filterTabsForRuntime(tabs.tabs, workspaceRuntimeId)` 派生 `visibleTabs`，通过 `chooseActiveTabForRuntime(...)` 派生 `visibleActiveId`，并只把可见 runtime 的 tabs 传给 `ThreadTabs`。`Welcome` 空态也改为看 `visibleTabs.length`，不会被其他 runtime 的持久化 tabs 阻挡。`shareThread`、tab activate、close others、close all、next/previous、reorder 都改为当前 runtime 作用域，避免命令或快捷键跨 workspace 操作隐藏 tab。

Milestone 3 完成：新增 `discardRuntimeWorkspace(runtimeId)`，断开 remote 前后都会丢弃该 runtime 的 tabs，并清理 `["thread", runtimeId]`、`["fs", runtimeId]`、`["trace", runtimeId]` query cache。`RemoteStatus` 新增 `onDisconnecting`，在发出 disconnect RPC 前先做 renderer 侧安全清理，缩小 bun 侧 unregister runtime 与 renderer 切换之间的危险窗口。Settings 里的 remote disconnect 回调也复用同一清理路径。

Milestone 4 完成：`ThreadTabPane` 新增 `loadError = isError || (!isLoading && !thread)` 防线。错误态先返回轻量占位并由 effect toast + close tab，不再把 `initialValue=undefined` 传给 `ThreadPlayground`，因此 `Runtime not found`、文件不存在、RPC read 失败都不会触发整页 render throw。

Milestone 5 完成：首帧恢复层面，`ThreadTabs` 不再渲染全量 persisted tabs，而是渲染当前 runtime 的 `visibleTabs`；因此即使 `llm-space:open-app-tabs` 已残留 stale remote tab，local workspace 首帧也不会挂载该 remote pane。mount 后原有 `_availableRuntimeIds()` 异步校验仍会删除 runtime 不存在的 tabs，并通过现有 `tabs` persistence 写回 localStorage。

Milestone 6 完成：已运行聚合验证。`bun test apps/desktop/src/components/thread-tabs/tab-runtime-scope.test.ts` 通过，5 pass / 0 fail / 0 skipped；`mise run test` 通过，330 pass / 0 fail；`mise run typecheck` 通过；`mise run lint` 首次发现 `prefer-optional-chain` lint，修复后重跑通过；`git diff --check` 通过。未执行真实 CEF/SSH 手动验证，原因是本轮修复可通过本地静态与单元验证覆盖核心不变量，真实远端连接仍建议由用户按原复现路径确认一次。

## 上下文与方向

仓库是 Bun workspace monorepo，桌面端是 Electrobun app。renderer 通过 typed RPC 与 bun main process 通信。Remote Runtime 的核心设计是用 `RuntimeId` 区分 local 与 remote：

- `apps/desktop/src/shared/runtime.ts` 定义 `RuntimeId = "local" | \`remote:${string}\``。
- 文件树 `FileSystemTreeView` 接收当前 `workspaceRuntimeId`，只展示当前 runtime 的 workspace 文件。
- `createFileSystemClient(runtimeId)` 把 `fsLs` / `fsRead` / `fsWrite` 等 RPC 请求路由到对应 runtime。
- `ThreadTab` 已携带 `runtimeId`，tab id 格式是 `thread:${runtimeId}:${path}`。

当前问题不是单个 RPC 少传 `runtimeId`，而是 UI 状态层没有把 runtime 作用域变成不可破坏的不变量：

1. `useThreadTabs()` 恢复和维护的是全局 tab 数组。
2. `PageWorkspace` 把这个全局数组原样传给 `ThreadTabs`。
3. `FileSystemTreeView` 只展示当前 `workspaceRuntimeId`。
4. 所以只要全局 tabs 中混入别的 runtime，就会出现“顶部 tab 有，但左侧文件树没有文件”的错觉。
5. 当混入的是已 disconnect/unregister 的 remote runtime tab，`ThreadTabPane` 读文件失败，并在 render 中间接触发 `ThreadPlayground` 的 required initialValue 异常，造成白屏。

## 工作计划

### Milestone 1：提取 tab runtime 作用域纯逻辑并补单测

**范围：**
- 修改 `apps/desktop/src/components/thread-tabs/use-thread-tabs.ts`。
- 新增 `apps/desktop/src/components/thread-tabs/use-thread-tabs.test.ts` 或等价纯逻辑测试文件。

**实现方向：**
- 提取纯函数，避免必须挂 React hook 才能测试：
  - `filterTabsForRuntime(tabs, runtimeId)`：返回当前 runtime 的 tabs。
  - `chooseActiveTabForRuntime(tabs, activeId, runtimeId)`：如果 active 属于当前 runtime 则保留，否则选当前 runtime 的最后一个或第一个 tab；无 tab 返回 `null`。
  - `removeTabsForRuntime(tabs, runtimeId)`：返回 `{ next, removed }`，供 closeRuntime 和启动净化复用。
- 测试覆盖：
  - local 与 remote 同路径 thread 不互相覆盖。
  - 当前 workspace 为 remote 时，local tabs 被过滤。
  - activeId 指向非当前 runtime 时，会切到当前 runtime 的有效 tab 或 `null`。
  - 只有失效 remote tabs 时，当前 local workspace 的 visible tabs 为空，不抛错。

**成果：**
- runtime tab 过滤逻辑有独立测试，后续 UI 改动不再靠人工验证。

**命令：**
```sh
bun test apps/desktop/src/components/thread-tabs/tab-runtime-scope.test.ts
```

**验收：**
- 新增单测全部 PASS，0 skipped。
- 不引入 DOM 测试依赖。

### Milestone 2：主界面只渲染当前 workspace runtime 的 tab

**范围：**
- 修改 `apps/desktop/src/app/page.tsx`。
- 修改 `apps/desktop/src/components/thread-tabs/use-thread-tabs.ts` 的公开 API，或在 `PageWorkspace` 内使用 Milestone 1 的纯函数。

**实现方向：**
- 在 `PageWorkspace` 中派生：
  - `visibleTabs = filterTabsForRuntime(tabs.tabs, workspaceRuntimeId)`
  - `visibleActiveId = chooseActiveTabForRuntime(tabs.tabs, tabs.activeId, workspaceRuntimeId)`
- `ThreadTabs` 只接收 `visibleTabs` 和 `visibleActiveId`。
- `Welcome` 的判定从 `tabs.tabs.length === 0` 改为 `visibleTabs.length === 0`，否则其他 runtime 的隐藏 tabs 会阻止当前 workspace 显示 welcome。
- `shareThread`、`activeTab` 查找只允许在 `visibleTabs` 或同 runtime tabs 中进行。
- `activate(id)` 如果 id 不属于当前 visible tabs，不应切 active 到别的 runtime。可在调用处保证，也可在 hook 内防御。

**成果：**
- tab strip 与文件树同属一个 runtime。
- 用户不会再在 remote workspace 看到 local tabs。

**命令：**
```sh
bun test apps/desktop/src/components/thread-tabs/tab-runtime-scope.test.ts
mise run typecheck
```

**验收：**
- typecheck 零错误。
- 代码搜索确认 `ThreadTabs` 的 `tabs` prop 来自 runtime-filtered visible tabs，而不是全量 `tabs.tabs`。
- 当前 workspace 没有 visible tabs 时 Welcome 可显示，不受其他 runtime 持久化 tab 影响。

### Milestone 3：remote disconnect 与 runtime 切换执行安全清理

**范围：**
- 修改 `apps/desktop/src/app/page.tsx`。
- 可能小改 `apps/desktop/src/components/remote-status.tsx`。

**实现方向：**
- 在 `transitionWorkspaceRuntime("local")` 或 disconnect 回调中，先调用 `closeRuntime(disconnectedRuntimeId)` 并清理相关 query cache，再切 workspace runtime：
  - `queryClient.removeQueries({ queryKey: ["thread", runtimeId] })`
  - `queryClient.removeQueries({ queryKey: ["fs", runtimeId] })`
  - `queryClient.removeQueries({ queryKey: ["trace", runtimeId] })`
- 让 `closeRuntime` 或新 helper 支持立即计算下一个 activeId，并确保保存到 localStorage 的 tabs 不包含已断开 runtime。
- 防御 stop 失败但 runtime 已 unregister 的场景：`disconnectRemoteServer()` catch 只展示错误不够；如果后续 `listRuntimes()` 发现 runtime 不存在，也必须执行本地清理。
- 断开 remote 后，如果 local workspace 没有 tab，显示 Welcome，不尝试恢复刚断开的 remote tab。

**成果：**
- disconnect 后 renderer 不再持有对已注销 runtime 的可见 tab 和 query。
- white screen 不会因为 disconnect 的时序窗口触发。

**命令：**
```sh
mise run typecheck
```

**验收：**
- 手动断开 remote 后，`llm-space:open-app-tabs` 不包含已断开 remote 的 visible tab，或至少启动净化会删除它。
- disconnect 后当前 workspace 为 local；如果 local 无文件 tab，显示 Welcome。

### Milestone 4：ThreadTabPane 错误态 render-safe

**范围：**
- 修改 `apps/desktop/src/components/thread-tabs/thread-tab-pane.tsx`。

**实现方向：**
- 在渲染 `ThreadPlayground` 前处理错误态：
  - 如果 `isError`，返回一个轻量错误占位或 `null`，并保留 effect 负责 toast + close。
  - 如果 `!isLoading && !thread`，同样不渲染 `ThreadPlayground`。
- effect 中调用 `onClose` 时不要依赖 `path` 作为 tab id；当前已有 `onClose={() => close(tab.id)}`，保持即可。
- 可选：错误占位用 `bg-background` + 简短文本，避免关闭 tab 前闪白。

**成果：**
- RPC read 失败、runtime not found、文件不存在都不会让 React render 抛异常。

**命令：**
```sh
mise run typecheck
```

**验收：**
- 代码路径上 `ThreadPlayground` 只在 `isLoading || thread` 成立时渲染。
- 对 `Runtime not found` 的 query error 不会触发 `initialValue is required when not loading`。

### Milestone 5：启动恢复净化 persisted tabs

**范围：**
- 修改 `apps/desktop/src/components/thread-tabs/use-thread-tabs.ts`。
- 补 Milestone 1 的纯函数测试，覆盖 stale persisted remote tabs。

**实现方向：**
- `_loadPersistedTabs()` 仍可同步读取所有 tabs，但渲染入口必须过滤当前 runtime；这已经能避免首帧白屏。
- mount 后异步 `_availableRuntimeIds()` 校验时，发现 runtime 不存在的 tab 要删除，并立即更新 persisted tabs。
- 如果 localStorage 里的 `activeTab` 指向已删除 tab，必须同步移除或改为 surviving tab。
- 对 `_availableRuntimeIds()` 失败的情况不做激进删除，只依赖可见 runtime 过滤避免白屏。

**成果：**
- 用户已经处于“重启仍白屏”的坏状态，也能在新版本启动后自动恢复。

**命令：**
```sh
bun test apps/desktop/src/components/thread-tabs/tab-runtime-scope.test.ts
mise run typecheck
```

**验收：**
- 包含 stale remote tab 的 persisted tabs 在 local workspace 首帧不可见。
- 异步校验后 persisted tabs 不再包含 runtime 不存在的 tab。

### Milestone 6：聚合验证与必要手动验证

**范围：**
- 运行测试与静态检查。
- 如本地环境允许，使用 CEF/CDP 或正常 desktop dev 手动走一遍核心路径。

**命令：**
```sh
bun test apps/desktop/src/components/thread-tabs/tab-runtime-scope.test.ts
mise run typecheck
mise run lint
```

如需要真实 UI 验证：

```sh
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/llm-space-XXXXXX")"
LLM_SPACE_HOME="$TMP_ROOT" mise run dev:cef
```

**手动验收脚本：**
1. 启动 app，local workspace 打开 2 个本地 thread。
2. 连接 remote server，workspace 切到 remote。
3. 拖入一个本地 thread JSON 到窗口。
4. 预期：左侧 remote 文件树出现导入文件；顶部只显示 remote tab，不显示 local 旧 tab。
5. 点击右下角 `Disconnect`。
6. 预期：切回 local 或 Welcome，不白屏。
7. 重启 app。
8. 预期：不白屏；不会自动打开已断开的 remote tab。

**验收：**
- 单测全部 PASS，0 skipped。
- `mise run typecheck` 零错误。
- `mise run lint` 零警告、零错误。
- 手动验证如执行，记录结果到“产物与备注”。

## 具体步骤

1. 在仓库根目录确认基线：
   ```sh
   git rev-parse --abbrev-ref HEAD
   git rev-parse HEAD
   ```
   预期：分支为 `feat/support-ssh-remote`，HEAD 为本计划记录的基线或其后续提交。

2. 实现 Milestone 1 的纯函数和单测：
   ```sh
   bun test apps/desktop/src/components/thread-tabs/tab-runtime-scope.test.ts
   ```

3. 修改 PageWorkspace 渲染入口，只传 visible tabs 给 `ThreadTabs`，并调整 Welcome / share active lookup。

4. 修改 disconnect 清理路径，确保 disconnected runtime 的 tab/query 不再可见。

5. 修改 ThreadTabPane 错误态，避免 query error 继续渲染 ThreadPlayground。

6. 跑聚合验证：
   ```sh
   bun test apps/desktop/src/components/thread-tabs/tab-runtime-scope.test.ts
   mise run typecheck
   mise run lint
   ```

7. 每完成一个 milestone，立即更新本 ExecPlan 的“进度追踪”和“成果与复盘”。

## 验证与验收

硬性验收标准：

- `bun test apps/desktop/src/components/thread-tabs/tab-runtime-scope.test.ts`：全部 PASS，0 skipped。
- `mise run typecheck`：退出码 0，零 TypeScript 错误。
- `mise run lint`：退出码 0，零 warning，零 error。
- 代码搜索验收：
  - `ThreadTabs` 不再接收未经过当前 `workspaceRuntimeId` 过滤的全量 `tabs.tabs`。
  - `ThreadTabPane` 在 `isError` 或 `!thread && !isLoading` 时不渲染 `ThreadPlayground`。
  - disconnect remote 后存在清理 `["thread", runtimeId]` / `["fs", runtimeId]` / `["trace", runtimeId]` query 的代码路径，或有等价清理实现。
- 手动验收如执行：remote import 后不会显示 local tabs；disconnect 不白屏；重启不白屏。

## 文档更新

已评估：本次修复是内部 UI 状态一致性和错误防线，不改变用户可见功能入口、不改变 RPC API、不改变 remote runtime 配置说明。除本 ExecPlan 外，暂不需要更新 `docs/remote-runtime*.md`。

如果实现过程中新增“断开 remote 自动关闭 remote tabs”的用户可见行为文案，再补充到 `docs/remote-runtime.md` 和 `docs/remote-runtime.zh-CN.md`。

## 幂等性与恢复

- 新增纯函数和测试可重复运行，不依赖真实 SSH。
- localStorage 启动净化必须是幂等的：重复执行不会删除 local tabs，不会复活 stale remote tabs。
- disconnect 清理必须是幂等的：runtime 已不存在、tab 已关闭、query 已清理时再次调用不报错。
- 如果实现中断，下一位执行者先看“进度追踪”，从第一个未完成 milestone 继续。
- 若发现 3 次修复仍无法消除白屏，应停止局部 patch，重新审视“全局 tab store + workspace runtime”架构是否应拆为 per-runtime tab store。

## 产物与备注

根因调查使用的关键证据：

- `apps/desktop/src/lib/import-threads.ts:28-74`：import 已使用 `createFileSystemClient(runtimeId)`。
- `apps/desktop/src/app/page.tsx:390-419`：import 成功后已传 runtime refresh/open tab。
- `apps/desktop/src/components/thread-tabs/use-thread-tabs.ts:198-235`：从 localStorage 全量恢复所有 runtime tabs。
- `apps/desktop/src/app/page.tsx:686-704`：`ThreadTabs` 当前直接接收全量 `tabs.tabs`。
- `apps/desktop/src/app/page.tsx:323-339`：runtime 切换依赖命令式 `closeRuntime()`，不是渲染层不变量。
- `apps/desktop/src/components/remote-status.tsx:57-61`：disconnect RPC resolve 后才通知 renderer 切换。
- `apps/desktop/src/components/thread-tabs/thread-tab-pane.tsx:53-77`：query error 依赖 effect close tab。
- `packages/ui/src/components/thread-playground/thread-playground.tsx:120-121`：非 loading 且没有 initialValue 会 throw。

## 接口与依赖

本计划不新增运行时依赖。

可能新增或导出的内部类型/函数：

```ts
export function filterTabsForRuntime(
  tabs: AppTab[],
  runtimeId: RuntimeId
): AppTab[];

export function chooseActiveTabForRuntime(
  tabs: AppTab[],
  activeId: string | null,
  runtimeId: RuntimeId
): string | null;

export function removeTabsForRuntime(
  tabs: AppTab[],
  runtimeId: RuntimeId
): { next: AppTab[]; removed: AppTab[] };
```

这些函数只服务 desktop renderer 的 tab 状态管理，不暴露给 RPC 或公共 package API。

[2026-07-25 23:58:00+08:00] 修改说明：初版计划创建。理由：用户要求先定义 bug 原因并创建修复方案，按 harness-exec-plan 在 proposal 阶段暂停等待 Review。

[2026-07-26 00:04:00+08:00] 修改说明：用户确认方案后将计划移入 active，并记录 Review 结论。理由：进入 Phase 4 开发与验证。

[2026-07-26 00:45:00+08:00] 修改说明：记录 Milestone 2-6 的实现结果与验证结果。理由：保持 ExecPlan 作为中断恢复与审计依据。

[2026-07-26 00:52:00+08:00] 修改说明：补充全量测试结果并标记 Phase 5 汇报完成。理由：实现已完成并通过自动化验证，等待用户决定是否提交。
