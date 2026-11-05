# Changelog

本文件记录 dsh-requirement-copilot 的所有重要变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)：`MAJOR.MINOR.PATCH`。
仓库源在 Gitee `coreyleung/requirement-copilot`，公开镜像在 GitHub `coreyleung-art/dsh-requirement-copilot`；不提供公开 compare 链接，改用 tag 名与提交标题定位版本。

发布约定：

1. 每个用户可见的改动先写入 `[Unreleased]`；
2. 发布时把 `[Unreleased]` 的内容移到新的版本号下并补上日期；
3. 同步修改 `package.json` 的 `version`；
4. 提交标题使用 `chore(release): vX.Y.Z`；
5. 打 annotated tag：`git tag -a vX.Y.Z -m "vX.Y.Z"`。

## [Unreleased]

### Added

- 暂无。

## [1.6.0] - 2026-11-05

### Changed

- 发布身份统一为 `dsh-requirement-copilot`：源码 `package.json.name`、`cordis.patch.yml` bundle name、Client module id、npm 包名、GitHub repository 全部对齐；profile 的 `link:` 依赖同步改为 `dsh-requirement-copilot`。
- 移除源码 `private: true`，加入 `publishConfig`（public）；旧 `@local/requirement-copilot` profile 依赖被替换。
- GitHub 公开镜像 `coreyleung-art/dsh-requirement-copilot` 建立，Gitee 保留为源镜像。
- 构建脚本不再做包名替换，只负责生成干净 tarball。

### Migration

- 已有安装需把 profile 依赖从 `@local/requirement-copilot` 改为 `dsh-requirement-copilot`（本机已更新并建立 junction）。

## [1.5.1] - 2026-11-05

### Added

- 新增分发材料：`scripts/build-dist.mjs` 生成公开包 `dsh-requirement-copilot` 与 `npm pack` tarball；`docs/DISTRIBUTION.md` 覆盖 npm/GitHub/dshbase 流程；`docs/MARKETPLACE_LISTING.md` 提供中英上架文案；`.github/workflows/publish.yml` 用于 GitHub 镜像发布。
- 源码 `package.json` 增加 keywords、engines、repository/homepage/bugs 元数据。

### Changed

- 公开包名确定为 `dsh-requirement-copilot`；源码开发名保持 `@local/requirement-copilot`，构建时替换 bundle/模块 id。

## [1.5.0] - 2026-11-05

### Added

- 新增**多轮续写**：结果区输入反馈后，把上一版 Prompt + `revisionNote` 发给 Host 做增量修改，最多 5 轮；保留未要求改变的内容。
- 新增**版本对比**：历史条目可逐行 diff，结果区可「对比上一版」；`+`/`-`/保留行分色显示，最多 500 行/版本。

### Changed

- 测试增至 27 个（续写参数与模型消息断言）。

## [1.4.0] - 2026-11-05

### Added

- 确认门改为**一次一题**：显示进度、候选答案（模型 `gapChoices`，缺失时确定性兜底）与「补充说明」输入；支持上一题/下一题/跳过本题，回答可组合选项与自由文本。
- 模型输出新增可选 `analysis.gapChoices`（与 gaps 一一对应，0–4 个候选答案）；Host 校验条数一致，结果透传给面板。
- 面板标题栏可**拖拽移动**，带视口边距约束；双击标题栏恢复默认位置，方便查看被遮挡的内容后再回来继续输入。

### Changed

- 测试增至 26 个（gapChoices 对齐校验、确认门文案键）。

## [1.3.0] - 2026-11-05

### Added

- 新增**质量自检**：Host 用固定规则给结果打 0–100 结构分（结构/需求/验收/约束/gaps/中英对齐/目标），不额外调用模型；面板显示分数、可交付等级与逐项检查。
- 新增**场景预设**：通用 / 编码 / 写作 / 调研 / 数据 / 自动化；一键套用推荐用途与详略，并把场景提示写进模型消息（`scenario` 参数，命令与工具共用）。
- 新增**历史版本**：每个会话在浏览器 `localStorage` 保留最近 10 个模型结果，可载入或清空；历史只在本机，不同步。

### Changed

- README 补充场景、质量自检、历史版本的用法、隐私与限制。
- 测试增至 25 个（场景参数、场景回退、质量检查、locale 键）。

## [1.2.0] - 2026-11-05

### Added

- 新增「开工前确认门」：模型返回 gaps 时，面板逐题展示；用户回答后作为 `clarifications` 重新生成，或跳过直接使用当前结果。
- 一键整理遇到 gaps 时不再直接写回输入框，先进入确认门；回答/跳过后才写回，避免把未确认假设直接塞进输入框。
- Host 支持 `clarifications` 参数（命令与工具共用），最多 6 条问答，写进模型消息并优先采用；工具 schema 同步。

### Changed

- 测试增至 23 个（确认门参数、非法问答过滤、gate locale 键）。

## [1.1.0] - 2026-11-05

### Added

