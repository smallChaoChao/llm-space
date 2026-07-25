# SSH remote runtime 安装与 health-check 自愈修复

本 ExecPlan 是一份活文档。进度追踪、意外发现、决策日志 和 成果与复盘 章节必须随工作推进持续更新。

**创建时代码基线：**
- 分支：feat/support-ssh-remote
- Commit SHA：a4743a6826ab35f4a191ae6cb07f0d4e526643fd
- 时区：PRC (+08:00)
- 提交策略：完成后 squash 为一个语义完整的 commit

## 目标与全局视角

完成后，用户通过 SSH 连接远端 runtime 时，如果远端版本目录残缺、二进制缺失、二进制不可执行，或者安装后立即启动失败，LLM Space 会在同一次连接中完成可解释、有限次数的自愈重装，而不是让用户看到“下一次连接会重装”的死循环式错误。

用户可观察行为：连接失败发生在 `health-check` 且远端输出包含 `llm-space-server: No such file or directory` 时，客户端会自动清理对应远端版本目录并重装一次，然后重新启动 runtime；如果仍失败，错误信息会明确说明已经尝试过重装，并保留可操作诊断信息。

**需求对齐记录**（Phase 0 产出）：
- 用户原始需求：SSH 连接时，部分服务器在 health-check 阶段报 `Remote runtime binary is missing... llm-space-server does not exist or is not executable... reinstall the version on the next connect`，需要从长期根本角度修复。
- Agent 理解：当前行为把安装期可修复的不一致状态延迟到“下一次连接”，但用户实测部分服务器仍失败。目标不是隐藏错误，而是把安装验证、启动验证、自愈重装放到同一次连接闭环里。
- 已确认的边界：
  - 做：定位根因；新增一次性 reinstall retry；清理远端安装目录中的安装产物后重装；修正缺失二进制错误文案；补齐单测；按需更新远端 runtime 文档。
  - 不做：不引入无限重试；不绕过 manifest/checksum 校验；不改变 remote runtime release 包格式；不修改 SSH host key 逻辑；不处理用户示例里的 `.llim-space` 拼写本身，除非代码证据证明它来自客户端。
- 关键澄清问答：
  - Q: 是否需要立即写代码？ → A: 按用户要求先用 systematic-debugging 定义 bug 原因，并用 harness-exec-plan 创建改造方案；方案 review 通过后再执行。

## 进度追踪

- [x] (2026-07-25 19:30:37+08:00) Phase 0: 需求对齐完成
- [x] (2026-07-25 19:46:00+08:00) Phase 1: 根因调查完成
- [x] (2026-07-25 19:49:00+08:00) Phase 2: 方案撰写完成
- [x] (2026-07-25 20:08:00+08:00) Phase 3: 用户 Review 通过
- [x] (2026-07-25 20:13:00+08:00) Milestone 1: 增加缺失 runtime 二进制的结构化错误分类
- [x] (2026-07-25 20:24:00+08:00) Milestone 2: 增加同次连接的一次性清理重装 retry
- [x] (2026-07-25 20:31:00+08:00) Milestone 3: 更新文档与验证全量相关测试
- [x] (2026-07-25 20:31:00+08:00) Phase 5: 结果汇报
- [ ] (2026-07-25 19:49:00+08:00) Phase 7: 代码提交/PR 合并

## 意外发现

- 观察：错误文案“LLM Space will verify the remote runtime package and reinstall the version on the next connect.”是误导性的。当前 `ssh-remote-runtime.ts` 在 `_waitForHealth()` 失败后直接抛错，不会在同次连接里调用安装器重试；所谓“next connect”只依赖下一次完整进入 `installRemoteServerPackage()`。
  证据：`apps/desktop/src/bun/remote/ssh-remote-runtime.ts` 的 `_waitForHealth()` 只轮询 `client.connect()`，超时后抛 `SSH remote runtime bootstrap failed during health-check...`；`formatSshBootstrapFailure()` 在 `ssh-error.ts` 里把 `No such file or directory` 格式化成“下一次连接会重装”。

- 观察：安装器只在启动前校验已安装包。安装后它会再次调用 `_hasInstalledPackage()`，但启动命令和 health-check 之间仍可能出现二进制缺失或不可执行，包括远端目录被外部清理、同一 install dir 被其他客户端/进程并发修改、磁盘/权限/文件系统异常等。当前没有对这个边界做自愈。
  证据：`installRemoteServerPackage()` 安装后返回 `entrypoint`，`startSshRemoteRuntime()` 直接 `spawnManagedProcess("remote server", "ssh", buildRemoteServerArgs(...))`，之后 `_waitForProcessAlive()` 只等待 250ms，进程稍后退出会在 `_waitForHealth()` 内被归类为 health-check 失败。

