# Remote Settings 连接状态简化与 SSH 端口占用自恢复计划

本 ExecPlan 是一份自包含活文档。执行阶段必须随着每个里程碑推进同步更新进度追踪、意外发现、决策日志和成果与复盘。

**创建时代码基线：**
- 分支：`feat/support-ssh-remote`
- Commit SHA：`5d6c6b811f0da0610147dd0cbdb0b2f3b44f033d`
- 创建时间：`2026-07-25 22:37:08+08:00`
- 时区：PRC (`+08:00`)
- 提交策略：用户 review 通过后进入开发；完成后用一个语义完整的原子提交。当前工作区已有他人/前序任务未提交修改，执行时不得回滚。

## 目标与全局视角

完成后，Settings → Remote Servers 页面减少重复状态信息：详情页右侧已有 `Connection flow` 时，不再额外显示 `Progress` 行；连接成功后隐藏 `Connection flow`，只保留 `Status`、`Runtime`、`Workspace` 等稳定信息。服务器列表左侧每个条目在已连接时显示一个跟随 `primary` 颜色的绿色/主色勾选圆点，让用户一眼知道当前 SSH 已连上。

完成后，当 SSH remote runtime 因远端端口占用导致 `llm-space-server` 启动失败时，客户端不应直接阻断连接。用户已在问题机器上确认 `127.0.0.1:39123` 当前由旧版 `~/.llm-space/remote-runtime/versions/4.4.6-beta.9/bin/llm-space-server --host 127.0.0.1 --port 39123` 占用，说明本次高频失败的主因是上一次 remote runtime 进程没有被关闭，后续再次通过 SSH 连接同一台机器时，新 server 无法绑定同一端口。修复策略调整为：连接时优先识别并清理同一 SSH 用户下、同一端口上的 LLM Space stale runtime；清理后等待端口释放，再启动当前版本。若占用方不是 LLM Space 或无法确认归属，则保持失败，不盲杀进程，并给出清晰错误信息。

用户可观察验收：
1. 已连接的 server 列表项右侧出现 `primary` 色圆形勾选标识。
2. 连接中/失败时可以看到 `Connection flow`；连接成功后该 flow 自动隐藏。
3. 详情页不再出现与 `Connection flow` 重复的 `Progress` 字段。
4. 遇到 `Failed to start server. Is port 39123 in use?` 时，如果远端 39123 上是 LLM Space 旧进程，点击 Connect 会自动清理并重试一次，不需要用户手动 SSH 到机器杀进程。
5. 如果 39123 被非 LLM Space 进程占用，连接仍失败，但错误说明“端口被非 LLM Space 进程占用，未自动终止”。

**需求边界：**
- 做：Remote settings UI 状态简化；connected sidebar check indicator；端口占用错误分类；LLM Space-owned 旧 runtime 的一次性 stop/retry；相关单测；中英文 remote runtime 文档更新。
- 不做：无限重试；粗暴 `kill -9` 任意占用端口的进程；绕过 SSH host key / auth；改远端 runtime 包格式；大规模重构 remote runtime manager；真实 SSH 端到端连接验证。
- 可选但不作为本轮目标：将远端 server port 改为动态分配或每 server 自动分配。这个方向长期更彻底，但需要改 server 启动协议、stdout 解析和 tunnel 建立顺序，本轮成本较高。本轮先修 stale LLM Space 进程清理，因为它能直接覆盖用户已验证的 beta.9 残留进程。

## 进度追踪

