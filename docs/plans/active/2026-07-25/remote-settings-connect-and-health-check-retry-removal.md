# Remote settings Connect 入口收敛、远端路径展开修复与 health-check retry 移除

本 ExecPlan 是一份活文档。进度追踪、意外发现、决策日志 和 成果与复盘 章节必须随工作推进持续更新。

**创建时代码基线：**
- 分支：feat/support-ssh-remote
- Commit SHA：db940c87217ff8b4619717d58924143da7fc074b
- 时区：PRC (+08:00)
- 提交策略：完成后 squash 为一个语义完整的 commit

## 目标与全局视角

完成后，Settings → Remote 的服务器连接入口只保留一个：详情页底部操作区里，`Connect` 按钮放在 `Edit` 左边；服务器列表项不再带连接按钮，详情页右上角也不再带连接按钮。用户添加或选择 server 后，操作区从左到右是 `Connect/Disconnect`、`Edit`、`Remove`。

完成后，SSH remote runtime 对默认远端路径 `~/.llm-space/remote-runtime` 和 `~/.llm-space-server` 的处理一致且正确：安装命令、启动命令、校验命令都把开头的 `~` 展开到远端用户真实 `$HOME`，不会再在远端当前工作目录下创建字面量 `~/` 目录。用户在 `ssh qiangenchao@10.37.112.248` 这类服务器上连接时，安装产物应落到 `$HOME/.llm-space/remote-runtime/...`，启动路径与安装路径一致。

完成后，SSH remote runtime 在 `server-start` 或 `health-check` 阶段失败时不再触发“清理安装产物 + 重装 + retry”。连接失败即失败，并且 missing binary 类错误会包含足够的路径诊断信息，便于定位是安装目录、entrypoint、权限还是远端 HOME 问题。安装器仍保留正常安装、复用前校验、远端下载失败后的本地上传 fallback；本计划只移除健康检查后的重装 retry。

**需求对齐记录**（Phase 0 产出）：
- 用户原始需求：
  1. settings/remote 里的 server 配置 connect 不要同时放在配置项和右上角；只需要和最开始一样，放到 edit 左边，加一个 Connect 按钮。
  2. 如果健康检查失败，移除重试安装逻辑，不需要这个逻辑。
  3. 用户提供问题服务器 `ssh qiangenchao@10.37.112.248`，要求复刻验证 “Remote runtime binary was missing and reinstall retry failed” 的真实原因，并把该问题纳入修复方案。
- Agent 理解：这是一次 remote runtime 连接链路收敛。UI 上收敛重复入口；运行时上先修正远端 `~` 路径展开导致的安装/启动路径不一致，再删除 health-check 失败后的自动重装 retry，并补充诊断输出，避免以后只能从长错误文案里猜。
- 已确认的边界：
  - 做：移除列表项里的连接按钮；移除详情页 header 右侧连接按钮；在详情页底部 `Edit` 左边恢复 `Connect/Disconnect`；修复远端路径开头 `~`/`~/` 的 shell 表达；迁移或至少不再依赖远端字面量 `~/` 目录；移除 `startSshRemoteRuntime()` 中 missing runtime binary 后的 `cleanRemoteRuntimeInstallArtifacts()` + 第二次 install/start；更新错误文案、单测、文档和计划记录。
  - 不做：不移除 Add/Refresh server；不改变 SSH host key trust 弹窗；不改变 remote server 配置字段 UI；不移除安装器正常的下载 fallback 上传；不主动删除用户服务器上的 `/data00/home/qiangenchao/~` 目录，除非用户明确要求。
- 关键澄清问答：
  - Q: 是否需要先做代码实现？ → A: 按 harness-exec-plan 先重新产出方案，用户 review 后再执行。
  - Q: “健康检查失败重试安装”是否全部删除？ → A: 删除 server-start/health-check missing binary 触发的自动清理重装 retry；保留 install 阶段自身的 package fallback，因为那不是健康检查失败重试。
  - Q: 问题服务器真实根因是什么？ → A: 已通过 SSH 只读诊断确认，安装产物落到了 `/data00/home/qiangenchao/~/.llm-space/...` 字面量 tilde 目录，而错误/预期路径是 `/home/qiangenchao/.llm-space/...`。根因是远端命令中 `~` 被 shell quote 后不展开，导致安装路径和启动/诊断路径语义不一致。

## 进度追踪