- 观察：用户报错中的路径是 `/home/qiangenchao/.llim-space/...`，仓库默认值是 `~/.llm-space/remote-runtime`，当前代码没有 `.llim-space` 字面量。更可能是用户侧某个已保存配置或手输路径拼写错误，或用户转述拼写误差。即便如此，根因修复仍应覆盖“指定目录下二进制缺失”的状态机问题。
  证据：`rg "llim"` 未发现代码命中；`DEFAULT_REMOTE_INSTALL_DIR` 和 `ssh-bootstrap-config.ts` 默认值均为 `~/.llm-space/remote-runtime`。

- 观察：`ssh-error.ts` 只用字符串匹配生成用户文案，没有结构化错误类型。要在 `ssh-remote-runtime.ts` 中做 retry，不能依赖 UI 文案；应抽出可复用的分类函数或错误类。
  证据：`_formatMissingRuntimeBinary()` 是 `ssh-error.ts` 的私有函数，只返回字符串。

## 决策日志

- 决策：修复点放在 SSH remote runtime bootstrap 状态机，而不是只改错误文案。
  理由：用户失败发生在 `health-check`，本质是安装成功与启动可用之间的边界不一致。只修改“下一次连接”提示不会降低失败率。
  日期/作者：2026-07-25 / Codex

- 决策：自愈 retry 最多一次，并且只针对明确的 missing/non-executable runtime binary 分类。
  理由：这是长期正确的有限状态机修复。无限重试会掩盖权限、磁盘、包损坏等真实问题；非目标错误如认证失败、host key、端口占用不应触发重装。
  日期/作者：2026-07-25 / Codex

- 决策：重装前清理远端安装目录中的安装产物，而不是只删除当前版本目录。
  理由：用户实测问题可能来自残缺 `versions/`、坏的 `downloads/` 缓存、`current` 软链或上次安装遗留的 `.tmp-*`/`.pkg-*`/`.old-*`。长期正确的重装应把安装态恢复为干净状态。清理范围限定为 `remoteInstallDir` 下的安装产物：`versions/`、`downloads/`、`current`、`.tmp-*`、`.pkg-*`、`.old-*`；禁止清理 `remoteHome`，因为 `remoteHome` 默认是 `~/.llm-space-server`，里面包含 workspace 和 settings。
  日期/作者：2026-07-25 / Codex

- 决策：保留 checksum、manifest、`test -x` 校验，不新增跳过校验的快速路径。
  理由：远端执行二进制是信任边界，长期正确优先完整性校验。
  日期/作者：2026-07-25 / Codex

## 成果与复盘

Milestone 1 完成：`ssh-error.ts` 已导出 `parseMissingRuntimeBinaryFailure()`，可结构化识别 missing / not-executable runtime binary；`ssh-error.test.ts` 9 个用例全部通过。

Milestone 2 完成：`ssh-remote-runtime.ts` 已在 missing runtime binary 场景下清理安装产物并重装 retry 一次；`remote-server-installer.ts` 已新增 `cleanRemoteRuntimeInstallArtifacts()`，只清理 `remoteInstallDir` 下安装产物，不触碰 `remoteHome`；`ssh-remote-runtime.test.ts` 3 个用例和 `remote-server-installer.test.ts` 10 个用例全部通过。

### 完成汇报（Phase 5 产出）

**目标达成**：✅ 完全达成。SSH remote runtime 在启动/health-check 阶段发现 runtime binary 缺失时，会清理安装产物并同次连接重装 retry 一次。

**变更概览**：新增 `ssh-remote-runtime.test.ts`；修改 SSH 错误分类、安装器清理能力、SSH runtime 启动状态机、中英文 remote runtime 文档和本 ExecPlan。

**验收结果**：`bun test apps/desktop/src/bun/remote/ssh-error.test.ts apps/desktop/src/bun/remote/ssh-remote-runtime.test.ts apps/desktop/src/bun/remote/remote-server-installer.test.ts apps/desktop/src/bun/remote/remote-server-manager.test.ts`：35 pass / 0 fail；`mise run typecheck`：通过，0 错误；`git diff --check`：通过。

