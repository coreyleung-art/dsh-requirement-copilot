# 帮我说 · 需求 Prompt 质量评测标准（v1）

这份标准用于回答一个问题：**换了模型、改了提示词或装配逻辑之后，帮我说 产出的 Prompt 是变好了还是变差了？**

评测对象是 `refine_requirement` / `/refine-prompt` 的完整输出（analysis + prompt + translation），不是单次模型回答的观感。

## 1. 运行方式

```bash
# 只校验评测集本身（不调用模型，零成本，可进 CI）
node evals/run-eval.mjs

# 真实模型基线（OpenAI 兼容接口）
EVAL_BASE_URL=https://api.example.com/v1 \
EVAL_MODEL=deepseek-chat \
EVAL_API_KEY=sk-... \
node evals/run-eval.mjs --live --out evals/baseline.json
```

- `EVAL_API_KEY` 可省略（本地 vLLM/Ollama 等无鉴权端点）。
- `--live` 会为 20 个 case 各调用一次模型；单次约几 k token，跑之前确认额度。
- 除 `--out` 外不写文件；不要把密钥写进仓库或 shell 历史。

## 2. 自动化结构检查（pass/fail）

每个 case 必须同时通过：

| 检查 | 判据 |
|---|---|
| 关键词覆盖 | `mustInclude` 至少命中 80%（Prompt 中出现，忽略大小写） |
| 结构完整 | 有 `# 标题` 且至少 3 个 `## ` 小节 |
| gaps 合法 | `analysis.gaps` 每条以 `？`/`?` 结尾 |
| 双语输出 | `translation` 非空，且与 primary 结构对应 |
| 目标适配 | `target != generic` 时，Prompt 含固定的目标环境提示 |
| 来源正确 | `meta.source === "model"`，不是本地模板 |

结构检查只能证明「格式没坏」，不能证明「内容好」。

## 3. 人工质量评分（每项 0–2 分）

建议两名评审独立打分，取平均；分歧 ≥2 分的 case 复盘。

| 维度 | 0 分 | 1 分 | 2 分 |
|---|---|---|---|
| **意图忠实度** | 误解目标，或擅自扩大/缩小范围 | 大方向对，但遗漏关键目标 | 准确复述真实目标，范围与原文一致 |
| **缺口质量（gaps）** | 没有 gap，或问的是废话 | 有 gap，但部分不影响结果 | 每个 gap 都会显著影响产出，可被用户直接回答 |
| **验收可执行性** | 验收标准不可判定（“功能正常”） | 部分可判定 | 每条都能被用户/测试直接检查 |
| **约束与上下文保真** | 丢失或编造约束 | 保留主要约束，个别遗漏 | 约束、专有名词、路径、数字原样保留；推断只进 assumptions |
| **双语一致性** | 译文缺失或信息量明显缩水 | 基本对应，个别条目错位 | 条数、顺序、语义一一对应，术语一致 |
| **目标环境适配** | 目标提示与内容矛盾 | 有提示但较泛 | 提示与任务类型匹配，不引入多余假设 |
| **可执行性/可读性** | 空话多、步骤不可执行 | 基本可执行 | 动作明确、顺序合理、可直接交给 Agent |

**通过线**：总分 ≥ 10/14，且「意图忠实度」≥1、「验收可执行性」≥1。

## 4. 基线流程

1. 固定评测集版本（`evals/cases.json`）与模型（记录 provider/model/日期）。
2. 跑 `--live`，把结果写到 `evals/baseline.json`（只提交脱敏后的汇总，不提交用户隐私）。
3. 人工按第 3 节评分，记录平均分与失败 case。
4. 每次改动 Prompt / 装配 / 模型后重跑；对比 pass 率、关键词覆盖、人工分。
5. 回归门槛：通过率不得低于基线 5 个百分点；关键维度（意图/验收）不得下降。

## 5. 当前基线状态

- 结构检查与评测集已就绪（20 cases，覆盖 bugfix/feature/refactor/research/writing/data/design/automation/security/performance/migration/testing/i18n/billing/notification/analytics/ops/mobile/api）。
- **真实模型基线尚未跑**：需要可用的 OpenAI 兼容端点与额度；跑完后把 `baseline.json` 摘要写入本节。
- 评测集本身也会迭代：新增 case 必须带 `mustInclude`，并说明它覆盖的风险类型。