- [x] `2026-07-25 22:37:08+08:00` Phase 0：需求对齐完成。用户提出两个问题：Remote settings UI 冗余和 SSH port 39123 占用时应自动恢复。
- [x] `2026-07-25 22:45:00+08:00` Phase 1：根因调查完成。已定位 UI 冗余来自 `RemoteServerDetails` 同时渲染 `Progress` 与 `ConnectionFlow`；端口冲突来自所有 server 默认远端端口 39123，且切换 server 时先启动新 server 再断开旧 server。
- [x] `2026-07-25 22:52:00+08:00` Phase 2：ExecPlan 草案创建完成，路径为 `docs/plans/proposal/2026-07-25/remote-settings-connection-flow-and-port-recovery.md`。
- [x] `2026-07-25 23:08:00+08:00` Phase 2 修订：根据用户补充的本机端口证据修正根因。39123 由旧版 `llm-space-server` beta.9 占用，主问题从“可能的跨 server 切换冲突”收敛为“stale remote runtime 进程未关闭后的 tokenless 清理”。
- [x] `2026-07-25 23:12:00+08:00` Phase 3：用户确认方案，计划移入 active，开始实现。
- [x] `2026-07-25 23:18:00+08:00` Milestone 1：修复 Remote settings UI 状态显示。
- [x] `2026-07-25 23:28:00+08:00` Milestone 2：增加端口占用错误识别和旧 LLM Space 进程探测。
- [x] `2026-07-25 23:34:00+08:00` Milestone 3：增加端口占用的一次性 stop/retry 状态机。
- [x] `2026-07-25 23:48:00+08:00` Milestone 4：文档更新与聚合验证完成。
- [x] `2026-07-25 23:49:00+08:00` Phase 5：完成汇报。
- [ ] Phase 7：按提交策略提交。

## 意外发现

- 观察：`apps/desktop/src/components/settings/remote-servers-page.tsx` 中 `RemoteServerDetails` 先计算 `const progress = remoteStageSummary(server)`，再渲染 `<Info label="Progress" ... />`，随后无条件渲染 `<ConnectionFlow server={server} />`。这导致同一连接阶段在详情页出现两套表达。证据：当前文件第 373-394 行。
- 观察：`ConnectionFlow` 当前只要 `server.steps` 非空就显示。连接成功后 `RemoteServerManager._setConnection()` 会保留 steps，并把 connected step 标记为 success，因此成功后 flow 仍然显示。证据：`remoteConnectionFlow(server)` 直接返回 `server.steps ?? []`；`ConnectionFlow` 只判断 `steps.length === 0`。
- 观察：服务器列表项当前右侧只展示 trust-required 的 `ShieldAlert` 和 connecting 的 `Loader2`；connected 状态没有任何图标。证据：`remote-servers-page.tsx` 第 296-301 行。
- 观察：所有通过 Settings 添加的 remote server 都持久化 `remoteServerPort: 39123`，UI draft 不暴露该字段。证据：`RemoteServerManager._normalizeDraft()` 固定设置 `remoteServerPort: 39123`。
- 观察：连接第二台 server 时，`RemoteServerManager._connectServer()` 会先启动新 remote runtime，注册新 runtime 后才调用 `_disconnectOtherServersAfterConnect()` 清理旧 server。这个设计保护“新连接失败时旧连接不掉线”，但如果新旧配置指向同一远端机器和同一端口，它们物理上无法同时监听 39123。证据：`_connectServer()` 第 168-185 行，`_disconnectOtherServersAfterConnect()` 第 272-288 行。
- 观察：`startSshRemoteRuntime()` 只选择本地 tunnel port 为 free port；远端 `remoteServerPort` 始终来自 config。`findFreePort()` 不能解决远端 39123 被占用。证据：`ssh-remote-runtime.ts` 第 55 行和 `buildRemoteServerArgs()` 使用 `input.config.remoteServerPort`。
- 观察：当前 server-start 只等待 250ms 检查进程是否早退；如果 `Bun.serve()` 的端口占用异常在 250ms 后退出，错误会在 health-check 阶段被发现，所以用户看到的是 `bootstrap failed during health-check: remote server exited early`。证据：`_waitForProcessAlive()` 与 `_waitForHealth()` 的分工。
- 观察：现有 `RemoteRuntimeClient.shutdownRemote()` 需要旧 token 才能调用 `/shutdown`。如果旧 runtime 来自上一次 app 崩溃或已丢失 token 的进程，当前客户端不能通过 HTTP shutdown 优雅关闭，只能通过远端进程 ownership 判断后发送信号。证据：`RemoteRuntimeClient.shutdownRemote()` 使用 bearer token；server `/shutdown` 也先执行 `assertAuthorized()`。
- 观察：用户补充的真实端口信息显示，问题机器上的 `127.0.0.1:39123` 监听进程是 `llm-space-server`，PID 为 `2067161`，启动路径是 `~/.llm-space/remote-runtime/versions/4.4.6-beta.9/bin/llm-space-server`，启动参数包含 `--host 127.0.0.1 --port 39123`。这证明至少该次失败不是非 LLM Space 端口占用，也不是连接其他 SSH server 的切换冲突，而是旧 remote runtime 残留。
- 观察：旧进程版本是 `4.4.6-beta.9`，当前工作区 HEAD 已 bump 到 `4.4.6-beta.10`。即使旧进程健康，当前客户端也无法安全复用：一是 token 不在当前连接上下文里，二是 `RemoteRuntimeClient.connect()` 会要求远端版本等于当前桌面版本。