**已知风险/遗留**：当前 retry 通过单测覆盖状态机，未在真实 SSH 服务器上做端到端复测；如果 remote install dir 本身配置错误且不可写，仍会失败，但错误会停在安装/清理边界。

**建议后续**：在用户出问题的服务器上重新连接验证；如发现多客户端并发连接同一 install dir 仍有竞态，再考虑远端安装锁。

## 上下文与方向

SSH remote runtime 的主流程在 `apps/desktop/src/bun/remote/ssh-remote-runtime.ts`：

1. `startSshRemoteRuntime()` 调用 `installRemoteServerPackage()` 安装或复用远端包。
2. 安装器位于 `apps/desktop/src/bun/remote/remote-server-installer.ts`。它检测平台，计算 `versions/<desktop-version>`、`server-manifest.json`、`bin/llm-space-server`，若 `_hasInstalledPackage()` 返回 false，则下载/上传 release 包并解压安装。
3. 安装完成后，`startSshRemoteRuntime()` 用 `buildRemoteServerArgs()` 通过 ssh 执行 `${entrypoint} --host 127.0.0.1 --port ... --token ... --home ...`。
4. 随后启动 SSH tunnel，再由 `RemoteRuntimeClient.connect()` 调用远端 `/health`，确认 protocol/version/capabilities。
5. 如果远端 server 进程退出，`_waitForHealth()` 会读 `process.output()`，经 `formatSshBootstrapFailure()` 转换错误。

关键术语：
- remote runtime package：`apps/server/scripts/pack-server.ts` 生成的 `llm-space-server-<version>-linux-<arch>.tar.gz`，内含 `server-manifest.json` 与 `bin/llm-space-server`。
- entrypoint：安装后用于启动的绝对或带 `~` 的路径，目前是 `${remoteInstallDir}/versions/${version}/bin/llm-space-server`。
- health-check：本机通过 SSH tunnel 请求远端 server `/health` 的阶段，不只是 HTTP 健康检查，也承载“server 进程是否早退”的错误归因。

当前已存在的未提交修改：本工作开始前，工作区已有 remote server 连接切换、按钮 UI、display helper 相关改动；本计划执行时不得回滚或覆盖这些修改。

## 工作计划

### Milestone 1: 结构化识别缺失 runtime 二进制

**范围**：编辑 `apps/desktop/src/bun/remote/ssh-error.ts` 和对应测试。

将当前私有 `_formatMissingRuntimeBinary()` 拆成两层：一层导出纯分类函数，例如 `parseMissingRuntimeBinaryFailure(output): { path: string } | null`；另一层继续负责用户文案格式化。分类函数至少识别：

- `No such file or directory` 且输出里含 `.../llm-space-server`
- `Permission denied` 或 `not executable` 且输出里含 `.../llm-space-server`，用于覆盖“存在但不可执行”

错误文案从“下一次连接会重装”改成更准确的描述：如果自动修复最终失败，提示“LLM Space tried reinstalling the remote runtime package once; check permissions/disk/install dir”。具体措辞在实现中保持简短。

**成果**：`ssh-remote-runtime.ts` 可以不依赖用户文案，直接判断错误是否适合重装 retry。

**命令**：
    bun test apps/desktop/src/bun/remote/ssh-error.test.ts

**验收**（刚性量化指标）：
- `ssh-error.test.ts` 全部 PASS，0 fail。
- 新增至少 2 个断言：缺失二进制可解析 path；不可执行/permission denied 可解析 path。

### Milestone 2: 同次连接一次性清理重装 retry

**范围**：编辑 `apps/desktop/src/bun/remote/ssh-remote-runtime.ts`、`apps/desktop/src/bun/remote/remote-server-installer.ts` 及对应测试。

实现一个小状态机：

1. 首次安装后按现有流程启动远端 server、启动 tunnel、health-check。
2. 如果 server-start 或 health-check 捕获到 missing runtime binary 分类错误：
   - 停止已启动的 server/tunnel 进程，避免残留。
   - 发送 progress：`Remote runtime binary missing; reinstalling package`。
   - 远端执行限定范围清理命令：清理 `<remoteInstallDir>` 下的安装产物，包括 `versions/`、`downloads/`、`current`、`.tmp-*`、`.pkg-*`、`.old-*`。禁止清理 `remoteHome` / `~/.llm-space-server`。
   - 再次调用 `installRemoteServerPackage()`，这次应走正常安装路径，包括远端下载 2 分钟 / fallback 上传 / checksum / 解压 / `test -x`。
   - 重新启动 server、tunnel、health-check。