- [x] (2026-07-25 20:05:01+08:00) Phase 0: 初始需求对齐完成
- [x] (2026-07-25 20:13:00+08:00) Phase 1: 初始根因调查完成
- [x] (2026-07-25 20:18:00+08:00) Phase 2: 初版方案撰写完成
- [x] (2026-07-25 20:32:00+08:00) Phase 1 补充：问题服务器 SSH 复刻验证完成
- [x] (2026-07-25 20:39:00+08:00) Phase 2 修订：方案加入远端 tilde 路径展开修复
- [x] (2026-07-25 20:41:00+08:00) Phase 3: 用户 Review 通过
- [x] (2026-07-25 20:48:00+08:00) Milestone 1: 统一远端 shell 路径表达，修复 `~` 展开
- [x] (2026-07-25 20:54:00+08:00) Milestone 2: 移除 health-check 失败后的重装 retry，并补充失败诊断
- [x] (2026-07-25 20:56:00+08:00) Milestone 3: 收敛 Settings Remote 的 Connect 入口
- [x] (2026-07-25 21:00:00+08:00) Milestone 4: 文档与历史计划状态同步
- [x] (2026-07-25 21:06:00+08:00) Phase 5: 结果汇报
- [ ] (2026-07-25 20:39:00+08:00) Phase 7: 代码提交/PR 合并

## 意外发现

- 观察：Settings → Remote 的重复 Connect 入口来自 `4e5ac57 feat: 优化远程服务器连接切换体验` 后续演进。该提交先把连接控制从详情页操作区改成列表项 Switch + 详情页右上 Switch；当前代码又将 Switch 改成 `RemoteConnectionButton`，因此形成“左侧列表项一个按钮 + 右侧详情页 header 一个按钮”的双入口。
  证据：`git show 4e5ac57:apps/desktop/src/components/settings/remote-servers-page.tsx` 显示列表项和详情页 header 使用 `Switch`；当前 `apps/desktop/src/components/settings/remote-servers-page.tsx` 在列表项和 `RemoteServerDetails` header 均渲染 `RemoteConnectionButton`。

- 观察：最早的布局是在详情页底部操作区放 `Connect/Disconnect`，并且位于 `Edit` 之前。用户说“和最开始一样，放到 edit 的左边”与这个历史布局一致。
  证据：`git show 4e5ac57^:apps/desktop/src/components/settings/remote-servers-page.tsx` 中 `RemoteServerDetails` 的底部 `<div className="flex flex-wrap gap-2">` 先渲染 `Connect/Disconnect`，然后渲染 `Edit` 和 `Remove`。

- 观察：健康检查失败后的重装 retry 是上一轮 `9c916e4 fix: 修复 SSH 远端 runtime 自愈重装` 引入的显式状态机，不是历史基础逻辑。它在 `_startInstalledRuntime()` 抛出 missing/non-executable runtime binary 后，调用 `cleanRemoteRuntimeInstallArtifacts(config)`，再执行第二次 `_installRemoteServer()` 与 `_startInstalledRuntime()`。
  证据：当前 `apps/desktop/src/bun/remote/ssh-remote-runtime.ts` 的 `startSshRemoteRuntime()` 中，首次 start 失败后会用 `parseMissingRuntimeBinaryFailure()` 判断，然后发出 “Remote runtime binary missing; reinstalling package” progress、调用 `cleanRemoteRuntimeInstallArtifacts()` 并重试。

- 观察：问题服务器 `qiangenchao@10.37.112.248` 上，真实 `$HOME/.llm-space` 不存在，但存在 `/data00/home/qiangenchao/~/.llm-space/remote-runtime/versions/4.4.6-beta.9/bin/llm-space-server`，并且该 binary 可执行。这证明安装产物落到了字面量 `~` 目录。
  证据：只读 SSH 诊断输出显示 `HOME=/home/qiangenchao`、`PWD=/data00/home/qiangenchao`；`ls /home/qiangenchao/.llm-space` 报不存在；`ls /data00/home/qiangenchao/~/.llm-space/remote-runtime/.../llm-space-server` 存在且 `-rwxr-xr-x`；`timeout 3 "~/.llm-space/.../llm-space-server" --help` 在 `PWD=/data00/home/qiangenchao` 时可输出 Usage。

- 观察：根因是远端 shell 中单引号包住 `~` 后不会做 tilde expansion。当前安装器和启动命令大量使用 `shellQuote()`，例如 `INSTALL_DIR='~/.llm-space/remote-runtime'`、`exec '~/.llm-space/remote-runtime/.../llm-space-server'`。这在 shell 中会被当成普通相对路径，而不是 `$HOME` 下路径。
  证据：`apps/desktop/src/bun/remote/remote-server-installer.ts` 使用 `shellQuote(input.installDir)` 和字符串拼接生成 `packageDir`/`entrypoint`；`apps/desktop/src/bun/remote/ssh-command.ts` 的 `buildRemoteServerCommand()` 用 `shellQuote(input.entrypoint)` 和 `shellQuote(input.home)`。

- 观察：`cleanRemoteRuntimeInstallArtifacts()` 当前只被 retry 分支和测试引用；移除 health-check retry 后，如果无其他调用，该函数会成为死代码。长期正确做法是删除该函数和对应测试断言，而不是保留不可达入口。
  证据：`rg "cleanRemoteRuntimeInstallArtifacts" apps/desktop/src/bun/remote -g '*.ts'` 仅命中 `ssh-remote-runtime.ts`、`remote-server-installer.ts`、`ssh-remote-runtime.test.ts`、`remote-server-installer.test.ts`。

