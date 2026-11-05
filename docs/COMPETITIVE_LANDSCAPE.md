# 竞品与生态调研（2026-11-05）

> 只读调研，未做产品实测；功能/价格以公开页面为准，可能变化。结论先行，事实与推测分开。

## 1. 结论

1. **“需求 → Prompt”不是蓝海**：已有多个开源 Web 应用、Agent Skill 与 DSH 插件做同一件事。
2. **“输入框内需求 → Prompt”在 DSH 生态里已被占位**：至少 5 个公开插件做“按钮读草稿 → 改写 → 写回输入框”，其中 `dsh-prompt-chain` 功能最完整。
3. **“需求澄清”另有一层竞品**：`dsh-clarify`、`dsh-spec-forge`、`spec-driven/keel` 在“先问清楚再开工”上比我们更深。
4. **帮我说 的剩余组合**：缺口显式化 + 中英双语成对 + Host 固定模板装配 + 严格校验/一次修复 + 只插入不发送/可恢复原草稿 + 命令/工具/技能三入口共用一核。这是**打包差异**，不是品类首创。
5. **最大风险是分发**：`@local/*` + 私有仓库 + 未发 npm + 未打 `dsh-plugin` topic，不在公开索引内；竞品都可公开安装。

## 2. 通用市场分层