3. 第二次仍失败时，不再 retry，抛出包含“already retried reinstall once”的错误。

实现细节建议：
- 在 `remote-server-installer.ts` 新增导出函数，例如 `cleanRemoteRuntimeInstallArtifacts(config, run?)`，只删除 `remoteInstallDir` 下的安装产物，绝不删除 `remoteHome`。
- 在 `ssh-remote-runtime.ts` 内把一次启动过程拆成私有函数，例如 `_startInstalledRuntime(config, install, token, localPort, processes, options)`，便于失败后 cleanup 并复用。
- 如果失败发生在 tunnel 已启动之后，必须 stop 两个 ManagedProcess；如果失败发生在 server-start，只 stop 已创建的 server process。
- retry 不应吞掉原始错误。最终错误应包含原始 missing binary path 和 retry 失败详情。

**成果**：用户在遇到残缺版本目录或启动时二进制丢失时，同一次点击 Connect 可以完成一次重装自愈。

**命令**：
    bun test apps/desktop/src/bun/remote/ssh-remote-runtime.test.ts apps/desktop/src/bun/remote/remote-server-installer.test.ts

如果当前没有 `ssh-remote-runtime.test.ts`，则新增该文件，用 mock `installRemoteServerPackage` 或抽出可注入 runner 的方式覆盖 retry 状态机。不要使用真实 SSH。

**验收**（刚性量化指标）：
- 缺失二进制场景：第一次启动失败，触发一次清理 + 第二次安装 + 第二次启动成功，测试 PASS。
- 不可执行场景：触发同样 retry，测试 PASS。
- 非缺失二进制错误：不触发清理重装，测试 PASS。
- 二次失败场景：只 retry 一次，测试 PASS，错误信息包含 retry 已发生。
- `remote-server-installer.test.ts` 全部 PASS，0 fail。

### Milestone 3: 文档更新与全量相关验证

**范围**：更新 `docs/remote-runtime.md` 和 `docs/remote-runtime.zh-CN.md` 中关于 partial install / missing binary / download timeout 的描述。

文档应说明：
- 复用已安装包前会校验 manifest 与 `bin/llm-space-server`。
- 如果启动或 health-check 阶段发现 runtime binary 缺失/不可执行，LLM Space 会在同一次连接中清理当前版本并自动重装一次。
- 如果仍失败，用户应检查远端安装目录权限、磁盘空间、是否有外部清理任务、是否配置了错误的 remote install dir。

**成果**：文档与实际自愈行为一致。

**命令**：
    bun test apps/desktop/src/bun/remote/ssh-error.test.ts apps/desktop/src/bun/remote/remote-server-installer.test.ts apps/desktop/src/bun/remote/remote-server-manager.test.ts

可选扩展验证：
    mise run typecheck

**验收**（刚性量化指标）：
- 上述 bun test 全部 PASS，0 fail。
- 如果运行 `mise run typecheck`，必须零错误；若因环境缺依赖失败，记录具体失败原因，不宣称通过。
- 英文和中文文档都更新，且没有继续承诺“下一次连接才会重装”。

## 具体步骤

    # 在仓库根目录执行，确认当前基线和未提交改动
    git status --short
    # 预期输出：显示当前已有 remote 相关修改；不得回滚非本任务改动。

    # Milestone 1 后执行
    bun test apps/desktop/src/bun/remote/ssh-error.test.ts
    # 预期输出：全部 PASS，0 fail。

    # Milestone 2 后执行
    bun test apps/desktop/src/bun/remote/ssh-remote-runtime.test.ts apps/desktop/src/bun/remote/remote-server-installer.test.ts
    # 预期输出：全部 PASS，0 fail。

    # Milestone 3 后执行
    bun test apps/desktop/src/bun/remote/ssh-error.test.ts apps/desktop/src/bun/remote/remote-server-installer.test.ts apps/desktop/src/bun/remote/remote-server-manager.test.ts
    # 预期输出：全部 PASS，0 fail。

    # 最终类型验证，时间允许时执行
    mise run typecheck
    # 预期输出：零 TypeScript 错误。

## 验证与验收