- 观察：`parseMissingRuntimeBinaryFailure()` 仍可保留给错误文案使用，但不应再驱动重装状态机。错误文案里“will reinstall ... once and retry”必须同步改掉，否则用户会看到已经删除的行为承诺。
  证据：当前 `apps/desktop/src/bun/remote/ssh-error.ts` 的 `_formatMissingRuntimeBinary()` 返回 “LLM Space will reinstall the remote runtime package once and retry the connection.”。

## 决策日志

- 决策：先修复远端路径展开，再移除 retry 和调整 UI。
  理由：问题服务器证据显示真实根因是 `~` 被 quote 后安装到字面量目录。如果只删除 retry，用户仍会失败，只是错误更短。路径语义是连接链路的不变量，必须先收敛。
  日期/作者：2026-07-25 / Codex

- 决策：新增统一 helper 表达远端 shell 路径，禁止在远端命令里直接 `shellQuote("~/...")`。
  理由：远端路径既要防注入，又要保留 `~` 代表远端 HOME 的语义。把 `~/foo` 转成 `"$HOME"/foo` 或等价安全表达式，是最低熵且可测试的修复。
  日期/作者：2026-07-25 / Codex

- 决策：不在代码里自动迁移或删除远端已经存在的字面量 `~/` 目录。
  理由：自动移动远端目录是有状态破坏操作，可能误动用户手工放置的文件。修复后新连接会安装到正确 `$HOME/.llm-space`；旧错误目录可由用户确认后手动清理。
  日期/作者：2026-07-25 / Codex

- 决策：删除 health-check missing binary 后的自动重装 retry，而不是用配置开关关闭。
  理由：用户明确“不需要这个逻辑”。保留开关会增加状态空间和测试成本，且默认行为仍需选择。删除更简单、可预测。
  日期/作者：2026-07-25 / Codex

- 决策：保留 install 阶段远端下载失败后的本地上传 fallback。
  理由：用户要求移除的是“健康检查失败后的重试安装”。下载 fallback 是安装阶段网络可达性兜底，不是 health-check 失败后的自愈重装。
  日期/作者：2026-07-25 / Codex

- 决策：UI 不保留列表项级 Connect 控制，只保留详情页底部操作区按钮。
  理由：Settings Remote 是配置页，不是运行时状态栏。列表项按钮增加密度和误触面；详情页底部操作区更符合“先选择/确认目标，再执行连接”的低熵交互。
  日期/作者：2026-07-25 / Codex

- 决策：详情页 header 只展示 server 名称和 endpoint，不放操作按钮。
  理由：header 右上按钮和底部操作区会形成两个同等优先级入口。用户明确要求不要右上角重复。
  日期/作者：2026-07-25 / Codex

## 成果与复盘

Milestone 1 完成：新增远端 shell 路径表达 `shellPath()` 和远端路径拼接 `joinRemotePath()`；安装器、上传器、启动命令已改为对开头 `~/` 使用远端 `$HOME` 表达，不再把 `~` 单引号 quote 成字面量目录。相关 remote bun tests 30 pass / 0 fail。

Milestone 2 完成：`startSshRemoteRuntime()` 已回到单次 install/start/health-check 流程；删除 health-check missing binary 后的清理重装 retry；missing binary 报错改为事实型提示，并追加 best-effort 远端诊断快照。

Milestone 3 完成：Settings → Remote 左侧列表项和详情页 header 不再渲染连接按钮；详情页底部操作区恢复 `Connect/Disconnect`、`Edit`、`Remove` 顺序。相关测试 33 pass / 0 fail。

Milestone 4 完成：中英文 remote runtime 文档已改为描述 `$HOME` 路径展开、无 health-check 自动重装 retry、失败时输出诊断快照；上一份 self-healing 计划已追加 superseded 说明。

### 完成汇报（Phase 5 产出）

**目标达成**：✅ 完全达成。已修复 SSH remote runtime 的远端 `~` 路径展开问题，删除 health-check missing binary 自动重装 retry，并收敛 Remote 设置页重复 Connect 入口。

**变更概览**：
- 新增/调整远端 shell 路径表达：`shellPath()`、`joinRemotePath()`。
- 安装器、上传器、server 启动命令统一用远端 `$HOME` 表达 `~/...`。
- 删除 `cleanRemoteRuntimeInstallArtifacts()` 和 retry 状态机。
- missing binary 错误改为事实型提示，并附 best-effort 远端诊断快照。
- Remote 设置页只保留详情页底部 Connect/Disconnect 入口。
- 更新 remote runtime 中英文文档和历史计划 superseded 说明。