## 决策日志

- 决策：UI 层直接删除详情页 `Progress` 行，并让 `remoteConnectionFlow()` 在 `server.status === "connected"` 时返回空数组。理由：`Progress` 和 `Connection flow` 是同一状态的两种表达；成功后用户只需要稳定状态，不需要历史时间线占空间。日期/作者：`2026-07-25` / Codex。
- 决策：connected sidebar indicator 使用圆形容器 + `Check` 图标，并使用 Tailwind `text-primary` / `border-primary` / `bg-primary/15`，而不是硬编码绿色。理由：用户明确要求颜色跟随 primary color；现有设计 tokens 已支持主题色。日期/作者：`2026-07-25` / Codex。
- 决策：端口占用时不“直接重启服务”作为无条件策略，只在确认占用方属于 LLM Space 时自动停止并重试。理由：39123 可能被用户自己的服务、另一个用户、调试进程或系统服务占用；无条件 kill 是安全边界错误。长期正确是先证明 ownership，再自恢复。日期/作者：`2026-07-25` / Codex。
- 决策：本轮不做动态远端端口分配，先实现 stale LLM Space runtime cleanup + once retry。理由：用户已证明真实占用方是旧版 LLM Space server；该路径不需要改启动协议即可修复。动态端口后续仍可作为架构优化，但不是当前最短可靠路径。日期/作者：`2026-07-25` / Codex。
- 决策：如果正在从 server A 切到 server B，且 A/B 的 SSH target 和 `remoteServerPort` 相同，可以先断开 A 再启动 B；如果不同，则保留“B 成功后再断开 A”的现有体验。理由：相同远端端口无法共存，先连后断必然制造冲突；不同远端机器不存在端口冲突，保留旧连接兜底更好。日期/作者：`2026-07-25` / Codex。
- 决策：owner 探测不能依赖新版 server metadata。理由：用户当前残留进程是 beta.9，旧版本不可能写入未来新增的 metadata；本轮必须支持从系统端口表和 `ps` 命令行识别旧 `llm-space-server`。metadata 可以作为未来增强，但不能成为唯一依据。日期/作者：`2026-07-25` / Codex。

## 成果与复盘

Milestone 1 完成：Remote server 详情页已删除 `Progress` 行；`remoteConnectionFlow()` 在 connected 状态返回空数组，使连接成功后隐藏 Connection flow；左侧 server 列表 connected 状态新增 primary 色圆形 check indicator。

Milestone 2 完成：新增端口占用错误分类，新增 `remote-port-owner.ts` 通过端口工具和 `ps` fallback 验证 stale `llm-space-server --port <port>`，不依赖新 metadata，覆盖 beta.9 残留进程。

Milestone 3 完成：`startSshRemoteRuntime()` 在端口占用且 owner 为 LLM Space 时停止 stale pid 并重试一次；unknown/other owner 不 kill；`RemoteServerManager` 对同 host/user/remoteServerPort 的已连接 server 先断开再连接，避免自己制造端口冲突。

Milestone 4 完成：`docs/remote-runtime.md` 与 `docs/remote-runtime.zh-CN.md` 已说明 stale port cleanup 行为。验证结果：相关 `bun test` 39 pass / 0 fail；`mise run typecheck` 通过；`mise run lint` 通过；`git diff --check` 通过。

## 上下文与方向

仓库是 Bun workspace monorepo。Desktop app 是 Electrobun 桌面应用，renderer 通过 typed RPC 调用 bun main process。Remote Runtime 通过系统 `ssh` 在 Linux 远端启动 `llm-space-server`，本地再用 SSH tunnel 把本地端口转发到远端 `127.0.0.1:<remoteServerPort>`。