- 新增目标预设 `generic` / `claude-code` / `codex` / `cursor`：Host 端在 Prompt 标题后加入固定环境提示，结果 `meta.target` 可追溯；Client 面板增加「目标」选择器，本地兜底同样带目标提示。
- 新增 `evals/` 质量评测集：20 个真实风格 case、结构检查 runner（`node evals/run-eval.mjs`）与人工评分标准（`evals/rubric.md`）；支持 OpenAI 兼容端点的 `--live` 基线模式。
- 测试增至 21 个（目标预设、目标提示、默认/非法 target 回退、locale 键）。

### Changed

- 面板选项从一行拆成两行（用途/详略 + 语言/目标），避免四个选择器在窄屏拥挤。
- 修复模型失败回退时 `detail` 变量被错误信息覆盖的问题（改名 `failureMessage`）。

## [1.0.5] - 2026-11-05

### Added

- 新增 MIT `LICENSE`，`package.json` 声明 `license: MIT` 并把 `LICENSE` 加入打包文件；README 第 13 节改为 MIT 许可说明，移除「未附带 LICENSE」限制。

### Changed

- 产品显示名由「需求助手 / Requirement Copilot」改为「帮我说 / Say It For Me」，同步更新 Client 文案、locale 元数据、命令/错误提示、图标 label、README 与 package 描述；技术包名、bundle id、命令/工具/skill 标识保持不变。历史版本记录中的旧名称保留原样。

## [1.0.4] - 2026-11-05

### Added

- 新增 `node:test` 回归测试套件（`tests/host.test.mjs`、`tests/client.test.mjs`，共 19 个用例）与 `npm test` / `node --test` 入口。
- README 增加「测试」说明（覆盖范围、运行方式、不依赖 Harness 与真实模型）。

## [1.0.3] - 2026-11-05

### Fixed

- 「恢复原草稿」按钮缺少本地化 key，界面显示字面量 `action.restore`；已补中英文文案。
- 生成期间用户修改输入框时，自动写回可能覆盖新内容：现在读取最新草稿，内容已变化则不覆盖。
- 输入框已包含同一段结果时，点击「插入到输入框」会重复追加；现在识别为已存在并跳过。
- 手动插入/替换/恢复草稿后未同步 `applied` 标记，影响再次点击 ✨ 时的判断；现在都会同步。

### Changed

- 需求文本框增加可访问名称与 8000 字符输入上限；错误区 `role="alert"`、提示区 `role="status"` + `aria-live="polite"`。
- 生成按钮改为显式回调，避免把点击事件当作输入参数。
- 清理未使用的 `section.summary` / `section.intent` 文案与 `.rcp-chevron` 样式。
- client.js 顶部注释更新为 `input.right` + `input.overlay` 双槽位实现。
- README 的 tag 列表改为指向 `git tag -n`，避免每次发版漂移。
- `package.json` 的 `files` 补上 `CHANGELOG.md`。

## [1.0.2] - 2026-11-05

### Fixed

- 发送（或手动清空）输入框后，需求助手浮层仍保留上一轮的生成结果与原草稿，导致下一轮可能重复展示/插入旧内容；现在输入框清空时会同时清理面板结果、恢复草稿、rough 与 applied 标记，保证每一轮独立。

## [1.0.1] - 2026-11-03

### Added

- 新增本 `CHANGELOG.md`，明确语义化版本与发布/tag 流程。
- README 增加版本管理约定：提交类型、tag 命名、发布步骤。

### Changed

- `package.json` 版本号升至 `1.0.1`（仅文档与发布流程，不含运行时行为变更）。

## [1.0.0] - 2026-11-03

首个可安装版本（tag `v1.0.0`，提交 `23bfe0d`）。

### Added

- 输入框工具行的 ✨ 触发按钮：输入框有内容时一键读取 → 生成 → 把整理好的 Prompt 写回输入框（浮层自动收起，可恢复原草稿）；输入框为空时打开浮层手动输入。
- 需求助手浮层：解析 / Prompt / 译文三个页签，支持插入到光标、替换输入框、复制。
- Host 结构化输出：模型只返回 `analysis` + `primary` + `translation` 内容字段，最终 Markdown 由固定模板确定性装配（agent / spec 两套固定小节，中英各一套）。
- 严格校验与一次自修复：字段必填、条数上限、意图枚举、语言校验、`gaps` 必须为问句、译文与原文条数一一对应；失败时把校验错误回填给模型重试一次。
- `refine_requirement` Agent 工具与 `/refine-prompt` 人类命令共享同一生成核心（一个操作、两个调用方）。
- 内嵌 `requirement-refine` runtime skill，指导模型何时与如何调用该工具。
- 模型或命令通道失败时的本地模板兜底。

### Fixed

- 模型输出被截断或不是合法 JSON 时，不再把原始 JSON 当作 Prompt 写回输入框；改为明确报错并保留原草稿。
- Client → Host 命令调用增加多种参数形态重试、命名空间解析与失败诊断（localStorage 诊断记录）。
- 生成失败时不再覆盖输入框内容；只有解析且校验通过的结果才会写回。

### Changed

- 初始形态由「输入框上方常驻条」改为「发送旁 ✨ 按钮 + 点击弹出的浮层」。