**验收结果**：
- `bun test apps/desktop/src/bun/remote/ssh-command.test.ts apps/desktop/src/bun/remote/remote-server-installer.test.ts apps/desktop/src/bun/remote/ssh-remote-runtime.test.ts apps/desktop/src/bun/remote/ssh-error.test.ts apps/desktop/src/components/settings/remote-server-display.test.ts`：33 pass / 0 fail。
- `mise run typecheck`：通过，0 错误。
- `mise run lint`：通过，0 warnings / 0 errors。
- `git diff --check`：通过。
- 风险扫描：生产代码无 `RemoteConnectionButton`、`cleanRemoteRuntimeInstallArtifacts`、`INSTALL_DIR='~...`、`exec '~...`、`will reinstall` 命中。

**已知风险/遗留**：问题服务器上已有的 `/data00/home/qiangenchao/~/.llm-space/...` 字面量目录不会被自动删除；修复后新安装会落到正确 `$HOME/.llm-space/...`。如果需要清理旧目录，需用户确认后手动处理。

**建议后续**：用修复后的客户端重新连接 `qiangenchao@10.37.112.248`；确认成功后可手动清理远端字面量 `~/` 目录。

## 上下文与方向

相关 UI 文件：

- `apps/desktop/src/components/settings/remote-servers-page.tsx`：Settings → Remote 页面主体。左侧列表渲染 server 卡片；右侧 `RemoteServerDetails` 渲染所选 server 的状态、连接流、错误和操作按钮。
- `apps/desktop/src/components/settings/remote-server-display.ts`：把 `RemoteServerView` 转换为展示摘要、连接流程和按钮状态。若删除 `RemoteConnectionButton` 后仍需要按钮状态，可以复用 `remoteConnectionAction()`；若 no-op，则删除未使用 helper。
- `apps/desktop/src/components/settings/remote-server-display.test.ts`：展示 helper 测试。

相关运行时文件：

- `apps/desktop/src/bun/remote/ssh-command.ts`：构造远端 server 启动命令、source mode 命令、tunnel 命令和基础 ssh args。目前 `buildRemoteServerCommand()` 使用 `shellQuote(entrypoint)` 与 `shellQuote(home)`，对 `~/...` 不安全。
- `apps/desktop/src/bun/remote/remote-server-installer.ts`：remote server package 安装器。负责平台检测、复用校验、远端下载、fallback 上传、manifest 与 `bin/llm-space-server` 可执行校验。目前 installDir/packageDir/entrypoint 可能保留 `~` 字符串，传进远端 shell 后被单引号保护，导致不展开。
- `apps/desktop/src/bun/remote/remote-exec.ts`：执行远端命令。它只负责 `ssh ... command`，不应知道路径语义；路径语义应在 command builder 层处理。
- `apps/desktop/src/bun/remote/ssh-remote-runtime.ts`：SSH remote runtime 启动流程。当前顺序是 install package → start remote server → start tunnel → `/health` check。上一轮新增了 missing binary 后的清理重装 retry。
- `apps/desktop/src/bun/remote/ssh-error.ts`：SSH bootstrap 错误文案格式化。当前有 missing runtime binary 分类与“将重装一次”的提示。
- `apps/desktop/src/bun/remote/ssh-remote-runtime.test.ts`：上一轮新增的 retry 状态机测试，当前测试名为 `startSshRemoteRuntime reinstall retry`。
- `docs/plans/active/2026-07-25/ssh-remote-runtime-self-healing.md`：上一轮已经激活并完成的自愈重装计划。因为本次需求明确回退该行为，应在文档更新里记录其 superseded 状态或追加修订说明，避免未来 Agent 误认为 retry 仍是目标行为。

术语：

- remote shell path：传给远端 shell 解释的路径表达式。它不是 TypeScript 字符串，也不是本机路径；必须同时满足 shell 安全和远端语义。
- tilde expansion：shell 在未引用的 `~` 或 `~/...` 开头位置把它展开成当前用户 HOME 的行为。单引号里的 `~` 不会展开。
- health-check：SSH tunnel 建立后，本机通过 `RemoteRuntimeClient.connect()` 请求远端 `/health`，验证 protocol/version/capabilities 的阶段。
- retry install：本计划中特指 health-check 或 server-start 阶段发现 `llm-space-server` 缺失/不可执行后，自动清理远端安装产物并第二次安装启动的逻辑。
- install fallback：远端直接下载 release 包失败后，由本机下载并通过 SSH 上传，再在远端从 archive 安装。它属于安装阶段 fallback，不属于本次要删除的 health-check retry。

## 工作计划

### Milestone 1: 统一远端 shell 路径表达，修复 `~` 展开

**范围**：编辑 `apps/desktop/src/bun/remote/ssh-command.ts`、`apps/desktop/src/bun/remote/remote-server-installer.ts` 及对应测试。

具体修改：