关键文件：
- `apps/desktop/src/components/settings/remote-servers-page.tsx`：Settings → Remote Servers 页面，包含服务器列表、详情、表单、Connection flow。
- `apps/desktop/src/components/settings/remote-server-display.ts`：Remote settings 显示辅助函数，含 `remoteStageSummary()`、`remoteConnectionFlow()`。
- `apps/desktop/src/components/settings/remote-server-display.test.ts`：显示 helper 单测。
- `apps/desktop/src/bun/remote/remote-server-manager.ts`：remote server 配置、连接状态、runtime 注册和 disconnect 管理。
- `apps/desktop/src/bun/remote/ssh-remote-runtime.ts`：单个 SSH remote runtime 的 install/start/tunnel/health-check 状态机。
- `apps/desktop/src/bun/remote/ssh-error.ts`：SSH bootstrap 错误格式化与分类。
- `apps/server/src/index.ts`、`apps/server/src/http-server.ts`：远端 `llm-space-server` 入口和 HTTP server。

当前状态机简述：
1. `RemoteServerManager.connectServer(id)` 检查 host key，然后调用 `startSshRemoteRuntime(config)`。
2. `startSshRemoteRuntime()` 安装或复用远端包，启动 remote server 进程，启动 SSH tunnel，再通过 `/health` 校验。
3. 如果成功，manager 注册 `remote:<serverId>` runtime 并设为 default，然后 best-effort 断开其他 remote server。
4. 如果失败，manager 把该 server 标为 `error`，旧已连接 server 保持原状态。

端口占用问题的本质不是本地 tunnel port，`findFreePort()` 已保证本地 tunnel 端口可用；问题在 SSH target 上的 `llm-space-server --port 39123` 固定监听。用户这次 SSH 的目标就是运行 Desktop 的本机，所以“远端 127.0.0.1:39123”在操作系统视角上也是本机 loopback；但从 remote runtime 状态机看，它仍是 SSH target 内部的 server port。旧 beta.9 `llm-space-server` 未关闭后，新 beta.10 server 再次绑定 39123 会失败。

## 工作计划

### Milestone 1：修复 Remote settings UI 状态显示

**范围：**
- 修改 `apps/desktop/src/components/settings/remote-servers-page.tsx`。
- 修改 `apps/desktop/src/components/settings/remote-server-display.ts`。
- 修改 `apps/desktop/src/components/settings/remote-server-display.test.ts`。

**实现方向：**
- 在 `RemoteServerDetails` 中删除 `progress` / `progressTitle` 计算和 `<Info label="Progress" ... />` 渲染。
- 修改 `remoteConnectionFlow(server)`：当 `server.status === "connected"` 时返回 `[]`，让 `ConnectionFlow` 自动隐藏。
- 在 server list 右侧增加 connected indicator：
  ```tsx
  {server.status === "connected" ? (
    <span className="border-primary bg-primary/15 text-primary flex size-4 shrink-0 items-center justify-center rounded-full border">
      <Check className="size-3" />
    </span>
  ) : ...}
  ```
  注意 `Check` 已在 imports 中存在；图标可复用。
- 保持 `trust-required` 和 `connecting` indicator 优先级清晰：连接中 spinner、host key shield、connected check 三者互斥。

**成果：**
- 详情页没有 `Progress` 行。
- connected 后 `Connection flow` 不显示。
- 左侧 server 列表 connected server 有 primary 色圆形 check。

**命令：**
```sh
bun test apps/desktop/src/components/settings/remote-server-display.test.ts
mise run typecheck
```

**验收：**
- `remote-server-display.test.ts` 全部 PASS，0 skipped。
- `mise run typecheck` 零错误。
- 代码搜索 `rg 'label="Progress"' apps/desktop/src/components/settings/remote-servers-page.tsx` 无命中。
- 代码搜索确认 connected indicator 使用 `text-primary` / `border-primary` 或等价 primary token，不使用硬编码 `green-*`。

### Milestone 2：增加端口占用错误识别和旧 LLM Space 进程探测

**范围：**
- 修改 `apps/desktop/src/bun/remote/ssh-error.ts`。
- 修改或新增相关测试：`apps/desktop/src/bun/remote/ssh-error.test.ts`。
- 修改 `apps/desktop/src/bun/remote/ssh-remote-runtime.ts`，新增端口 owner 探测 helper。

