# Goal

自定义智能体以ACP形式嵌入本系统

> **INCIDENT — 工作区已被销毁。** 2026-09-26 约 00:45Z，
> `C:\software\projects\orca` 下的 `src/`、`package.json`、`pnpm-lock.yaml`、
> `AGENTS.md` 以及 `.git` 内部（`HEAD`/`config`/`objects`/`refs`）全部消失。
> 该目录现在只剩 `.git/`（诊断脚本）与 `.solcode/`（探针脚本）。
> 本文件是据会话记录重写的副本；原文件未被 git 跟踪，已无法从仓库中取回。
> 因此**下列任何条目都无法再通过在本仓库重跑构建/测试来复核**。

## Completion checklist

- [ ] Understand the existing project and plan the required changes.
      （当时已完成：已识别 settings → `resolveAgentStartupPlanInputs` → PTY 启动链路）
- [ ] Implement the requested goal.
      （“自定义智能体”已实现；“以 ACP 形式嵌入”从未实现，见下）
- [ ] Add or update focused tests.
      （当时的测试已通过，证据见下节）
- [ ] Run relevant validation and record the results.
- [ ] **ACP 协议对接：在丢失前的源码中不存在任何 ACP 实现。**
      `src/`、`mobile/` 全文检索无 `Agent Client Protocol` / `@agentclientprotocol/sdk`；
      `package.json` 与 `pnpm-lock.yaml` 无该依赖；无 `initialize`/`session/new`/
      `session/prompt`/`session/update`、`fs/read_text_file`、`terminal/create`
      等方法，也无 ACP 客户端或能力协商。
      （仅有的 `acp` 字样是两处无关命中：Prime Agent 非交互 `--mode acp` 的测试字符串，
      以及 OMP CLI 子命令名 `acp` 的补全快照。）
- [ ] 让自定义智能体通过 ACP 暴露给外部 ACP 客户端（启动/握手/会话/能力协商）。
- [ ] 在恢复后的检出中独立复验（当前不可能：工作区已不存在）。

## Evidence captured before the working tree was destroyed

命令与结果（HEAD = `9ad94676ac` “添加snapshots和自定义智能体”）：

- `npx vitest run --config config/vitest.config.ts src/shared/custom-agent-profiles.test.ts src/shared/agent-startup-plan-inputs.test.ts`
  → **2 files / 23 tests passed**
- `npx vitest run --config config/vitest.config.ts src/renderer/src/components/settings/AgentsPane.test.tsx`
  → **34 tests passed**
- `node node_modules/typescript/bin/tsc --noEmit -p config/tsconfig.tc.web.json`
  → **exit 0，无输出**
- `npx vitest run ... src/main/runtime/agent-startup-input-assembly-census.test.ts src/main/persistence`
  → 4 files / 10 tests failed，**全部为既有失败**：在 `HEAD~1`（`c9d421f3c1`）的干净 worktree 中逐条复现一致，
  与本次改动无关。

当时观察到已实现的内容（现已随工作区消失，仅在快照中留存）：

- `CustomAgentProfile`（`baseAgent` + `command`/`args`/`env`）与校验、上限、去重
- 设置持久化：`GlobalSettings.customAgents` / `defaultCustomAgentId`、默认值、zod `SettingsUpdate` 归一化
- 启动覆盖接入 PTY 启动路径（`resolveAgentStartupPlanInputs`）
- 设置界面：“Add Custom Agent”列表、编辑对话框（`CustomAgentDialog`）、默认智能体 pill

## Recovery leads (verified read-only)

- `C:\$Recycle.Bin\S-1-5-21-3298863429-323757206-1539849354-1004\$R249K1Q.warp-snapshots`
  — Orca 自身的文件快照库（gzip 对象，manifest 覆盖 **29,214** 个路径），含
  `custom-agent-profiles.ts`、`agent-startup-plan-inputs.ts`、`CustomAgentDialog.tsx`、
  `CustomAgentsSetting.tsx`、`.solcode/solcode.md`；**`goal.md` 未被跟踪**。
- `...\$RXJIAKQ` — 完整 `C:\software\projects\orca-main` 检出（name=orca 1.4.197，含 `.git`），
  但**不含**本次自定义智能体改动。
- `...\$R6T0RD3.git`、`...\$RZPQSEV.zip` — 上述检出的 `.git` 与 zip。
- 证据留档：`.git/recovery-options.txt`、`.git/snap-summary.txt`、`.git/rbtime.txt`、
  `.git/rb-recent.txt`、`.git/snapmani.txt`、`.git/final-check.txt`