1. 在 `ssh-command.ts` 或新文件 `apps/desktop/src/bun/remote/remote-shell.ts` 中新增 helper。建议接口：

   ```ts
   export function shellQuote(value: unknown): string;
   export function shellPath(value: string): string;
   export function joinRemotePath(base: string, ...parts: string[]): string;
   ```

   `shellPath()` 语义：
   - `"~"` → `"$HOME"`
   - `"~/foo bar"` → `"$HOME"/'foo bar'` 或等价安全表达
   - `"/opt/foo bar"` → `'/opt/foo bar'`
   - `"relative/path"` → `'relative/path'`
   - 不支持 `~other/foo`；遇到这种形式按普通字符串 quote，或明确抛错并加测试。当前需求只需要当前用户 HOME。

2. 改 `remote-server-installer.ts` 的 install 命令生成：
   - `INSTALL_DIR=${shellQuote(input.installDir)}` 改成 `INSTALL_DIR=${shellPath(input.installDir)}`。
   - `packageDir`、`manifestPath`、`entrypoint` 仍可作为逻辑字符串返回，但所有传给远端 shell 的路径必须用 `shellPath()` 或在变量展开后引用。尤其 `_hasInstalledPackage()` 的 `cat ${shellQuote(manifestPath)}` 和 `test -x ${shellQuote(entrypoint)}` 必须改为 `shellPath(manifestPath)` / `shellPath(entrypoint)`。
   - `_pointCurrentAtVersion()` 的 `mkdir -p` 目标也必须用 `shellPath(installDir)`。

3. 改 `ssh-command.ts` 的启动命令：
   - `exec ${shellQuote(input.entrypoint)}` 改为 `exec ${shellPath(input.entrypoint)}`。
   - `--home ${shellQuote(input.home)}` 改为 `--home ${shellPath(input.home)}`，确保远端 server 收到的是真实 HOME 路径或可被 shell 展开的参数。注意：这里最终 argv 应该是展开后的路径，不是字符串 `"$HOME"/...`；shell command 表达式会负责展开。
   - `buildSourceRemoteServerCommand()` 的 `cd ${shellQuote(remoteRepo)}` 和 `--home` 也应使用同一 helper；如果 `remoteRepo` 默认空字符串且只在 source mode 使用，保持现状但测试覆盖 `~/repo`。

4. 增加单测：
   - `ssh-command.test.ts`：`buildRemoteServerCommand({ entrypoint: "~/.llm-space/...", home: "~/.llm-space-server" })` 不包含 `exec '~/.llm-space`，应包含 `exec "$HOME"/` 或等价表达。
   - `remote-server-installer.test.ts`：使用 `remoteInstallDir: "~/.llm-space/remote-runtime"` 构建 install command，不得包含 `INSTALL_DIR='~/.llm-space/remote-runtime'`，应包含 `$HOME`。
   - `_hasInstalledPackage()` 相关命令中 `cat` 和 `test -x` 不能 quote 成 `'~/.llm-space/...`。

**成果**：安装、校验、启动三处路径语义一致。默认远端路径不会再创建字面量 `~/` 目录。

**命令**：
    bun test apps/desktop/src/bun/remote/ssh-command.test.ts apps/desktop/src/bun/remote/remote-server-installer.test.ts

**验收**（刚性量化指标）：
- 测试全部 PASS，0 fail。
- `rg "'~/|=~/.llm-space|exec '~" apps/desktop/src/bun/remote` 无生产代码生成路径的静态风险命中；若测试 fixture 命中，需确认是断言禁止项。
- 对 `remoteInstallDir: "~/.llm-space/remote-runtime"`，生成的远端命令包含 `$HOME`，不包含 `INSTALL_DIR='~/.llm-space/remote-runtime'`。

### Milestone 2: 移除 health-check 失败后的重装 retry，并补充失败诊断

**范围**：编辑 `apps/desktop/src/bun/remote/ssh-remote-runtime.ts`、`apps/desktop/src/bun/remote/remote-server-installer.ts`、`apps/desktop/src/bun/remote/ssh-error.ts`、`apps/desktop/src/bun/remote/remote-exec.ts` 及对应测试。

具体修改：

1. 在 `ssh-remote-runtime.ts` 中删除 `parseMissingRuntimeBinaryFailure()` 驱动的 retry 分支。`startSshRemoteRuntime()` 应是单次 install + 单次 start + 单次 health-check。`_startInstalledRuntime()` 失败后直接抛错。
2. 删除 `cleanRemoteRuntimeInstallArtifacts()` 的 import、调用和函数定义；删除 `remote-server-installer.test.ts` 中“cleans only remote runtime install artifacts”测试。
3. 修改 `ssh-error.ts` 的 missing runtime binary 文案，去掉“will reinstall ... once and retry”。建议文案：`Check the remote install directory, permissions, and whether the runtime package was installed under a literal '~' directory.`
4. 增加轻量失败诊断。推荐在 `_startInstalledRuntime()` catch 分支或 `_waitForHealth()` 发现 remote server 进程退出时，对 missing binary 类错误追加一次远端只读诊断。诊断命令采集：
   - `HOME`、`PWD`、`USER`
   - `entrypoint`、`remoteInstallDir`、`remoteHome`
   - `ls -ld` entrypoint、package dir、install dir
   - `test -e` 与 `test -x` 结果
   - `server-manifest.json` 前几 KB 内容
   - 是否存在 `"$PWD/~/.llm-space"` 这类字面量目录