**实现方向：**
- 新增结构化分类函数：
  ```ts
  export interface RemotePortInUseFailure { port: number; }
  export function parseRemotePortInUseFailure(output: string): RemotePortInUseFailure | null
  ```
  至少识别：
  - `EADDRINUSE`
  - `address already in use`
  - `Failed to start server. Is port 39123 in use?`
- 新增远端 owner 探测命令：给定 `remoteServerPort`，优先用 Linux 上常见工具找监听 pid：`lsof -nP -iTCP:<port> -sTCP:LISTEN -t`、`ss -ltnp 'sport = :<port>'`、`fuser -n tcp <port>`。拿到 pid 后必须再用 `ps -p <pid> -o args=` 验证命令行包含 `llm-space-server` 和 `--port <port>`。如果这些端口工具不可用，再 fallback 到 `ps -u "$(id -u)" -o pid=,args=` 扫描当前 SSH 用户自己的进程，匹配 `llm-space-server`、`--port <port>` 和 `remoteInstallDir/versions/*/bin/llm-space-server`。如果命令行路径在 `remoteInstallDir/versions/*/bin/llm-space-server` 下，或 basename 是 `llm-space-server` 且参数匹配 `--host 127.0.0.1 --port <port>`，判定为 LLM Space-owned。若连 `ps` 也无法验证命令行，返回 unknown。
- 可选新增新版 metadata，但不得依赖它完成本轮修复。原因：用户当前要清理的是 beta.9 旧进程，旧进程不会有新 metadata。
- ownership 结果建议三态：
  ```ts
  type RemotePortOwner =
    | { kind: "llm-space"; pid: number; source: "metadata" | "port-scan" }
    | { kind: "other"; detail: string }
    | { kind: "unknown"; detail: string };
  ```

**成果：**
- 端口占用错误可被结构化识别。
- 客户端具备“只停止 LLM Space 自己旧进程”的证据链。

**命令：**
```sh
bun test apps/desktop/src/bun/remote/ssh-error.test.ts
mise run typecheck
```

**验收：**
- 新增端口占用分类测试至少覆盖 `EADDRINUSE` 和用户报错文本。
- owner 探测 helper 测试覆盖用户事实：`~/.llm-space/remote-runtime/versions/4.4.6-beta.9/bin/llm-space-server --host 127.0.0.1 --port 39123` 被识别为 `kind: "llm-space"`，即使只能通过 `ps` fallback 发现。
- owner 探测 helper 对非 LLM Space 命令行返回 `other` 或 `unknown`，不生成 kill 动作。
- `mise run typecheck` 零错误。

### Milestone 3：增加端口占用的一次性 stop/retry 状态机

**范围：**
- 修改 `apps/desktop/src/bun/remote/ssh-remote-runtime.ts`。
- 修改 `apps/desktop/src/bun/remote/ssh-remote-runtime.test.ts`。
- 修改 `apps/desktop/src/bun/remote/remote-server-manager.ts` 和 `remote-server-manager.test.ts`，处理同 target 同 port 切换策略。

**实现方向：**
- 在 `_startInstalledRuntime()` catch 分支中，如果错误被 `parseRemotePortInUseFailure()` 命中：
  1. stop 当前已创建的 server/tunnel process。
  2. 调用 owner 探测 helper。
  3. 若 owner 是 `llm-space`，执行 `kill -TERM <pid>`，轮询端口释放，最多等待 5 秒。若 pid 仍存在且仍占用同一端口，可对同 pid 再 `kill -KILL` 作为 LLM Space-owned 进程的最后兜底。
  4. emit progress：`Remote runtime port is in use; restarting stale LLM Space server`。
  5. 重新启动 remote server、tunnel、health-check 一次。
  6. 第二次仍端口占用时不再 retry，抛出包含 owner/port 细节的错误。
- 如果 owner 是 `other` 或 `unknown`，不 kill，直接抛错。错误应包含：远端端口、探测结果、建议改 remoteServerPort 或手动处理占用进程。
- 在 `RemoteServerManager._connectServer()` 中增加同 SSH target + 同 `remoteServerPort` 的预处理：
  - 如果已有 connected server 和目标 server 的 `host`、`user`、`remoteServerPort` 相同，则先 `_disconnectServer(existingId)`，再连接新 server。
  - 如果不同，保留现有“新连接成功后再断开旧连接”的行为。