- [ ] 缺失二进制分类：`bun test apps/desktop/src/bun/remote/ssh-error.test.ts` 全部 PASS。
- [ ] 一次性 retry：`bun test apps/desktop/src/bun/remote/ssh-remote-runtime.test.ts` 全部 PASS，覆盖成功 retry、非目标错误不 retry、二次失败不无限 retry。
- [ ] 安装器清理范围：`bun test apps/desktop/src/bun/remote/remote-server-installer.test.ts` 全部 PASS，断言清理命令只作用于 `remoteInstallDir` 下的安装产物，且不包含 `remoteHome`。
- [ ] 连接管理未回归：`bun test apps/desktop/src/bun/remote/remote-server-manager.test.ts` 全部 PASS。
- [ ] 文档一致性：`docs/remote-runtime.md` 与 `docs/remote-runtime.zh-CN.md` 均描述同次连接自动重装一次。

## 文档更新

需要更新：

- `docs/remote-runtime.md` — 更新 partial install / missing binary 的自愈行为说明。
- `docs/remote-runtime.zh-CN.md` — 同步中文说明。

不需要更新：

- `docs/settings*.md` — 本次不改变设置字段或 UI 表单字段。
- `docs/core-concepts*.md` — 本次不改变核心概念。

## 幂等性与恢复

- 清理远端安装产物的步骤限定到 `${remoteInstallDir}` 下的 `versions/`、`downloads/`、`current` 和安装临时目录，可安全重复执行；下次安装会重新创建。
- retry 最多一次；如果第二次失败，保留最终错误并停止，避免无限循环。
- fallback 上传缓存仍位于本机 settings 目录，不因远端版本目录删除而失效。
- 如果实现中断，恢复时先读取本 ExecPlan 的进度追踪，再执行 `git diff` 确认已完成的 milestone，不要重做或回滚用户已有修改。

## 产物与备注

根因调查关键证据：

- `apps/desktop/src/bun/remote/ssh-remote-runtime.ts`：安装、启动、tunnel、health-check 是线性流程；health-check 失败后没有重装 retry。
- `apps/desktop/src/bun/remote/remote-server-installer.ts`：安装器有 `_hasInstalledPackage()`，但只覆盖安装前/安装后校验，不覆盖启动时被外部破坏的竞态。
- `apps/desktop/src/bun/remote/ssh-error.ts`：missing binary 被格式化为用户文案，当前没有结构化分类供状态机使用。
- `apps/desktop/src/bun/remote/server-package.ts`：默认远端安装目录是 `~/.llm-space/remote-runtime`，仓库无 `.llim-space` 字面量。

## 接口与依赖

计划新增或调整的内部接口：

```ts
export interface MissingRuntimeBinaryFailure {
  path: string;
  reason: "missing" | "not-executable";
}

export function parseMissingRuntimeBinaryFailure(
  output: string
): MissingRuntimeBinaryFailure | null;

export async function cleanRemoteRuntimeInstallArtifacts(
  config: SshRemoteRuntimeConfig,
  run?: RemoteCommandRunner
): Promise<void>;
```

不新增外部依赖。继续使用 Bun test、现有 `ManagedProcess`、`RemoteCommandRunner` 和 OpenSSH 命令构造工具。

## 后续修复记录（Phase 6）

待填写。


---

[2026-07-25 20:05:00+08:00] 修改说明：根据用户反馈修订清理策略：从“只删除当前版本目录”改为“清理 remoteInstallDir 下全部安装产物”，同时明确禁止清理 remoteHome / ~/.llm-space-server，因为远端 workspace 与配置位于该目录下。

---

[2026-07-25 20:08:00+08:00] 修改说明：用户确认执行，将 ExecPlan 从 proposal 移动到 active，并标记 Phase 3 Review 通过。

---

[2026-07-25 20:13:00+08:00] 修改说明：完成 Milestone 1，新增 missing runtime binary 结构化分类并通过 ssh-error 单测。

---

[2026-07-25 20:24:00+08:00] 修改说明：完成 Milestone 2，新增安装产物清理和同次连接一次性重装 retry，并通过相关单测。

---

[2026-07-25 20:31:00+08:00] 修改说明：完成 Milestone 3 和 Phase 5，更新中英文文档，运行相关单测、typecheck 和 diff check 均通过。

---

[2026-07-25 20:59:00+08:00] 修改说明：本计划中的 health-check missing binary 自动清理重装 retry 已被 `docs/plans/active/2026-07-25/remote-settings-connect-and-health-check-retry-removal.md` 取代，不再代表当前目标行为。后续目标是修复远端 `~` 路径展开、删除 health-check retry，并在失败时输出诊断快照。