5. 诊断必须是 best-effort：诊断失败不能覆盖原始错误；最多追加 `Remote diagnostics failed: ...`。
6. 改写 `ssh-remote-runtime.test.ts`：删除 retry 成功、二次失败、清理调用断言；保留或新增单次失败测试，断言 missing runtime binary 直接失败且 `installRemoteServerPackage` 只调用 1 次。新增诊断 mock 测试，断言最终错误包含 `HOME=` 或 `entrypoint_exists=`。

**成果**：health-check 或 server-start 阶段失败不再触发安装器重试；错误文案与真实行为一致，且下一次类似问题能一次看到路径证据。

**命令**：
    bun test apps/desktop/src/bun/remote/ssh-remote-runtime.test.ts apps/desktop/src/bun/remote/ssh-error.test.ts apps/desktop/src/bun/remote/remote-server-installer.test.ts

**验收**（刚性量化指标）：
- `rg "cleanRemoteRuntimeInstallArtifacts|reinstall retry|Remote runtime binary missing; reinstalling package" apps/desktop/src/bun/remote` 无生产代码命中。
- `ssh-remote-runtime.test.ts` 中 missing binary 场景断言 `installCalls === 1`。
- missing binary 错误文案不包含 `will reinstall`。
- 上述 bun test 全部 PASS，0 fail。

### Milestone 3: 收敛 Settings Remote 的 Connect 入口

**范围**：编辑 `apps/desktop/src/components/settings/remote-servers-page.tsx`，必要时编辑 `apps/desktop/src/components/settings/remote-server-display.ts` 与测试。

具体修改：

1. 删除左侧 server 列表项里的 `RemoteConnectionButton`。列表项只保留 server 基本信息和状态图标：trust-required 用 `ShieldAlert`，connecting 用 `Loader2`，connected 可保留 `Check` 或当前状态可视标识，但不提供连接操作。
2. 删除 `RemoteServerDetails` header 右侧的 `RemoteConnectionButton`。header 只展示名称和 `user@host`。
3. 在 `RemoteServerDetails` 底部按钮组中，将 `Connect/Disconnect` 按钮放到 `Edit` 之前：
   - `connected` 时显示 `Disconnect`，`variant="secondary"`，`disabled={busy}`。
   - 非 connected 时显示 `Connect`，`disabled={busy || server.status === "connecting" || server.status === "trust-required"}`。
   - connecting 时按钮文案可显示 `Connecting` 并带 `Loader2`，避免用户误解。
4. 如果 `RemoteConnectionButton` 组件完全不再使用，则删除它。若 `remoteConnectionAction()` 只服务该组件，也删除 helper 与测试；否则保留必要 helper。

**成果**：Settings → Remote 页面只有详情页底部一个 Connect/Disconnect 入口，且位于 Edit 左边。

**命令**：
    bun test apps/desktop/src/components/settings/remote-server-display.test.ts

**验收**（刚性量化指标）：
- `apps/desktop/src/components/settings/remote-servers-page.tsx` 中 `RemoteConnectionButton` 出现次数为 0。
- `remote-servers-page.tsx` 中左侧列表项不调用 `connectRemoteServer` / `disconnectRemoteServer`；连接动作只从 `RemoteServerDetails` 传入按钮触发。
- 如运行 `bun test apps/desktop/src/components/settings/remote-server-display.test.ts`，全部 PASS，0 fail。

### Milestone 4: 文档与计划状态同步

**范围**：更新受本次改动影响的文档与计划记录。

具体修改：

1. 更新 `docs/remote-runtime.md` 和 `docs/remote-runtime.zh-CN.md`：
   - 说明默认远端安装目录 `~/.llm-space/remote-runtime` 会被解析为远端用户 `$HOME/.llm-space/remote-runtime`。
   - 删除“同次连接自动重装一次”的描述，改为“复用前校验；启动/health-check 失败时直接报错并附诊断，用户可检查 install dir 权限、磁盘、外部清理任务或字面量 `~/` 目录”。
2. 在 `docs/plans/active/2026-07-25/ssh-remote-runtime-self-healing.md` 末尾追加修订说明，标明该计划中的 health-check 自愈重装已被本计划取代，不再代表当前目标行为。
3. 更新本 ExecPlan 的进度追踪、成果与复盘。

**成果**：仓库文档不会继续承诺已删除的 retry 行为，并记录 `~` 路径语义。

**命令**：
    rg -n "reinstall.*once|重装一次|reinstalling package|self-healing|自愈|literal '~'|字面量" docs apps/desktop/src/bun/remote apps/desktop/src/components/settings