- 保证 retry 只发生一次，避免无限循环。

**成果：**
- 旧 LLM Space runtime 占用端口时同一次 Connect 可以自动恢复。
- 非 LLM Space 进程占用端口时不会被误杀。
- 同一 SSH target 上切换 server config 不再人为制造 39123 冲突。

**命令：**
```sh
bun test apps/desktop/src/bun/remote/ssh-remote-runtime.test.ts apps/desktop/src/bun/remote/remote-server-manager.test.ts
mise run typecheck
```

**验收：**
- `ssh-remote-runtime.test.ts` 覆盖：LLM Space-owned port conflict → stop owner → retry success；unknown owner → no kill and fail；retry 后仍失败 → 只 retry 一次。
- `remote-server-manager.test.ts` 覆盖：同 host/user/remoteServerPort 切换时先 disconnect old；不同 host 切换仍保持成功后断开 old；新连接失败时非同 target 的旧连接仍保持 connected。
- 所有新增/修改测试全部 PASS，0 skipped。
- `mise run typecheck` 零错误。

### Milestone 4：文档更新与聚合验证

**范围：**
- 更新 `docs/remote-runtime.md`。
- 更新 `docs/remote-runtime.zh-CN.md`。
- 运行聚合验证。

**实现方向：**
- 文档补充“port in use”行为：
- LLM Space 会在确认占用方是旧 LLM Space runtime 时自动停止并重试一次，覆盖 `~/.llm-space/remote-runtime/versions/<old-version>/bin/llm-space-server --port 39123` 这类残留进程。
  - 不会停止无法确认归属的进程。
  - 如果仍失败，用户应检查同一远端是否已有其他服务监听该端口，或调整 server config（如果后续 UI 暴露端口）。
- 如果最终实现没有暴露端口配置，文档不要建议 UI 改端口，只建议处理远端占用进程。

**命令：**
```sh
bun test apps/desktop/src/components/settings/remote-server-display.test.ts apps/desktop/src/bun/remote/ssh-error.test.ts apps/desktop/src/bun/remote/ssh-remote-runtime.test.ts apps/desktop/src/bun/remote/remote-server-manager.test.ts apps/server/src/http-server.test.ts
mise run typecheck
mise run lint
```

**验收：**
- 上述测试全部 PASS，0 skipped。
- `mise run typecheck` 零错误。
- `mise run lint` 零告警零错误。
- 中英文文档都更新，并且没有承诺会杀掉任意占用 39123 的进程。

## 具体步骤

```sh
# 1. 确认基线和当前未提交改动；不得回滚无关修改。
git status --short
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD

# 2. Milestone 1 后验证 UI helper。
bun test apps/desktop/src/components/settings/remote-server-display.test.ts
mise run typecheck

# 3. Milestone 2 后验证错误分类和 stale owner 探测。
bun test apps/desktop/src/bun/remote/ssh-error.test.ts
mise run typecheck

# 4. Milestone 3 后验证 SSH runtime 和 manager 状态机。
bun test apps/desktop/src/bun/remote/ssh-remote-runtime.test.ts apps/desktop/src/bun/remote/remote-server-manager.test.ts
mise run typecheck

# 5. 最终聚合验证。
bun test apps/desktop/src/components/settings/remote-server-display.test.ts apps/desktop/src/bun/remote/ssh-error.test.ts apps/desktop/src/bun/remote/ssh-remote-runtime.test.ts apps/desktop/src/bun/remote/remote-server-manager.test.ts apps/server/src/http-server.test.ts
mise run typecheck
mise run lint
```

## 验证与验收