| 层 | 代表产品 | 形态 | 与帮我说 的关系 |
|---|---|---|---|
| 需求→Prompt 生成器 | [PromptPilot 开源版](https://github.com/jinshi678/promptpilot)、[Prompt-Cursor](https://github.com/adityavinfotech/Prompt-Cursor)、[YPrompt](https://github.com/hl128k/YPrompt) | 独立 Web / 自部署 | 功能重叠最高：需求分析、追问、结构化 Prompt；但没有输入框写回与 Host 契约 |
| 需求澄清 Skill | [AI Prompt Optimizer](https://github.com/banzr519/ai-prompt-optimizer)、[clarify-idea](https://github.com/zhouzilai626/clarify-idea-skill) | Agent Skill / Prompt 包 | 概念重叠；输出是优化后的 Prompt 或需求澄清稿，不是双语文档合同 |
| Prompt 优化/评测 | [PromptPerfect](https://promptperfect.jina.ai/)、[火山引擎 PromptPilot](https://www.geekpark.net/news/352662) | SaaS / 企业平台 | 优化“已有 Prompt”，不做从零需求采集；有评测/badcase 闭环 |
| 规格驱动开发 | [GitHub Spec Kit](https://github.github.io/spec-kit/index.html)、[Kiro](https://kiro.dev/ide/) | 开源工具包 / IDE | 编码场景强，流程重；不是输入框助手 |
| PRD / 产品需求 | [ChatPRD](https://www.chatprd.ai/pricing) | SaaS | 团队 PRD 协作；不是 Agent Prompt |
| Prompt 管理/观测 | [PromptLayer](https://www.promptlayer.com/pricing/) | SaaS | 团队级版本/评测/观测；不面向终端用户 |

### 2.1 最接近的三个通用产品

- **PromptPilot（开源版）**：需求分析 + 少量追问 + 结构化 Prompt + 六维质量评分 + 自动修复 + 版本 diff/收藏；独立 Next.js 应用，MIT。最像“工作台版帮我说”，但没有输入框集成与双语双份 Prompt。
- **Prompt-Cursor**：需求分析（目标/约束/依赖/边界/验收）+ 澄清问题 + 假设置信度 + 多 IDE 专用 Prompt；独立 Web，MIT，需自带模型 Key。补上了我们缺的“多目标专用格式”。
- **YPrompt**：对话式需求挖掘 + 提示词优化/对比 + 版本回滚 + 操练场；自部署，CC BY-NC-SA（禁止商业使用）。偏提示词工作台。

## 3. DSH 生态（公开插件）

> 调研方式：本地 `plugin_manager` 只读列表 + 公开 GitHub/npm 页面；`plugin_market` 当前未配置索引，无法在市场内搜索。许可以仓库声明为准，标“未核实”的不推定。

### 3.1 输入框 → Prompt（核心重叠）

| 插件 | 形态 | 重叠点 | 许可 |
|---|---|---|---|
| [dsh-prompt-chain](https://github.com/Nihao7-L/dsh-prompt-chain) | 输入框左侧按钮 + 结果面板，实时写回 | 几乎同构；独有续写 5 轮、逐行 diff、历史回跳、6 套方案 | MIT（README 声明） |
| [dsh-prompt-enhancer](https://github.com/saul-dsh/dsh-prompt-enhancer) | ✨ 按钮 + 发送时自动增强 + 工具 | 草稿→自包含 Prompt、写回不发送、三档强度 | MIT |
| [@zzy001/dsh-prompt-optimizer](https://github.com/zzy-cl/dsh-prompt-optimizer) | composer 工具行按钮 | 草稿→结构化 Prompt、一键还原 | MIT |
| [dsh-prompt-optimization-master](https://github.com/ruiyukirin/dsh-prompt-optimization-master) | 输入框一键增强 | 同 seam，双层增强机制 | MIT |
| [dsh-prompt-star](https://github.com/MncStudio/dsh-prompt-star) | ⭐ 按钮 + 项目说明文件 | 同 seam，但确定性拼接、不调模型 | MIT |

### 3.2 需求澄清 / 规格驱动

| 插件 | 形态 | 重叠点 | 许可 |
|---|---|---|---|
| [dsh-clarify](https://github.com/pyc123720/dsh-clarify) | 「澄清」胶囊 + 访谈面板 + 需求卡确认 + 验收清单 + 落盘 | “先问清楚再开工”心智最强竞品；澄清深度更高 | 未声明（未核实） |
| [dsh-spec-forge](https://github.com/winston-hoo/dsh-spec-forge) | 三工具 + 需求分级 + 模板沉淀 | 同痛点，产物是模板库/执行清单 | MIT |
| [spec-driven / keel](https://github.com/JohnXu22786/spec-driven) | 5 skills + 3 tools + SPEC/ASSUMPTIONS/AUDIT | 规格驱动纪律；无输入框面 | MIT |
| [dsh-plugin-structured-prompt](https://github.com/YuChenLiao/dsh-plugin-structured-prompt) | 输入框底部入口 + 17 项表单 + 工具 | 高度重叠；表单化、模板导入导出、token 预算 | MIT |

### 3.3 同 UI 面但非竞品

[dsh-prompt-vault](https://github.com/Frog755/dsh-prompt-vault)（提示词库复用）、[dsh-composer-launcher](https://github.com/xiamubumu/dsh-composer-launcher)（"+" 菜单/引用 chip）、[dsh-need-finder](https://github.com/863683348/dsh-need-finder)（按需求推荐插件，名称易误判）、[DSH-Plugins-Marketplace](https://github.com/bradeGithub/DSH-Plugins-Marketplace)（市场本身）。

## 4. 与帮我说 的功能对比

| 能力 | 帮我说 | PromptPilot（开源版） | Prompt-Cursor | dsh-prompt-chain | dsh-clarify | dsh-plugin-structured-prompt |
|---|---|---|---|---|---|---|
| 输入框内一键读草稿/写回 | ✅ | ❌ | ❌ | ✅ | 部分（胶囊/面板） | 入口+表单 |
| 显式 gaps + 确认门 | ✅ | ✅（追问） | ✅（澄清问题） | ❌ | ✅（逐题访谈） | 表单字段 |
| 中英双语双份 Prompt | ✅ | 未提 | ❌ | 外挂翻译按钮 | ❌ | ❌ |
| Host 固定模板装配 | ✅ | 模型直出（有评分） | 模型直出 | 模型直出 | 模型直出 | 表单拼装 |
| 严格校验 + 一次修复 | ✅ | 有质量检查/自动修复 | ❌ | ❌ | 问答校验 | 表单校验 |
| 版本/历史/diff | ✅ 历史 + 逐行 diff | ✅ | ❌ | ✅ | 卡片落盘 | 模板 |
| 多轮续写 | ✅ 最多 5 轮 | ✅ | ❌ | ✅ | ❌ | ❌ |
| 质量评分/自检 | ✅ 结构自检 | ✅ 六维评分 | ❌ | ❌ | 问答校验 | 表单校验 |
| 场景预设 | ✅ 六类 | ✅ 多场景 | ❌ | ✅ 六套方案 | 模式 | 表单 |
| 多 IDE 专用格式 | 仅固定环境提示 | 场景策略 | ✅ 四种 | ❌ | ❌ | ❌ |
| 只插入不发送/恢复原草稿 | ✅ | ❌ | ❌ | ✅ 写回 | 确认门 | 入口插入 |
| 公开分发/索引 | ❌（私有） | ✅ npm/GitHub | ✅ GitHub | ✅ npm | ✅ GitHub | ✅ GitHub |

## 5. 定位与建议

**定位**：不是“又一个 Prompt 优化器”，而是 **DSH 工作流里的需求编译器**——把模糊草稿编译成带缺口分析、可验收、双语的 Prompt，并且不离开输入框。

**已做（本次）**
- 目标预设：`generic` / `claude-code` / `codex` / `cursor`（固定环境提示，Host 装配）。
- 质量评测：20 条 case + 自动结构检查 + 人工 rubric（真实模型基线待跑）。
- **澄清确认门**：一次一题、候选答案 + 补充说明；回答作为 `clarifications` 重新生成；一键整理遇到 gaps 时不再直接写回。
- **可拖拽面板**：标题栏拖动、双击复位，方便对照页面内容继续输入。
- **质量自检**：确定性结构分（不调模型），显示可交付等级与逐项检查。
- **场景预设**：通用/编码/写作/调研/数据/自动化，套用推荐用途与详略。
- **历史版本**：浏览器本地保留最近 10 版，可载入/清空，支持逐行 diff。
- **多轮续写**：最多 5 轮增量修改，Host 把上一版 Prompt 与反馈一起发送。

**下一步优先级**
1. **公开分发**：发 npm 包、打 `dsh-plugin` topic、进入 dshbase / dsh-plugins.tech 索引；否则功能再好也没有曝光。
2. **质量基线**：跑 `evals/run-eval.mjs --live`，用数据证明“契约化输出”不是自嗨。
3. **多目标真实差异**：现在只是固定提示；若要正面竞争 Prompt-Cursor，需要真正的目标专用模板/工具调用差异。

## 6. 调研限制

- 未配置 `plugin_market` 索引；无法在市场内搜索，DSH 插件清单来自本地只读列表 + 公开网络。
- npmjs.com 直连 403，改用 registry 元数据；下载量/评分未核实。
- GitHub 部分页面抓取失败，star/fork 实时数未核实。
- `dsh-clarify` 许可未声明，不可推定 MIT。
- dshbase “20032 插件”为站点自述，未独立核实；不能排除仍有未被搜到的同类插件。
- 未做产品实测；价格为公开标价，可能变动。未读取任何密钥文件。