**验收**（刚性量化指标）：
- 除历史计划的 superseded 说明外，文档和生产代码不再承诺 health-check 失败自动重装 retry。
- `docs/remote-runtime.md` 与 `docs/remote-runtime.zh-CN.md` 均更新。
- 文档明确 `~` 是远端 HOME，不是本机 HOME，也不是字面量目录。

## 具体步骤

    # 在仓库根目录执行，确认基线
    git status --short
    git rev-parse --abbrev-ref HEAD
    git rev-parse HEAD
    # 预期输出：工作区状态可解释；分支为 feat/support-ssh-remote；SHA 为本计划记录或其后续提交。

    # Milestone 1 后执行
    bun test apps/desktop/src/bun/remote/ssh-command.test.ts apps/desktop/src/bun/remote/remote-server-installer.test.ts
    rg -n "'~/|=~/.llm-space|exec '~" apps/desktop/src/bun/remote
    # 预期输出：测试全部 PASS；生产代码不再生成 quote 后的 tilde 路径。

    # Milestone 2 后执行
    bun test apps/desktop/src/bun/remote/ssh-remote-runtime.test.ts apps/desktop/src/bun/remote/ssh-error.test.ts apps/desktop/src/bun/remote/remote-server-installer.test.ts
    rg -n "cleanRemoteRuntimeInstallArtifacts|reinstall retry|Remote runtime binary missing; reinstalling package|will reinstall" apps/desktop/src/bun/remote
    # 预期输出：测试全部 PASS；生产代码无 retry/clean/旧承诺命中。

    # Milestone 3 后执行
    bun test apps/desktop/src/components/settings/remote-server-display.test.ts
    rg -n "RemoteConnectionButton" apps/desktop/src/components/settings/remote-servers-page.tsx
    # 预期输出：测试全部 PASS；rg 无命中。

    # Milestone 4 后执行
    rg -n "reinstall.*once|重装一次|reinstalling package|will reinstall" docs apps/desktop/src/bun/remote apps/desktop/src/components/settings
    # 预期输出：除历史计划 superseded 说明外，无继续承诺 health-check 自动重装一次的内容。

    # 可选真实服务器验证；只在用户允许实际连接时执行
    ssh qiangenchao@10.37.112.248 'test -x "$HOME/.llm-space/remote-runtime/versions/4.4.6-beta.9/bin/llm-space-server"; echo executable:$?'
    # 预期输出：修复后重新连接安装，应为 executable:0。若旧字面量目录仍存在，不影响新正确目录。

    # 最终回归，时间允许时执行
    mise run typecheck
    # 预期输出：零 TypeScript 错误。

## 验证与验收

- [ ] 远端路径展开：`bun test apps/desktop/src/bun/remote/ssh-command.test.ts apps/desktop/src/bun/remote/remote-server-installer.test.ts` 全部 PASS，0 fail。
- [ ] tilde 风险扫描：`rg -n "'~/|=~/.llm-space|exec '~" apps/desktop/src/bun/remote` 无生产代码风险命中。
- [ ] retry 移除：`rg -n "cleanRemoteRuntimeInstallArtifacts|reinstall retry|Remote runtime binary missing; reinstalling package|will reinstall" apps/desktop/src/bun/remote` 无生产代码命中。
- [ ] runtime 单测：`bun test apps/desktop/src/bun/remote/ssh-remote-runtime.test.ts apps/desktop/src/bun/remote/ssh-error.test.ts apps/desktop/src/bun/remote/remote-server-installer.test.ts` 全部 PASS，0 fail。
- [ ] UI 入口收敛：`rg -n "RemoteConnectionButton" apps/desktop/src/components/settings/remote-servers-page.tsx` 无命中。
- [ ] UI helper 测试：`bun test apps/desktop/src/components/settings/remote-server-display.test.ts` 全部 PASS，0 fail；如删除该测试对应 helper，则该命令应替换为相关剩余测试且记录原因。
- [ ] 文档一致：`docs/remote-runtime.md` 和 `docs/remote-runtime.zh-CN.md` 不再描述 health-check 失败自动重装 retry，并明确 `~` 代表远端 HOME。
- [ ] 类型检查：若执行 `mise run typecheck`，必须零错误；若因环境缺依赖失败，记录具体失败原因，不宣称通过。

## 文档更新

需要更新：

- `docs/remote-runtime.md` — 移除同次连接自愈重装描述，改成失败诊断建议；补充 `~` 被解析为远端 HOME。
- `docs/remote-runtime.zh-CN.md` — 同步中文说明。
- `docs/plans/active/2026-07-25/ssh-remote-runtime-self-healing.md` — 追加 superseded 修订说明，避免历史计划误导。
- 本文件 `docs/plans/proposal/2026-07-25/remote-settings-connect-and-health-check-retry-removal.md` — 作为当前活计划持续更新。

不需要更新：

- `docs/settings*.md` — 本次改变 Settings Remote 按钮布局，但现有 settings 文档未描述该按钮细节；如实现时发现已有截图/文字直接冲突，再补充更新。
- `docs/core-concepts*.md` — 不改变核心概念。