刚性验收条件：
- [ ] `rg 'label="Progress"' apps/desktop/src/components/settings/remote-servers-page.tsx` 无命中。
- [ ] connected 状态下 `remoteConnectionFlow(server)` 返回 `[]`，对应测试 PASS。
- [ ] connected sidebar indicator 使用 primary token，未硬编码 green 色。
- [ ] `parseRemotePortInUseFailure()` 能识别用户报错文本 `Failed to start server. Is port 39123 in use?`。
- [ ] owner 探测能将 `~/.llm-space/remote-runtime/versions/4.4.6-beta.9/bin/llm-space-server --host 127.0.0.1 --port 39123` 识别为 LLM Space-owned，包括端口工具不可用、只能通过 `ps` fallback 的场景。
- [ ] LLM Space-owned stale runtime port conflict 自动 stop/retry 一次，测试 PASS。
- [ ] unknown/other process port conflict 不 kill，测试 PASS。
- [ ] 同 SSH target + 同 port 的 server 切换先断开旧连接，测试 PASS。
- [ ] 聚合 bun test 全部 PASS，0 skipped。
- [ ] `mise run typecheck` 零错误。
- [ ] `mise run lint` 零告警零错误。

## 文档更新

需要更新：
- `docs/remote-runtime.md`：增加 port in use 自恢复说明。
- `docs/remote-runtime.zh-CN.md`：同步中文说明。

无需更新：
- AGENTS.md：本次不新增架构约束或开发入口。
- README/landing：这是 settings 和 remote runtime 行为修复，不影响对外功能介绍。

## 幂等性与恢复

- UI 修改可重复应用；如果测试失败，回退本任务文件即可，不触碰已有未提交修改。
- 端口 recovery 必须 retry once，不能无限重试。重复点击 Connect 时每次最多执行一次 recovery。
- 远端 kill 只允许作用于 ownership helper 明确返回 `kind: "llm-space"` 的 pid。unknown/other 结果必须失败返回。
- 如果 server metadata 文件残留但 pid 不存在，应删除 metadata 或忽略，并继续按普通启动流程处理。
- 如果 stop stale runtime 后端口仍未释放，应失败并提示 pid/port，不继续叠加更多 kill/retry。

## 产物与备注

Phase 1 调查命令摘要：
- `rg "Connection Flow|connection flow|remote|ssh|health-check|39123" ...` 定位 remote settings、SSH runtime、server port 默认值。
- `nl -ba apps/desktop/src/components/settings/remote-servers-page.tsx` 确认 `Progress` 和 `ConnectionFlow` 同时渲染。
- `nl -ba apps/desktop/src/bun/remote/remote-server-manager.ts` 确认默认 `remoteServerPort: 39123` 和先连接新 server 后断开旧 server。
- `nl -ba apps/desktop/src/bun/remote/ssh-remote-runtime.ts` 确认远端 port 来自 config、本地 port 才用 `findFreePort()`，以及 health-check 阶段捕获 late process exit。
- `nl -ba apps/server/src/args.ts` 确认 server 默认 port 是 39123。

## 接口与依赖

预计新增或调整的内部接口：

```ts
// apps/desktop/src/bun/remote/ssh-error.ts
export interface RemotePortInUseFailure {
  port: number;
}
export function parseRemotePortInUseFailure(output: string): RemotePortInUseFailure | null;

// apps/desktop/src/bun/remote/ssh-remote-runtime.ts 或新文件
export type RemotePortOwner =
  | { kind: "llm-space"; pid: number; source: "metadata" | "port-scan" }
  | { kind: "other"; detail: string }
  | { kind: "unknown"; detail: string };
```

不新增第三方依赖。远端 owner 探测只使用常见 Linux 命令和 best-effort fallback；`lsof` / `ss` / `fuser` 不可用时可以扫描当前 SSH 用户自己的 `ps` 进程列表，但 `ps` 无法验证命令行时必须返回 unknown，不得误杀。

[2026-07-25 22:52:00+08:00] 修改说明：创建初版 proposal。理由：用户要求用 systematic-debugging 定义 bug 原因，并用 harness-exec-plan 创建改造方案；按 ExecPlan 纪律，代码实现需等待用户 review 确认。

[2026-07-25 23:08:00+08:00] 修改说明：根据用户补充的本机端口证据修订端口占用方案。理由：真实占用进程已确认为旧版 LLM Space `llm-space-server` beta.9，修复重点从泛化 ownership + metadata 调整为能清理旧版本残留进程的系统端口探测 + ps 命令行校验。

[2026-07-25 23:12:00+08:00] 修改说明：用户确认方案，ExecPlan 从 proposal 移入 active。理由：进入 Phase 4 开发与验证。

[2026-07-25 23:49:00+08:00] 修改说明：更新完成进度和验证结果。理由：所有计划里程碑已实现并通过验证。
