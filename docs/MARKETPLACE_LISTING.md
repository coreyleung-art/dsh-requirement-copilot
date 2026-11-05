# 上架文案：dsh-requirement-copilot

> 用于 npm、GitHub、dshbase、dsh-plugins.tech 的标题/短描述/长描述/标签/安装说明。
> 产品中文名「帮我说」，英文名「Say It For Me」。

## 标题

- 中文：**帮我说 / Say It For Me — 输入框里的需求编译器**
- 英文：**Say It For Me — a requirement compiler inside the DSH composer**

## 短描述（≤ 60 字）

- 中文：把零散需求变成带缺口清单、候选答案、验收标准与双语的 Agent Prompt，一键写回输入框。
- 英文：Turn rough notes into a validated, agent-ready prompt with gaps, suggested answers, acceptance criteria and bilingual output — right in the composer.

## 长描述

### 中文

大多数「提示词工具」只优化你已经写好的 Prompt，但真正的难题是：**你还没想清楚要什么。**

帮我说把这一步补上：

- 读输入框里的草稿，分析目标、交付物、约束、假设与缺口；
- 缺口一次一题出现，给出可点击的候选答案，也可以补充说明；
- 生成固定结构、可验收、中英双语的 Agent Prompt；
- 写回输入框前显示质量自检；有未确认缺口时先过确认门；
- 支持继续优化（最多 5 轮）、历史版本与逐行 diff；
- 不自动发送，失败不覆盖原稿。

它运行在 DSH 的 Composer 里，用你已配置的默认模型，不需要额外的 SaaS 账号。

### English

Most prompt tools optimize a prompt you already wrote. The hard part is usually earlier: **you have not decided what you actually want.**

Say It For Me fills that gap inside the DeepSeek Harness composer:

- analyzes the draft for goal, deliverables, constraints, assumptions and gaps;
- asks gaps one at a time with clickable suggestions, plus an optional free-text note;
- assembles a fixed-structure, testable, bilingual agent prompt;
- shows a deterministic quality self-check before writing back;
- gates write-back on unanswered gaps;
- supports up to five refinement rounds, version history and a line diff;
- never auto-sends, and never overwrites the draft on failure.

It uses your configured DSH model. No extra SaaS account, no separate API key.

## 标签 / topics

```text
dsh
dsh-plugin
deepseek-harness
prompt
prompt-engineering
requirement
requirements
clarification
spec
bilingual
```

## 分类

- dshbase：**Developer（开发）** 或 **Productivity（效率）**
- dsh-plugins.tech：**需求澄清与规格沉淀** / 编码工作流与行为治理

## 安装

```bash
dsh plugin add dsh-requirement-copilot
```

或 Plugin Manager → 从本地/npm 安装 bundle `dsh-requirement-copilot`。

## 核心功能（列表版）

- ✨ 输入框旁一键整理；有缺口时打开确认门
- 需求分析：复述 / 意图 / 交付物 / 约束 / 假设 / gaps
- 一次一题的确认门：候选答案 + 补充说明 + 上一题/下一题/跳过
- 固定模板装配：agent / spec、中英双语、目标环境提示
- 质量自检：0–100 结构分与逐项检查（不额外调模型）
- 继续优化：最多 5 轮，增量修改
- 历史版本：最近 10 版，本地保存，可载入/对比/清空
- 只插入不发送；可恢复原草稿；失败不覆盖
- 命令 + Agent 工具 + 内嵌 skill 三入口

## 适用人群

- 经常给 AI Agent 派活、但需求还停留在口头/聊天记录的人；
- 需要中英双语 Prompt 的团队；
- 想要「发前确认」而不是「一键自动发送」的用户；
- 在 DSH 里工作、希望不切换应用的人。

## 不适用 / 限制

- 不是通用聊天客户端，不自动发送；
- 依赖 DSH Web 组合中的 `commands` Remote 与已配置模型；
- 目标预设只加固定环境提示，不是各 IDE 的专用模板；
- 质量分是结构自检，不是模型评审；
- 历史保存在本机浏览器，不跨设备同步。

## 隐私

- 需求文本发送给 DSH 当前配置的模型提供方；
- 不读取/保存模型凭据，不上传到第三方服务；
- 历史与诊断存本机浏览器，可在面板内清空。

## 截图/素材计划

无浏览器控制，暂未采集 UI 截图；上架前建议补：

1. 输入框 ✨ 与一键写回（前后对比）；
2. 一次一题的确认门（候选答案 + 补充说明）；
3. 质量自检卡；
4. 历史列表 + 逐行 diff；
5. 继续优化面板；
6. 30–60 秒 GIF：输入模糊需求 → 确认门 → 写回。

图标使用仓库 `icon.svg`；npm 包内已包含。

## FAQ

**Q：需要单独的 API Key 吗？**
A：不需要。使用 DSH 已配置的默认模型；费用走该模型额度。

**Q：会自动发送吗？**
A：不会。只写回输入框，由你确认发送。

**Q：有缺口时为什么没写回？**
A：这是确认门：先回答/跳过缺口，避免把未确认假设直接当成任务发出去。

**Q：支持英文吗？**
A：界面与生成结果都支持中英；一次生成会给出主语言 + 另一语言译文。

**Q：和普通 Prompt 优化器有什么不同？**
A：普通优化器处理「已有的 Prompt」；这里处理「还没想清楚的需求」，并带固定输出契约、缺口确认与写回前的质量检查。

## 版本

当前 `1.6.1`；变更见 `CHANGELOG.md`。