## 幂等性与恢复

- 路径 helper 修改可重复验证：所有 `~/...` 远端命令表达都应包含 `$HOME`，而不是被单引号包住的 `~`。
- 不自动删除远端 `/data00/home/qiangenchao/~`。如果用户要清理，应先确认其中只包含错误安装产物，再手动删除。
- UI 修改是纯渲染位置调整；重复应用时以 `RemoteConnectionButton` 无命中、底部按钮组包含 Connect/Edit/Remove 顺序为准。
- retry 移除可通过 `rg` 验证；若中断，先检查 `ssh-remote-runtime.ts` 是否仍 import `cleanRemoteRuntimeInstallArtifacts` 或使用 `parseMissingRuntimeBinaryFailure` 控制重试。
- 删除 `cleanRemoteRuntimeInstallArtifacts()` 若导致测试或导出失败，优先删除测试引用和 import，而不是保留死代码。
- 不使用 `git reset --hard` 或 `git checkout --` 回滚。若需要对比历史布局，用 `git show <commit>:<path>` 读取，不覆盖工作区。

## 产物与备注

根因调查关键证据：

- 当前 UI 重复入口：`apps/desktop/src/components/settings/remote-servers-page.tsx` 左侧列表项渲染 `RemoteConnectionButton`，详情页 header 也渲染 `RemoteConnectionButton`。
- 历史目标布局：`git show 4e5ac57^:apps/desktop/src/components/settings/remote-servers-page.tsx` 显示底部操作区先 `Connect/Disconnect`，后 `Edit`，再 `Remove`。
- retry 引入点：`9c916e4 fix: 修复 SSH 远端 runtime 自愈重装` 修改 `ssh-remote-runtime.ts`，新增 missing binary 后清理安装产物并重装 retry 的分支。
- 远端路径 bug 证据：`ssh qiangenchao@10.37.112.248` 上，`/home/qiangenchao/.llm-space` 不存在，但 `/data00/home/qiangenchao/~/.llm-space/remote-runtime/versions/4.4.6-beta.9/bin/llm-space-server` 存在且可执行。
- shell 语义证据：单引号包住 `~` 后不会做 tilde expansion；当前 command builder 使用 `shellQuote("~/.llm-space/...")`，导致 `~` 变成普通路径片段。
- 死代码候选：`cleanRemoteRuntimeInstallArtifacts()` 仅被 retry 分支和测试使用。

问题服务器只读诊断摘要：

```text
USER=qiangenchao
HOME=/home/qiangenchao
PWD=/data00/home/qiangenchao
/home/qiangenchao/.llm-space: No such file or directory
/data00/home/qiangenchao/~/.llm-space/remote-runtime/versions/4.4.6-beta.9/bin/llm-space-server: exists, executable
```

前端实操步骤清单：

1. 打开桌面应用，进入 Settings → Remote。
2. 添加或选择一个 remote server。
3. 观察左侧列表项：只有 server 信息和状态图标，无 Connect/Disconnect 按钮。
4. 观察详情页 header：只有名称和 endpoint，无右上 Connect/Disconnect 按钮。
5. 观察详情页底部操作区：`Connect/Disconnect` 在 `Edit` 左边，`Remove` 在后。
6. 点击 Connect，验证连接流程仍展示 progress，按钮 busy 状态不允许重复点击。

如需要截图，执行阶段将保存到本计划目录附近的 `artifacts/` 下并在此引用。

## 接口与依赖

本计划不新增外部依赖。

计划新增或调整的内部接口：

```ts
export function shellQuote(value: unknown): string;

// 用于远端 shell 命令中的路径表达。
// 开头的 ~/ 被转换成远端 "$HOME"，其他路径继续安全 quote。
export function shellPath(value: string): string;

// 用于拼接远端逻辑路径，避免散落 `${base}/foo` 后忘记 shellPath。
export function joinRemotePath(base: string, ...parts: string[]): string;
```

计划删除或收敛的内部接口：

```ts
// 删除：health-check retry 清理入口
export async function cleanRemoteRuntimeInstallArtifacts(
  config: SshRemoteRuntimeConfig,
  run?: RemoteCommandRunner
): Promise<void>;
```

计划保留的内部接口：

```ts
// 可继续用于错误文案分类；不再用于 retry 状态机。
export function parseMissingRuntimeBinaryFailure(
  output: string
): MissingRuntimeBinaryFailure | null;
```

## 后续修复记录（Phase 6）

暂无。

---

[2026-07-25 20:39:00+08:00] 修改说明：基于 `ssh qiangenchao@10.37.112.248` 的只读复刻证据，新增 Milestone 1 修复远端 `~` 路径展开，并将执行顺序调整为先修路径、再删 retry、再收敛 UI。


---

[2026-07-25 21:06:00+08:00] 修改说明：完成全部里程碑和 Phase 5；记录测试、typecheck、lint、diff check 验收结果。
