# 帮我说 / Say It For Me

> 把零散、不完整、口语化的需求，整理成可直接交给 AI 智能体执行的 Prompt，并一键写回对话框输入框。

> 产品显示名：**帮我说 / Say It For Me**。技术包名、bundle id、命令/工具/skill 标识仍为 `requirement-copilot` 系列，以兼容已有安装与调用。

| 项 | 值 |
|---|---|
| 显示名 | 帮我说 / Say It For Me |
| 插件包名 | `dsh-requirement-copilot` |
| 分发包名 | `dsh-requirement-copilot`（npm 公开发布） |
| npm | `dsh-requirement-copilot@1.6.1` |
| 形态 | DSH Profile Bundle（Host 半 + Client 半，Web GUI 插件） |
| 版本 | `1.6.1`（tag `v1.6.1`） |
| 运行配置 | 无（`config: {}`） |
| 测试 | `node --test`，27 个用例；`evals/` 20 条质量评测 |
| 远端 | Gitee 私有仓库 `coreyleung/requirement-copilot` |
| 许可 | MIT（见 [LICENSE](LICENSE)） |

最后更新：2026-11-05 · 对应版本 `v1.6.1`

---

## 目录

1. [它解决什么问题](#1-它解决什么问题)
2. [功能一览](#2-功能一览)
3. [快速开始](#3-快速开始)
4. [使用指南](#4-使用指南)
5. [工作原理](#5-工作原理)
6. [输出契约](#6-输出契约)
7. [测试](#7-测试)
8. [开发与调试](#8-开发与调试)
9. [隐私与安全](#9-隐私与安全)
10. [已知限制与路线图](#10-已知限制与路线图)
11. [版本管理](#11-版本管理)
12. [维护信息（本机）](#12-维护信息本机)
13. [许可与贡献](#13-许可与贡献)

---

## 1. 它解决什么问题

给 AI 智能体派活时，人往往只写得出「做个周报工具，汇总 GitLab 提交发飞书」这种零散描述。智能体需要的是：目标、背景、交付物、约束、验收标准、输出格式，以及**缺失信息被显式列出**。

帮我说 做四件事：

1. **收集**：把输入框里的草稿、聊天记录、口头需求作为素材；
2. **分析补全**：复述真实意图，提取交付物/约束/假设，列出需要用户补充的 gaps；
3. **翻译成任务**：用固定模板生成一份可直接执行的 Prompt，并给出另一种语言版本；
4. **写回输入框**：一键插入/替换，不自动发送。

非目标：

- 不是聊天机器人，不替用户发送消息；
- 不做需求库/版本库管理；
- 不内置本地模型，不绕过 DSH 的模型与凭据配置；
- 不修改 Composer 之外的宿主 UI 结构。

---

## 2. 功能一览

- ✨ **发送旁触发按钮**：输入框有内容时点一下 = 一键整理；没有待确认问题时直接写回，有 gaps 时打开「开工前确认」门。
- **浮层面板**：粘贴/读取草稿，选择用途、详略、语言、目标环境，生成后按「解析 / Prompt / 译文」三个页签查看。
- **三种插入方式**：插入到光标（可撤销）、替换整个草稿（需确认）、复制。
- **恢复原草稿**：一键整理覆盖输入框后，可恢复整理前的原文。
- **严格输出契约**：模型只输出结构化字段，最终 Markdown 由 Host 固定模板装配，格式稳定。
- **一次自修复**：结构化校验不通过时，把错误回填给模型重试一次；仍失败则报错，不写回输入框。
- **失败不覆盖**：截断、非法 JSON、模型/通道失败都不会覆盖用户输入；浮层给出来自本地的模板兜底（需手动插入）。
- **一个操作、两个调用方**：`/refine-prompt` 命令（面板调用）与 `refine_requirement` Agent 工具共享同一套生成核心。
- **内嵌技能**：`requirement-refine` 指导模型何时、如何调用该工具。
- **澄清确认门**：一次一题；点选模型给的候选答案，或补充说明；回答作为 `clarifications` 重新生成，不覆盖原始描述。
- **可拖拽面板**：拖动标题栏移动浮层，双击标题栏恢复默认位置；查资料/看别处时不用关掉重开。
- **质量自检**：Host 用固定规则给结果打分（结构 / 需求条目 / 验收 / 约束 / gaps / 中英对齐 / 目标），只做结构检查，不额外调用模型。
- **场景预设**：通用 / 编码 / 写作 / 调研 / 数据 / 自动化，一键套用推荐用途与详略，并把场景提示写进模型消息。
- **历史版本**：每个会话在浏览器本地保留最多 10 个生成结果，可载入、清空。
- **继续优化**：在结果上补充下一句/修改要求，最多 5 轮；Host 把上一版 Prompt 作为增量修改输入，不从头重写。
- **版本对比**：历史版本可逐行 diff（新增/删除/保留），也可从结果区一键「对比上一版」。
- **测试**：27 个 `node:test` 用例，覆盖 Host 生成核心与 Client 模块契约；另有 20 条质量评测 case 与 rubric。

---

## 3. 快速开始

### 3.1 环境要求

- DSH Desktop（Web GUI）profile，且组合中已挂载 `commands` Remote 与 `llm` 服务；
- 开发与验证环境：Windows + DSH `0.2.1-rc.5` desktop profile + Node 24；
- 插件本身**没有 npm 依赖**，不需要构建步骤；Client 只从宿主模块表 `require('react')`；
- 运行测试需要 Node ≥ 20（使用 `node:test`）。

### 3.2 安装到 DSH Profile

1. 把本仓库放到一个固定目录（例如 `D:\dsh-plugins\requirement-copilot`）；
2. 在 DSH 的 Plugin Manager 里选择「从本地目录安装」，或让 Agent 调用 `plugin_manager` 的 `install_bundle`，`target` 传该目录的**绝对路径**；
3. 安装结果应为 `application: applied`（或提示刷新/重启，以 DSH 返回为准）；
4. 刷新一次 Web 页面，确认输入框工具行出现 ✨ 按钮。

> 本地开发时可以把 profile 里已安装的路径做成指向仓库的目录 junction，这样「仓库即唯一源码」，改动不需要重装。这是本机的维护方式，不属于插件的通用安装步骤。

### 3.3 从 npm 安装

公开发布包为 **`dsh-requirement-copilot`**，已发布到 npm。可直接：

```bash
dsh plugin add dsh-requirement-copilot
```

或在 Plugin Manager 里用 `install_bundle`，target 传 `dsh-requirement-copilot`。构建分发包、发布与上架流程见 [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md)。

### 3.4 验证安装

- 设置 → 插件：能看到「帮我说 / Say It For Me」，图标与中英文描述正常；
- 会话输入框工具行：出现 ✨ 按钮；
- 输入框为空时点 ✨，应打开浮层；
- `/` 命令目录中能看到 `refine-prompt`（面板专用，描述里已注明）；
- 仓库内运行 `node --test`，27 个用例应全部通过；`node evals/run-eval.mjs` 校验 20 条评测集。

### 3.5 卸载

在 Plugin Manager 中禁用或移除 bundle `dsh-requirement-copilot`。禁用后命令、工具、skill、面板与按钮都会随 Cordis effect 一并撤销。

---

## 4. 使用指南

### 4.1 一键整理

1. 在输入框里输入零散需求（建议保留原话，不要先总结）；
2. 点 ✨：
   - 读取当前草稿 → 生成；没有待确认问题时，把 Prompt **写回输入框** → 浮层自动收起；
   - 有 gaps 时**不写回**，打开浮层展示「开工前确认」：一次一题，点选候选答案或补充说明，回答后重新生成，或跳过并直接写回当前结果；
   - 生成期间不要清空输入框；若清空，插件会中止本次生成并清理面板状态；
   - 生成完成后如果输入框内容被改过，插件不会覆盖，而是提示「输入框内容已变化」。
3. 检查写回内容，按需编辑后自行发送。结果**不会自动发送**。
4. 想恢复整理前的原文：重新打开浮层，点「恢复原草稿」。

### 4.2 浮层面板

输入框为空时点 ✨ 打开浮层。浮层支持：

- 手动输入/粘贴需求；
- 「读取输入框」把当前草稿填入；
- 切换用途 / 详略 / 语言；
- 「生成 Prompt」「停止」「重新生成」；
- 生成后查看三个页签并插入/替换/复制；
- 拖动标题栏移动浮层，双击标题栏恢复默认位置；
- Esc、点击浮层外、再次点 ✨ 或右上角 × 关闭。

关闭浮层不会丢失当前结果；新一次生成会先清空上一轮结果。

### 4.3 选项

| 选项 | 取值 | 说明 |
|---|---|---|
| 用途 `mode` | `agent` / `spec` | `agent`：给智能体执行的任务指令；`spec`：结构化需求规格。两者使用不同的固定小节标题。 |
| 详略 `detail` | `concise` / `standard` / `detailed` | 控制各数组条数与 Prompt 长度；`concise` 输出上限更低。 |
| 语言 `language` | `auto` / `zh` / `en` | `auto` 按输入文本的中英文比例自动判断；主语言确定后，另一种语言自动作为译文。 |
| 目标 `target` | `generic` / `claude-code` / `codex` / `cursor` | `generic` 为通用 Markdown；后三者在标题后加一行固定的目标环境提示，不改变内容字段。 |
| 场景 `scenario` | `general` / `coding` / `writing` / `research` / `data` / `automation` | 只影响内容侧重（如编码的验收写测试），不改变输出结构；选择预设时会套用推荐的用途/详略。 |

### 4.4 结果与写回

- **解析**：需求复述、意图、交付物、约束、假设、待补充问题；
- **Prompt**：最终可执行的 Prompt（固定格式）；
- **译文**：主语言的另一种语言版本，结构与信息量对应；
- **插入到输入框**：写到当前光标处（可撤销）；
- **替换输入框**：覆盖整个草稿，草稿非空时需要二次确认；
- **复制**：复制当前页签内容；
- **恢复原草稿**：仅在本次整理覆盖过输入框时可用。

如果输入框已经是同一段内容，插入会被判定为「已存在」并跳过，避免重复追加。

#### 开工前确认门

当生成结果里 `analysis.gaps` 非空时，面板顶部会出现「开工前确认」：

- **一次只显示一题**，右上角有 `1 / N` 进度；
- 每题展示模型给出的候选答案（`gapChoices`，可点击）；模型没给时用确定性规则兜底（是/否、时间范围、范围大小等）；
- 选项下方始终保留「补充说明」输入框，可以只点选项、只写说明，或两者组合；
- 「上一题」「下一题」「跳过本题」可来回修改；最后一题的按钮变为「用回答重新生成」；
- 「跳过，直接使用当前结果」保留当前 Prompt，不重新调用模型；
- 一键整理时如果有 gaps，**不会立刻写回输入框**；回答或跳过之后才写回，避免把带着未确认假设的 Prompt 直接塞进输入框；
- 原始描述始终保留，回答只作为澄清上下文，不会覆盖原文。

#### 质量自检

结果页顶部会显示一个 0–100 的结构分（`meta.quality`）：

- 检查项：结构完整、需求条目、验收标准、约束/上下文、无待确认问题、中英对齐、目标环境；
- 分数 ≥90 显示「可交付」，70–89 显示「可用，建议补强」，低于 70 显示「建议先补强」；
- 这是**确定性自检**，不调用模型，也不冒充质量评审；详细的人工评分标准见 `evals/rubric.md`。

#### 历史版本

同一会话的最近 10 个模型结果会存在浏览器 `localStorage`（key 前缀 `rcp-history:`）：

- 在「解析」页底部可看到历史列表，点「载入」恢复该版本的 Prompt/分析/选项；
- 「清空」删除本会话历史；
- 历史只在本机浏览器，不同步、不上传；最多 10 条，超出后丢弃最旧的一条。

#### 继续优化（多轮续写）

结果区点「继续优化」后写一句反馈/下一句要求，例如「验收标准再严格一点，补上失败处理」：

- 最多 5 轮；Host 把上一版 Prompt 与反馈一起发给模型，要求做增量修改，保留未要求改变的内容；
- 新一轮结果仍会经过质量自检、确认门（如果有 gaps）和写回按钮；
- 续写记录会进入历史，可用「对比上一版」查看差异。

#### 版本对比

- 历史条目旁点「对比」，或结果区点「对比上一版」，会显示逐行 diff；
- `+` 表示新增行，`-` 表示删除行，未标记为保留行；
- 最多比较 500 行/版本，超出部分不展示，避免长 Prompt 卡顿。

### 4.5 人类命令 `/refine-prompt`

面板通过已挂载的 `commands` Remote 调用它。命令行为：

- 名称：`refine-prompt`；
- 参数：命令名后跟一个 JSON 请求对象；
- `recordInput: false`：输入不写入命令日志；
- 返回：`{ok:true, data}` 或 `{ok:false, code, error}`，承载在命令结果的 `text` 字段里；
- 命令生命周期会写入会话日志（log-only，不进入模型上下文）；
- 聊天区中该命令的行由插件的 `conversation.chat.commandview` 空渲染隐藏。

请求示例（手工调用时）：

```text
/refine-prompt {"rough":"给设置页加深色模式开关","mode":"agent","scenario":"coding","target":"generic","detail":"standard","language":"auto"}
```

### 4.6 Agent 工具 `refine_requirement`

模型可以自行调用，用于「帮我把这段需求整理成 prompt」这类请求。参数：

| 参数 | 必填 | 说明 |
|---|---|---|
| `rough` | 是 | 原始需求描述（可含零散笔记、聊天记录、口语） |
| `context` | 否 | 补充上下文：已有约束、技术栈、相关文件、背景 |
| `previousPrompt` | 否 | 上一版 Prompt；提供时做增量续写 |
| `revisionNote` | 否 | 用户对上一版的反馈/续写要求（最多 2000 字符） |
| `clarifications` | 否 | 用户对上一轮 gaps 的回答：`[{question, answer}]`，最多 6 条；Host 会写进模型消息，并优先采用 |
| `mode` | 否 | `agent`（默认）/ `spec` |
| `scenario` | 否 | `general`（默认）/ `coding` / `writing` / `research` / `data` / `automation` |
| `target` | 否 | `generic`（默认）/ `claude-code` / `codex` / `cursor` |
| `detail` | 否 | `concise` / `standard`（默认）/ `detailed` |
| `language` | 否 | `auto`（默认）/ `zh` / `en` |

返回结构化结果对象，并在工具结果中渲染成可读的 Markdown。与命令共享同一个 `generate()` 核心与同一套校验。

### 4.7 内嵌技能 `requirement-refine`

Host 半通过 `ctx.skills.register(...)` 注册一个 runtime skill（不依赖文件系统 skill provider）：

- `modelInvocable: true`、`userInvocable: false`；
- 告诉模型：何时该调用工具、参数怎么填、结果怎么呈现、gaps 与失败怎么处理、成本与隐私注意点；
- 用户侧仍使用 ✨ 面板与 `/refine-prompt`，避免多套入口重复。

---

## 5. 工作原理

### 5.1 数据流

```text
用户输入（Composer）
      │
      ├─(输入框有文字) ✨ ─┐
      └─(输入框为空) 浮层 ─┤
                          ▼
              Client: 组装请求 JSON
                          │  ctx.remote.commands.execute(sessionId, line, [], signal)
                          ▼
              Host: /refine-prompt handler
                          │
                          ▼
                  generate(request)
                          │  ctx.llm.stream({ provider, model, system, messages, maxTokens, signal })
                          ▼
              模型返回结构化 JSON（analysis / primary / translation）
                          │
                    JSON 解析 + 严格校验
                     ├─ 通过 ──────────────┐
                     └─ 失败 → 一次修复重试 ─┤
                                            ▼
                                确定性装配 Markdown Prompt
                                            │
                          ┌─────────────────┘
                          ▼
              command result.text（{ok,data} 的 JSON）
                          │
                          ▼
              Client: 显示解析/Prompt/译文
                          │
              ┌───────────┼────────────┬─────────────┐
              ▼           ▼            ▼             ▼
          插入光标     替换草稿       复制        恢复原草稿
```

Agent 工具路径相同，只是入口从命令换成 `refine_requirement` 工具，结果直接作为工具结果返回。

### 5.2 Host 半（`index.js`）

职责：

- 解析请求、限制长度、检测主语言；
- 通过 `ctx.llm.stream()` 调当前**默认模型**（`ctx.agentDefaultModel.currentSelection()`），缺失时回退到首个可用 provider/model；
- 要求模型只输出结构化内容字段，不输出 Markdown；
- 宽容提取 JSON（去代码围栏/前后文字），严格校验；
- 校验失败时把「上次输出 + 错误清单」回填给模型，**只重试一次**；
- 用固定模板装配最终 Prompt 与译文；
- 注册 `/refine-prompt` 命令、`refine_requirement` 工具、`requirement-refine` skill。

关键常量（`index.js` 顶部）：

| 常量 | 值 |
|---|---|
| `MAX_INPUT_CHARS` | 8000 |
| `MAX_CONTEXT_CHARS` | 3000 |
| `TIMEOUT_MS` | 120000 |
| `REPAIR_PREVIOUS_CHARS` | 7000 |
| 输出 token 上限 | `concise` 4096；`standard`/`detailed` 8192 |
| 输出文本硬上限 | 60000 字符 |

### 5.3 Client 半（`client.js`）

注册三个位置：

| Slot | 内容 |
|---|---|
| `conversation.input.right` | ✨ 触发按钮（发送/模型选择器旁） |
| `conversation.input.overlay` | 浮动面板（锚定输入卡片上沿，仅打开时可见） |
| `conversation.chat.commandview`（key `refine-prompt`） | 空渲染，隐藏命令回执行 |

状态与行为要点：

- 打开状态与「一键整理」请求按 **sessionId** 存在一个小型 store 里，按钮与面板通过它同步；
- 输入框由非空变空（发送/清空）时，自动清理上一轮结果、恢复草稿、原文与 `applied` 标记，保证新一轮独立；
- 自动写回前读取**最新**草稿（ref），内容已变化则不覆盖；
- 输入框已包含相同文本时，插入/替换会提示「已存在」并跳过；
- 模型结果带 gaps 时进入确认门：一次一题，候选答案 + 补充说明；一键整理不写回，回答或跳过后才写回；
- 标题栏可拖拽移动浮层（16px 视口边距约束），双击恢复默认位置；
- 继续优化走 `previousPrompt` + `revisionNote`，最多 5 轮；历史支持逐行 diff；
- 命令通道尝试多种参数形态（含/不含 AbortSignal、显式/隐式 agent），失败后带 `commands.list` 探测信息抛出；
- 结果写回通过 `InputActions.captureInsertion()` + `insertText()`（可撤销）或 `setDraft()`（整体替换）；
- 所有可见文案走 Client locale（`zh` / `en`），样式只使用主题 token；
- 无障碍：文本框有可访问名称与 8000 字符上限，错误区 `role="alert"`，提示区 `role="status"` + `aria-live="polite"`。

### 5.4 目录结构

```text
requirement-copilot/
├─ package.json          # 包清单、dsh.bundle/dsh.client 声明、test 脚本
├─ cordis.patch.yml      # bundle patch：插入 requirement-copilot 行（config: {}）
├─ index.js              # Host 半：生成核心 + 命令 + 工具 + skill
├─ client.js             # Client 半：按钮 + 浮层 + 命令通道 + 命令行隐藏
├─ locale/
│  ├─ en.json            # 插件元数据（Plugin Manager 显示）
│  └─ zh.json
├─ icon.svg              # 插件图标（自有 artwork）
├─ README.md             # 本文件
├─ CHANGELOG.md          # Keep a Changelog + SemVer
├─ LICENSE               # MIT
├─ .gitignore
├─ docs/
│  ├─ COMPETITIVE_LANDSCAPE.md  # 市场与 DSH 生态调研
│  ├─ DISTRIBUTION.md           # npm / GitHub / dshbase 分发手册
│  └─ MARKETPLACE_LISTING.md    # 上架文案
├─ evals/
│  ├─ cases.json         # 20 条质量评测 case
│  ├─ rubric.md          # 结构检查 + 人工评分标准
│  └─ run-eval.mjs       # 评测 runner（dry-run / --live）
├─ scripts/
│  ├─ build-dist.mjs     # 生成公开发布包 dsh-requirement-copilot
│  └─ mirror-github.mjs  # 网络受限时用 GitHub API 镜像 main
├─ .github/workflows/
│  └─ publish.yml        # GitHub 镜像的 npm 发布流程
└─ tests/
   ├─ host.test.mjs      # 22 个 Host 用例（fake ctx + fake LLM）
   └─ client.test.mjs    # 5 个 Client 用例（stub React + fake Remote）
```

### 5.5 依赖的宿主 API

| API | 用途 |
|---|---|
| `ctx.llm.stream()` | 调用默认模型 |
| `ctx.agentDefaultModel.currentSelection()` | 读取默认 provider/model |
| `ctx.commands.register()` | 注册 `/refine-prompt` |
| `ctx.tools.register()` | 注册 `refine_requirement` |
| `ctx.skills.register()` | 注册内嵌 skill |
| Client `ctx.slots` | 按钮/面板/命令行三个槽位 |
| Client `ctx.locale` | 中英文案 |
| Client `ctx.remote.commands.execute` | 面板 → Host 命令 |
| `InputActions` | 读取草稿、写回/替换输入框 |

---

## 6. 输出契约

### 6.1 模型输出结构

模型只返回一个 JSON 对象（不要代码围栏、不要解释）：

```json
{
  "analysis": {
    "summary": "一句话复述",
    "intent": "开发功能",
    "deliverables": ["..."],
    "constraints": ["..."],
    "assumptions": ["..."],
    "gaps": ["需要用户补充的问题？"]
  },
  "primary": {
    "language": "zh",
    "title": "短标题",
    "role": "角色",
    "goal": "目标",
    "context": ["背景/前提"],
    "requirements": ["可执行要求"],
    "constraints": ["限制"],
    "output": ["输出形式"],
    "acceptance": ["可判定验收标准"],
    "risks": ["风险"]
  },
  "translation": {
    "language": "en",
    "title": "...",
    "role": "...",
    "goal": "...",
    "context": [],
    "requirements": [],
    "constraints": [],
    "output": [],
    "acceptance": [],
    "risks": []
  }
}
```

`primary` 使用主语言；`translation` 使用另一种语言，字段逐条对应。

### 6.2 校验规则

- 必填：`analysis.summary`、`analysis.intent`、两套 block 的 `title/role/goal/requirements/acceptance`；
- `intent` 必须命中固定枚举：
  - 中文：开发功能 / 修复缺陷 / 重构优化 / 调研分析 / 写作文档 / 数据分析 / 设计创作 / 自动化流程 / 其它；
  - 英文：Feature development / Bug fixing / Refactoring / optimization / Research / Writing / Data analysis / Design / Automation / Other；
- `language` 必须与预期主/译文语言一致；
- `gaps` 每条必须是问句（以 `？` 或 `?` 结尾）、去重、最多 6 条；
- `translation.requirements` / `translation.acceptance` 的条数必须与 `primary` 一致；
- 各字段有长度/条数上限（单条 400 字符，requirements 上限按详略 6/8/10，acceptance 8，constraints 8，risks 4，context 5，等等）；
- 不通过则进行**一次**修复重试；第二次仍不通过则报错，不产出内容。

### 6.3 确定性装配

最终 Markdown 由 Host 拼装，模型不负责排版。`agent` 模式小节：

- 中文：角色 / 目标 / 背景与上下文 / 具体要求 / 约束 / 输出格式 / 验收标准 / 风险与注意事项
- 英文：Role / Goal / Context / Requirements / Constraints / Output format / Acceptance criteria / Risks and notes

`spec` 模式切换为：背景与范围 / 功能需求 / 约束与非功能要求 / 交付物与形式 / 验收标准 / 风险与注意事项（英文对应）。`requirements` 与 `acceptance` 使用编号列表，其余使用项目符号。

### 6.4 返回对象

命令成功时 result.text 为：

```json
{
  "ok": true,
  "data": {
    "title": "短标题",
    "analysis": { "summary": "...", "intent": "...", "deliverables": [], "constraints": [], "assumptions": [], "gaps": [], "gapChoices": [["是", "否"]] },
    "prompt": "装配后的 Markdown Prompt",
    "translation": "装配后的另一语言 Prompt",
    "meta": {
      "source": "model",
      "provider": "...",
      "model": "...",
      "target": "generic",
      "scenario": "general",
      "revision": false,
      "quality": { "score": 86, "checks": [{ "id": "requirements", "pass": true }] },
      "promptChars": 1234
    }
  }
}
```

失败时：`{ "ok": false, "code": "E_...", "error": "原因" }`。工具路径直接抛错或返回结果对象，由 DSH 工具管线渲染。

### 6.5 错误码

| 错误码 | 含义 |
|---|---|
| `E_EMPTY` | 输入为空/过短 |
| `E_TOO_LONG` | 输入超过 8000 字符 |
| `E_NO_LLM` | 组合中缺少 `llm` 服务 |
| `E_NO_MODEL` | 找不到可用模型路由 |
| `E_TIMEOUT` | 生成超时（120s） |
| `E_ABORTED` | 调用方取消 |
| `E_LLM` | 模型提供方错误 |
| `E_TRUNCATED` | 输出达到 token 上限被截断（不重试） |
| `E_OUTPUT_TOO_LONG` | 输出文本超过 60000 字符 |
| `E_EMPTY_OUTPUT` | 模型返回空内容 |
| `E_BAD_JSON` | 模型输出不是合法 JSON |
| `E_INVALID` | 校验失败且一次修复后仍不合格 |
| `E_UNKNOWN` | 命令入口捕获到的未分类错误 |

Client 侧失败会显示具体原因，并在必要时退回本地模板；本地模板不调用模型、不提供译文、需要手动插入。

### 6.6 成本与超时

- 每次生成是一次独立的默认模型请求，消耗**用户自己的**模型额度；
- 生成期间包含「分析 + 主语言 Prompt + 另一语言译文」，输出通常比一次普通对话长；
- 只有结构化校验失败时才可能多一次修复调用；截断/非法 JSON 不会重试；
- 超时 120 秒；取消会中止等待，命令生命周期按错误结算；
- 没有请求缓存/幂等：相同文本重复点击会再次计费（见路线图）。

---

## 7. 测试

```bash
node --test
# 或
npm test
```

- 运行环境：Node ≥ 20；不需要启动 DSH、不需要网络、不需要真实模型；当前共 27 个用例；
- Host 测试用 fake `ctx` + fake LLM 流：注册、校验、装配（agent/spec、中英）、目标预设、截断、一次修复、错误码、命令信封、工具渲染、空/超长输入、缺失服务、确认门澄清参数；
- Client 测试用 stub React + fake Remote：loader 入口、三处槽位注册、中英字典对齐、命令通道 arity 重试与失败诊断、`ok:false` 信封、缺失命名空间、静态守卫（无 Harness 包引用、CSS 无硬编码颜色、a11y 钩子存在）；
- 测试本身包含反例（截断、二次校验失败、空/超长输入、通道失败），用于确认判据能识别失败。

### 7.2 质量评测（evals/）

单元测试证明「格式没坏」，`evals/` 用来回答「内容有没有变好」：

```bash
# 校验 20 条评测集（零成本，不调模型）
node evals/run-eval.mjs

# 真实模型基线（OpenAI 兼容端点）
EVAL_BASE_URL=https://api.example.com/v1 \
EVAL_MODEL=deepseek-chat \
EVAL_API_KEY=sk-... \
node evals/run-eval.mjs --live --out evals/baseline.json
```

- `evals/cases.json`：20 条模糊需求，覆盖 bugfix / feature / refactor / research / writing / data / design / automation / security / performance / migration / testing / i18n / billing / notification / analytics / ops / mobile / api；
- 自动检查：关键词覆盖 ≥80%、标题 + ≥3 个小节、gaps 必须是问句、译文非空、非 generic 目标必须带固定环境提示、来源必须是 model；
- 人工评分：`evals/rubric.md` 的 7 个维度（意图忠实度、缺口质量、验收可执行性、约束保真、双语一致性、目标适配、可执行性），通过线 ≥10/14；
- **当前真实模型基线尚未跑**：需要可用端点与额度；跑完后把摘要写入 rubric 第 5 节。

---

## 8. 开发与调试

### 8.1 开发流程

- 纯 JavaScript，无构建、无 npm 依赖；直接编辑 `index.js` / `client.js` / locale / README；
- 修改 Client 后，页面通常由 HMR 重新加载模块；若页面仍显示旧代码，刷新一次页面；
- 修改 Host 后，若 HMR 未接管，可在 Plugin Manager 禁用再启用本插件行，或重启 DSH；
- 任何改动先跑 `node --test`，并遵守仓库的提交/发布规范。

### 8.2 诊断

- 浮层内会显示模型/通道错误的可读原因；
- 浏览器 `localStorage` 中有两类诊断键：
  - `rcp-diagnostic-last`：最近一次生成的阶段、长度、错误；
  - `rcp-diagnostic-history`：最近 10 条，单条截断，最多 24KB；
- 诊断不包含用户正文（只有长度/阶段/错误文本），但可能包含提供方错误信息，分享前请检查。

### 8.3 常见问题

| 现象 | 排查 |
|---|---|
| 看不到 ✨ 按钮 | 插件行是否 active；当前组合是否有 Web Client 与 `commands`；刷新页面 |
| 点生成提示模型调用未成功 | 打开浮层看错误文本；确认默认模型可用、凭据有效；查看 localStorage 诊断 |
| 提示输出被截断 | 把详略改为「精简」，或缩短输入后重试 |
| 提示未通过校验 | 重试一次；仍失败可精简输入或改用 `spec`/`agent` 另一模式 |
| 安装/启停提示 restart-required | 常见于 profile 中有其他插件导入失败或非托管插件；先修复/重启 DSH 再试 |
| 输入框内容被覆盖 | 正常流程不会覆盖已编辑内容；若怀疑残留，刷新页面并复现，记录操作顺序 |

### 8.4 本机 junction 开发方式

本机维护时，Profile 中安装路径是指向仓库的目录 junction：

```text
C:\Users\LENOVO\Documents\deepseek-harness\default-workspace\requirement-copilot
  └─(junction)→ D:\dsh-plugins\requirement-copilot
```

因此编辑仓库即编辑已安装源码，无需重装；回滚时移除 junction 并把目标 tag 的内容复制回原路径即可。

---

## 9. 隐私与安全

- **会离开本机的内容**：仅「用户描述 + 补充上下文 + 系统指令」这一次模型请求，发往 DSH 当前配置的模型提供方；
- **不会做**：不读取/保存模型凭据，不访问网络上的其他服务，不把内容写入 profile 配置；
- **会话日志**：`command/run` 与 `command/done` 会按 `dsh-commands` 约定写入会话日志，其中 `command/done` 含完整结果文本（分析 + Prompt + 译文）；这些事件是 log-only，不进入模型上下文；插件同时用 `recordInput: false` 避免命令输入入日志；
- **浏览器诊断**：只写阶段、长度与错误，不写用户正文；仍建议分享前检查；
- **历史版本**：模型结果（含 Prompt/译文）存在浏览器 `localStorage`，最多 10 条，可在面板内「清空」；不在设备间同步；
- **提醒**：不要把密钥、密码、Cookie 等敏感信息粘贴进需求描述——它们会随模型请求发送给提供方。

---

## 10. 已知限制与路线图

### 10.1 限制

- 依赖 Web 组合中的 `commands` Remote；无 UI 的组合只有 Agent 工具可用；
- 使用**默认模型**而非当前会话临时切换的模型；
- 一次性生成（前端非流式展示），取消会中止等待；
- 无请求缓存/幂等，相同内容重复生成会重复计费；
- 校验过严时可能触发一次修复调用，成本略增；
- 模型失败时的本地模板不提供译文，且不会自动写回；
- `/refine-prompt` 会出现在 `/` 命令目录里（面板专用，已在描述中说明）；
- 命令回执行被空渲染隐藏，外层是否留空白间距尚未逐主题验证；
- 无自动化 UI 测试、无 CI；UI 行为（弹层定位、焦点）需要人工验证；
- `evals/` 已提供 20 条评测集与 runner，但**真实模型质量基线尚未跑**，不能把结构通过当作质量证明；
- 目标预设只是在标题后加固定环境提示，不是各 IDE/Agent 的专用模板（不做工具调用差异、文件布局差异）；
- 确认门目前只在面板里；Agent 工具路径没有逐题 UI，需要模型自己把用户回答放进 `clarifications`；
- 拖拽位置只在当前面板实例内保留，刷新页面会回到默认位置；确认门候选答案优先用模型 `gapChoices`，缺失时用确定性规则兜底；
- 历史版本存在浏览器本地，换浏览器/清缓存会丢失，也不做跨设备同步。

### 10.2 路线图候选

- 请求缓存/幂等（同输入+选项直接复用结果）；
- 跟随当前会话模型（而非全局默认）；
- 面板显示本次 token 用量与估算成本；
- 可选项目上下文注入（如 `AGENTS.md`/`README` 摘要，默认关闭）；
- 更细的可配置项（输入上限、修复次数、输出上限）；
- 流式展示生成过程；
- 打开浮层时的焦点管理与命令行空行问题修复；
- 质量评测的真实模型基线 + CI 回归；
- 发布 npm 包 / 打 `dsh-plugin` topic，进入公开插件索引；
- GitHub Actions / Gitee Go 跑 `node --test` 与 `node evals/run-eval.mjs`。

---

## 11. 版本管理

- 版本号遵循 SemVer（`MAJOR.MINOR.PATCH`），版本历史见 [CHANGELOG.md](CHANGELOG.md)；
- 已发布 tag：`v1.0.0`、`v1.0.1`、`v1.0.2`、`v1.0.3`、`v1.0.4`、`v1.0.5`、`v1.1.0`、`v1.2.0`、`v1.3.0`、`v1.4.0`、`v1.5.0`、`v1.5.1`、`v1.6.0`、`v1.6.1`（以 `git tag -n` 为准）；
- 提交规范：`type(scope): subject`（`feat` / `fix` / `docs` / `chore` / `refactor` / `test`）；
- 发布流程：
  1. 把 `CHANGELOG.md` 的 `[Unreleased]` 整理到新版本号下并补日期；
  2. 修改 `package.json` 的 `version`；
  3. 提交 `chore(release): vX.Y.Z`；
  4. 打 annotated tag：`git tag -a vX.Y.Z -m "vX.Y.Z"`；
  5. 推送：`git push origin main --tags`；
  6. 回滚：`git checkout <tag>`（安装路径按 8.4 的方式恢复）。

### 远端仓库

- `origin`：`https://gitee.com/coreyleung/requirement-copilot.git`（Gitee 私有仓库，URL 中不含凭据）；
- 推送凭据从 Connector Hub（`~/.connector-hub/credentials.json`）读取或由调用方提供，**不要写进 remote URL、配置文件或提交**；
- 已推送内容：`main` 与 `v1.0.0`–`v1.6.1` 全部 tag。

---

## 12. 维护信息（本机）

| 项 | 值 |
|---|---|
| 仓库 | `D:\dsh-plugins\requirement-copilot`（分支 `main`） |
| DSH 安装路径 | `C:\Users\LENOVO\Documents\deepseek-harness\default-workspace\requirement-copilot`（junction 指向仓库） |
| DSH profile | `desktop`（Windows Desktop / Web GUI） |
| 远端 | Gitee 私有仓库 `coreyleung/requirement-copilot` |
| Git/Git 版本 | MinGit 2.56（`C:\Users\LENOVO\opt\MinGit\cmd\git.exe`） |
| Node（测试） | DSH 自带 Node 24（`...\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`） |

> 令牌不落盘到本仓库：推送时从 Connector Hub 读取，仅存在于执行进程环境；`.git/config` 与 remote URL 均不含凭据。

---

## 13. 许可与贡献

- 本项目使用 **MIT License**，版权归 `coreyleung` 所有（2026）。完整条款见 [LICENSE](LICENSE)。
- 允许使用、复制、修改、合并、发布、分发、再许可和/或销售本软件，但需在副本或实质性部分中保留版权声明与许可声明；软件按「原样」提供，不附带任何明示或默示担保。
- 欢迎通过 Issue/PR 提改进；提交前请：
  1. 运行 `node --test` 并确保全绿；
  2. 更新 [CHANGELOG.md](CHANGELOG.md) 的 `[Unreleased]`；
  3. 遵循现有提交规范与文档结构。

---

## 相关文档

- [CHANGELOG.md](CHANGELOG.md) — 版本历史与发版记录
- [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md) — npm / GitHub / dshbase 分发与上架手册
- [docs/MARKETPLACE_LISTING.md](docs/MARKETPLACE_LISTING.md) — 上架文案、标签与 FAQ
- [docs/DSHBASE_SUBMISSION.md](docs/DSHBASE_SUBMISSION.md) — dshbase 收录 issue 的可复制内容
- [docs/COMPETITIVE_LANDSCAPE.md](docs/COMPETITIVE_LANDSCAPE.md) — 市场与 DSH 生态竞品调研（2026-11-05）
- [evals/rubric.md](evals/rubric.md) — Prompt 质量评测标准
- [tests/host.test.mjs](tests/host.test.mjs) — Host 回归测试
- [tests/client.test.mjs](tests/client.test.mjs) — Client 契约测试
