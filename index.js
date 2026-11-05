/**
 * Say It For Me (帮我说) — Host half.
 *
 * One generation core (`generate`) is shared by two callers, following the
 * "one operation, two callers" rule:
 *
 *  - the `refine_requirement` Agent tool, so the model can turn rough notes
 *    into an agent-ready prompt on its own;
 *  - the `refine-prompt` human command, which the composer panel dispatches
 *    through the existing `commands` Remote
 *    (`ctx.remote.commands.execute(sessionId, line, [], signal)`).
 *
 * Output discipline (engineering constraints):
 *  1. The model only returns structured CONTENT fields; the final Markdown
 *     Prompt is assembled deterministically here, so formatting is stable.
 *  2. Every payload is validated (schema, counts, required sections, language,
 *     question-shaped gaps); an invalid payload never becomes a prompt.
 *  3. One bounded repair round feeds the validation errors back to the model.
 *
 * The command result text is the transport for the structured payload. The
 * companion Client half hides the command's transcript row, so a generation
 * never pollutes the visible Chat flow.
 */

/** Human command the Client half dispatches. */
const COMMAND_NAME = 'refine-prompt'
/** Agent tool exposing the same operation to the model. */
const TOOL_NAME = 'refine_requirement'

/** Hard limits that keep one panel request inside a sane model call. */
const MAX_INPUT_CHARS = 8000
const MAX_CONTEXT_CHARS = 3000
const MAX_REVISION_CHARS = 2000
const REVISION_PREVIOUS_CHARS = 6000
const MAX_MODEL_TEXT_CHARS = 60000
const REPAIR_PREVIOUS_CHARS = 7000
const TIMEOUT_MS = 120000

const LANGUAGES = new Set(['auto', 'zh', 'en'])
const MODES = new Set(['agent', 'spec'])
const DETAILS = new Set(['concise', 'standard', 'detailed'])
const TARGETS = new Set(['generic', 'claude-code', 'codex', 'cursor'])

const SCENARIOS = new Set(['general', 'coding', 'writing', 'research', 'data', 'automation'])

/** Scenario guidance only shapes the content fields; the model never formats. */
const SCENARIO_TEXT = {
  general: '通用任务：按原始描述补全目标、约束与验收。',
  coding: '编码实现：requirements 写可执行的代码改动，acceptance 写测试/检查方式；保留技术栈、文件路径与命令。',
  writing: '写作/文档：requirements 写结构与内容要求，acceptance 写可检查的完成标准（受众、长度、必含信息）。',
  research: '调研分析：requirements 写调研范围与方法，acceptance 写证据与结论的检查方式；区分事实与推测。',
  data: '数据分析：requirements 写指标口径与处理步骤，acceptance 写可复核的数值/口径检查。',
  automation: '自动化流程：requirements 写触发、步骤、失败处理，acceptance 写可演练的端到端检查。'
}

/**
 * Fixed first line for environment-specific exports. The model never writes
 * these; they stay byte-stable so target formatting is deterministic too.
 */
const TARGET_PREAMBLES = {
  'claude-code': {
    zh: '> 目标环境：Claude Code（终端/IDE）。先阅读相关文件与项目约定，再开始修改；保持改动聚焦。',
    en: '> Target: Claude Code (terminal/IDE). Read the relevant files and project conventions before editing; keep changes focused.'
  },
  codex: {
    zh: '> 目标环境：Codex（仓库内执行）。先检查代码库与现有测试，保持最小改动，并在完成后运行相关检查。',
    en: '> Target: Codex (in-repository execution). Inspect the codebase and existing tests, keep the diff minimal, and run the relevant checks when done.'
  },
  cursor: {
    zh: '> 目标环境：Cursor（编辑器工作区）。先阅读相关文件，做聚焦修改，不要改动无关代码。',
    en: '> Target: Cursor (editor workspace). Read the relevant files first, make focused edits, and leave unrelated code unchanged.'
  }
}

const INTENTS = {
  zh: ['开发功能', '修复缺陷', '重构优化', '调研分析', '写作文档', '数据分析', '设计创作', '自动化流程', '其它'],
  en: ['Feature development', 'Bug fixing', 'Refactoring / optimization', 'Research', 'Writing', 'Data analysis', 'Design', 'Automation', 'Other']
}

const LIMITS = {
  title: 40,
  summary: 400,
  intent: 60,
  role: 200,
  goal: 800,
  item: 400,
  context: 5,
  requirements: { concise: 6, standard: 8, detailed: 10 },
  constraints: 8,
  output: 6,
  acceptance: 8,
  risks: 4,
  deliverables: 6,
  analysisConstraints: 6,
  assumptions: 5,
  gaps: 6
}

/** Typed failure carrying a stable code the Client may localize later. */
class CopilotError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'CopilotError'
    this.code = code
  }
}

/** Render any thrown value without trusting its string coercion. */
function messageOf(error) {
  if (error instanceof Error && typeof error.message === 'string' && error.message !== '') return error.message
  try {
    return String(error)
  } catch {
    return 'unknown error'
  }
}

/**
 * The instruction shared by every generation. It deliberately asks for CONTENT
 * FIELDS, not a formatted prompt, and stays byte-stable for prompt caching.
 */
const SYSTEM_PROMPT = [
  '你是资深的 AI 提示词工程师与需求分析师。用户会给你一段零散、口语化、可能不完整的需求描述。你不负责排版，只负责产出结构化的内容字段；系统会用固定模板把字段拼装成最终 Prompt。',
  '',
  '工作方法：',
  '1. 读完全部原始描述，判断真实意图、最终目标与产物。',
  '2. 提取或推断：交付物、约束、合理假设。',
  '3. 找出缺失或含糊、且会显著影响结果的信息，写成 gaps（每条必须是一个可直接向用户提出的问句）。不要因为存在 gaps 而拒绝生成。',
  '4. 用 assumptions 记录你为继续推进而采用的合理假设；不要编造用户没有暗示的事实。',
  '5. 按主语言与另一种语言分别填写两套同构的内容字段，两套内容必须信息量一致、逐条对应。',
  '6. 如果用户消息里提供了【用户已确认的澄清】，必须优先采用这些答案，不要再次提出相同问题。',
  '7. 如果用户消息里提供了【上一版 Prompt】和【用户对上一版的反馈】，请做增量修改：保留未要求改变的内容，不要从头重写。',
  '',
  '输出格式（必须严格遵守）：',
  '- 只输出一个 JSON 对象。不要 Markdown 代码围栏，不要在 JSON 前后添加任何解释文字。',
  '- 不要输出排版好的 Markdown Prompt；只输出下面这些字段。',
  '',
  'JSON 结构：',
  '{',
  '  "analysis": {',
  '    "summary": "一句话复述用户真正要做的事，不超过 120 字",',
  '    "intent": "意图类型，必须从规定的枚举值中选择",',
  '    "deliverables": ["最终要交付的产物，0-6 条"],',
  '    "constraints": ["用户明确或强烈暗示的限制，0-6 条"],',
  '    "assumptions": ["为补全缺失信息而采用的关键假设，0-5 条"],',
  '    "gaps": ["需要用户补充的问题，0-6 条，每条以 ？ 结尾"],',
  '    "gapChoices": [["每个 gap 的简短候选答案，0-4 个，可被用户直接点击；与 gaps 一一对应"]]',
  '  },',
  '  "primary": {',
  '    "language": "主语言代码：zh 或 en",',
  '    "title": "不超过 24 个字符的短标题",',
  '    "role": "一句话说明智能体要扮演的角色",',
  '    "goal": "一段话说清目标与最终产物",',
  '    "context": ["背景、前提、已有条件，每条一句"],',
  '    "requirements": ["具体可执行的要求，每条一个动作或约束"],',
  '    "constraints": ["必须遵守的限制，如技术栈、格式、范围、合规"],',
  '    "output": ["对输出形式的要求，如文件类型、目录、语言"],',
  '    "acceptance": ["可检查的验收标准，每条可判定真伪"],',
  '    "risks": ["风险与注意事项，可选"]',
  '  },',
  '  "translation": {',
  '    "language": "另一种语言代码：zh 或 en（与 primary 相反）",',
  '    "title": "...",',
  '    "role": "...",',
  '    "goal": "...",',
  '    "context": [], "requirements": [], "constraints": [], "output": [], "acceptance": [], "risks": []',
  '  }',
  '}',
  '',
  '字段要求：',
  '- role 一句话；goal 一段话，不超过 120 字；requirements / acceptance 至少各 1 条，其余数组可以为空。',
  '- 每条 requirements 用祈使句，写清对象与动作，不写空话（如「认真完成」）。',
  '- 每条 acceptance 必须可判定，例如「切换筛选后导出，行数与列表总数一致」。',
  '- context 写用户已给出的前提或你从描述中确认的事实；推断出来的信息只能放进 assumptions，并在 context 中标注「（假设：…）」。',
  '- gaps 每条是一个问句，以 ？ 结尾；不要写「还有什么要补充」这类空问题。',
  '- gapChoices 与 gaps 一一对应；每条给 0-4 个简短候选答案（可直接点击），不要写成长句，也不要编造事实。',
  '- analysis.intent 只能取固定枚举：主语言为中文时使用「开发功能 / 修复缺陷 / 重构优化 / 调研分析 / 写作文档 / 数据分析 / 设计创作 / 自动化流程 / 其它」；主语言为英文时使用「Feature development / Bug fixing / Refactoring / optimization / Research / Writing / Data analysis / Design / Automation / Other」。',
  '- 原文中出现的代码、路径、URL、命令、专有名词原样保留，不要翻译。',
  '- primary 与 translation 的数组条数、顺序、含义必须一一对应。',
  '- 不要提出超出需求范围的功能；不确定的事写进 assumptions 或 gaps。'
].join('\n')

const DETAIL_TEXT = {
  concise: '精简：requirements 2-4 条，context 0-2 条，acceptance 2-3 条，risks 0-1 条，其余字段从简。',
  standard: '标准：requirements 4-6 条，context 1-3 条，acceptance 3-4 条，risks 0-2 条。',
  detailed: '详尽：requirements 6-9 条，context 2-4 条，acceptance 4-6 条，risks 1-3 条，覆盖边界情况与失败处理。'
}

const MODE_TEXT = {
  agent: '智能体执行指令（agent）：内容按「给智能体执行」组织，requirements 写执行动作，acceptance 写执行后如何验证。',
  spec: '需求规格（spec）：内容按「需求规格」组织，requirements 写功能需求，constraints 写非功能要求，acceptance 写验收标准。'
}

const LANGUAGE_TEXT = {
  auto: '跟随原始描述的语言。',
  zh: '中文。',
  en: 'English。'
}

/** Fixed section labels used by the deterministic assember. */
function labelsFor(language, mode) {
  if (language === 'en') {
    return mode === 'spec'
      ? {
          role: 'Role',
          goal: 'Goal',
          context: 'Background and scope',
          requirements: 'Functional requirements',
          constraints: 'Constraints and non-functional requirements',
          output: 'Deliverables and format',
          acceptance: 'Acceptance criteria',
          risks: 'Risks and notes'
        }
      : {
          role: 'Role',
          goal: 'Goal',
          context: 'Context',
          requirements: 'Requirements',
          constraints: 'Constraints',
          output: 'Output format',
          acceptance: 'Acceptance criteria',
          risks: 'Risks and notes'
        }
  }
  return mode === 'spec'
    ? {
        role: '角色',
        goal: '目标',
        context: '背景与范围',
        requirements: '功能需求',
        constraints: '约束与非功能要求',
        output: '交付物与形式',
        acceptance: '验收标准',
        risks: '风险与注意事项'
      }
    : {
        role: '角色',
        goal: '目标',
        context: '背景与上下文',
        requirements: '具体要求',
        constraints: '约束',
        output: '输出格式',
        acceptance: '验收标准',
        risks: '风险与注意事项'
      }
}

/** Clip a free-form string field. */
function clipText(value, maxChars) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxChars).trim()
}

/** Whether text is primarily Chinese. */
function detectLanguage(text) {
  if (typeof text !== 'string' || text === '') return 'zh'
  const cjk = (text.match(/[\u3400-\u9fff]/gu) || []).length
  const compact = text.replace(/\s/gu, '').length
  return cjk >= Math.max(2, compact * 0.15) ? 'zh' : 'en'
}

/** Normalize one list item: strip bullet/numbering, collapse whitespace, clip. */
function normalizeItem(value) {
  if (typeof value !== 'string') return ''
  const stripped = value
    .replace(/^[-*•·]\s+/u, '')
    .replace(/^\d+[.、)]\s+/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
  return stripped.slice(0, LIMITS.item).trim()
}

/** Normalize an array field with de-duplication and a fixed cap. */
function normalizeList(value, maxItems) {
  if (!Array.isArray(value)) return []
  const out = []
  const seen = new Set()
  for (const raw of value) {
    const item = normalizeItem(raw)
    if (item === '') continue
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
    if (out.length >= maxItems) break
  }
  return out
}

/** Normalize the optional Q/A pairs answered in the confirmation gate. */
function normalizeClarifications(value) {
  if (!Array.isArray(value)) return []
  const out = []
  const seen = new Set()
  for (const raw of value) {
    if (out.length >= LIMITS.gaps) break
    if (raw === null || typeof raw !== 'object') continue
    const question = clipText(raw.question, LIMITS.item)
    const answer = clipText(raw.answer, LIMITS.item)
    if (question === '' || answer === '') continue
    const key = question.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ question, answer })
  }
  return out
}

/** Validate and detach one panel/tool request. */
function normalizeRequest(input) {
  const raw = input !== null && typeof input === 'object' ? input : {}
  const rough = clipText(raw.rough, MAX_INPUT_CHARS)
  if (rough.length < 2) throw new CopilotError('E_EMPTY', '请先填写需求描述（至少 2 个字符）。')
  if (typeof raw.rough === 'string' && raw.rough.trim().length > MAX_INPUT_CHARS) {
    throw new CopilotError('E_TOO_LONG', '需求描述过长（上限 ' + String(MAX_INPUT_CHARS) + ' 字符），请分段处理。')
  }
  const context = clipText(raw.context, MAX_CONTEXT_CHARS)
  const previousPrompt = clipText(raw.previousPrompt, MAX_INPUT_CHARS)
  const revisionNote = clipText(raw.revisionNote, MAX_REVISION_CHARS)
  const mode = MODES.has(raw.mode) ? raw.mode : 'agent'
  const detail = DETAILS.has(raw.detail) ? raw.detail : 'standard'
  const language = LANGUAGES.has(raw.language) ? raw.language : 'auto'
  const target = TARGETS.has(raw.target) ? raw.target : 'generic'
  const scenario = SCENARIOS.has(raw.scenario) ? raw.scenario : 'general'
  const clarifications = normalizeClarifications(raw.clarifications)
  const primaryLanguage = language === 'auto' ? detectLanguage(rough) : language
  return { rough, context, previousPrompt, revisionNote, mode, detail, language, target, scenario, clarifications, primaryLanguage, translationLanguage: primaryLanguage === 'zh' ? 'en' : 'zh' }
}

/** Compose the one user message describing the material and the options. */
function buildUserMessage(request) {
  const lines = [
    '【原始描述】',
    request.rough
  ]
  if (request.context !== '') {
    lines.push('', '【补充上下文】', request.context)
  }
  if (request.clarifications.length > 0) {
    lines.push('', '【用户已确认的澄清】')
    for (const item of request.clarifications) {
      lines.push('- 问：' + item.question + ' 答：' + item.answer)
    }
  }
  if (request.previousPrompt !== '') {
    lines.push(
      '',
      '【上一版 Prompt（节选）】',
      request.previousPrompt.slice(0, REVISION_PREVIOUS_CHARS),
      '',
      '【用户对上一版的反馈】',
      request.revisionNote === '' ? '（无额外反馈，请在保留原意的前提下精炼）' : request.revisionNote
    )
  }
  lines.push(
    '',
    '【生成要求】',
    '- 类型：' + MODE_TEXT[request.mode],
    '- 场景：' + SCENARIO_TEXT[request.scenario],
    '- 详细程度：' + DETAIL_TEXT[request.detail],
    '- 主语言：' + (request.primaryLanguage === 'zh' ? '中文' : 'English') + '（' + LANGUAGE_TEXT[request.language] + '）',
    '- 译文语言：' + (request.translationLanguage === 'zh' ? '中文' : 'English'),
    '- analysis.intent 枚举：' + INTENTS[request.primaryLanguage].join(' / '),
    '- 只输出 JSON 对象，字段结构见系统指令。'
  )
  if (request.previousPrompt !== '') {
    lines.push('- 这是续写：在上一版 Prompt 基础上做增量修改，用户未要求改变的内容保持原样，不要从头重写。')
  }
  return lines.join('\n')
}

/** The bounded repair message: previous output plus validation errors. */
function buildRepairMessage(request, previousText, errors) {
  const lines = [
    '【原始描述】',
    request.rough
  ]
  if (request.context !== '') lines.push('', '【补充上下文】', request.context)
  if (request.clarifications.length > 0) {
    lines.push('', '【用户已确认的澄清】')
    for (const item of request.clarifications) {
      lines.push('- 问：' + item.question + ' 答：' + item.answer)
    }
  }
  if (request.previousPrompt !== '') {
    lines.push(
      '',
      '【上一版 Prompt（节选）】',
      request.previousPrompt.slice(0, REVISION_PREVIOUS_CHARS),
      '',
      '【用户对上一版的反馈】',
      request.revisionNote === '' ? '（无额外反馈，请在保留原意的前提下精炼）' : request.revisionNote
    )
  }
  lines.push(
    '',
    '【上一次输出（节选）】',
    previousText.slice(0, REPAIR_PREVIOUS_CHARS),
    '',
    '【校验未通过，原因如下】',
    ...errors.slice(0, 8).map((error) => '- ' + error),
    '',
    '【修正要求】',
    '- 只输出修正后的完整 JSON 对象，不要代码围栏，不要解释，不要输出 Markdown Prompt。',
    '- 保持 JSON 结构不变，只修正上面列出的问题。',
    '- 主语言：' + (request.primaryLanguage === 'zh' ? '中文' : 'English') + '；translation 使用' + (request.translationLanguage === 'zh' ? '中文' : 'English') + '。',
    '- 详细程度：' + DETAIL_TEXT[request.detail],
    '- 类型：' + MODE_TEXT[request.mode],
    '- 场景：' + SCENARIO_TEXT[request.scenario]
  )
  if (request.previousPrompt !== '') {
    lines.push('- 保持上一版中用户未要求改变的内容，只做增量修改。')
  }
  return lines.join('\n')
}

/** Render a validated content block as the final Markdown Prompt. */
function assemblePrompt(block, language, mode, target) {
  const labels = labelsFor(language, mode)
  const preamble = target !== 'generic' && TARGET_PREAMBLES[target] !== undefined
    ? TARGET_PREAMBLES[target][language]
    : ''
  const bullets = (items) => items.map((item) => '- ' + item).join('\n')
  const numbered = (items) => items.map((item, index) => String(index + 1) + '. ' + item).join('\n')
  const sections = []
  sections.push('# ' + block.title)
  if (preamble !== '') sections.push(preamble)
  sections.push('## ' + labels.role)
  sections.push(block.role)
  sections.push('## ' + labels.goal)
  sections.push(block.goal)
  if (block.context.length > 0) {
    sections.push('## ' + labels.context)
    sections.push(bullets(block.context))
  }
  sections.push('## ' + labels.requirements)
  sections.push(numbered(block.requirements))
  if (block.constraints.length > 0) {
    sections.push('## ' + labels.constraints)
    sections.push(bullets(block.constraints))
  }
  if (block.output.length > 0) {
    sections.push('## ' + labels.output)
    sections.push(bullets(block.output))
  }
  sections.push('## ' + labels.acceptance)
  sections.push(numbered(block.acceptance))
  if (block.risks.length > 0) {
    sections.push('## ' + labels.risks)
    sections.push(bullets(block.risks))
  }
  return sections.join('\n\n')
}

/**
 * Validate one parsed payload and normalize it into content blocks.
 * Returns `{ errors, analysis, blocks }`; any error means the payload is not
 * fit to become a user-visible prompt.
 */
function validatePayload(parsed, request) {
  const errors = []
  const source = parsed !== null && typeof parsed === 'object' ? parsed : {}
  const analysisSource = source.analysis !== null && typeof source.analysis === 'object' ? source.analysis : {}

  const expectedPrimary = request.primaryLanguage
  const expectedTranslation = request.translationLanguage
  const expectedIntents = INTENTS[expectedPrimary]

  const summary = clipText(analysisSource.summary, LIMITS.summary)
  if (summary === '') errors.push('analysis.summary 不能为空')

  const intent = clipText(analysisSource.intent, LIMITS.intent)
  if (intent === '') errors.push('analysis.intent 不能为空')
  else if (!expectedIntents.includes(intent)) errors.push('analysis.intent 必须是以下之一：' + expectedIntents.join(' / '))

  const gaps = []
  const rawGaps = Array.isArray(analysisSource.gaps) ? analysisSource.gaps : []
  for (const raw of rawGaps) {
    if (gaps.length >= LIMITS.gaps) break
    const gap = normalizeItem(raw)
    if (gap === '') continue
    if (!/[?？]$/u.test(gap)) errors.push('analysis.gaps 的每条都必须是一个问句（以 ？ 或 ? 结尾）：' + gap.slice(0, 40))
    if (!gaps.includes(gap)) gaps.push(gap)
  }

  const analysis = {
    summary,
    intent,
    deliverables: normalizeList(analysisSource.deliverables, LIMITS.deliverables),
    constraints: normalizeList(analysisSource.constraints, LIMITS.analysisConstraints),
    assumptions: normalizeList(analysisSource.assumptions, LIMITS.assumptions),
    gaps
  }

  const rawChoices = Array.isArray(analysisSource.gapChoices) ? analysisSource.gapChoices : []
  if (rawChoices.length > 0 && rawChoices.length !== gaps.length) {
    errors.push('analysis.gapChoices 的条数必须与 gaps 一致')
  }
  analysis.gapChoices = gaps.map((_, index) => normalizeList(rawChoices[index], 4))

  const blocks = {}
  for (const key of ['primary', 'translation']) {
    const blockSource = source[key] !== null && typeof source[key] === 'object' ? source[key] : {}
    const expectedLanguage = key === 'primary' ? expectedPrimary : expectedTranslation
    const block = {
      title: clipText(blockSource.title, LIMITS.title),
      role: clipText(blockSource.role, LIMITS.role),
      goal: clipText(blockSource.goal, LIMITS.goal),
      context: normalizeList(blockSource.context, LIMITS.context),
      requirements: normalizeList(blockSource.requirements, LIMITS.requirements[request.detail]),
      constraints: normalizeList(blockSource.constraints, LIMITS.constraints),
      output: normalizeList(blockSource.output, LIMITS.output),
      acceptance: normalizeList(blockSource.acceptance, LIMITS.acceptance),
      risks: normalizeList(blockSource.risks, LIMITS.risks)
    }
    if (clipText(blockSource.language, 8) !== expectedLanguage) {
      errors.push(key + '.language 必须是 "' + expectedLanguage + '"')
    }
    if (block.title === '') errors.push(key + '.title 不能为空')
    if (block.role === '') errors.push(key + '.role 不能为空')
    if (block.goal === '') errors.push(key + '.goal 不能为空')
    if (block.requirements.length === 0) errors.push(key + '.requirements 至少 1 条')
    if (block.acceptance.length === 0) errors.push(key + '.acceptance 至少 1 条')
    blocks[key] = block
  }

  if (blocks.primary !== undefined && blocks.translation !== undefined) {
    if (blocks.primary.goal === blocks.translation.goal && blocks.primary.role === blocks.translation.role) {
      errors.push('translation 与 primary 内容相同，必须给出真正的另一种语言版本')
    }
    if (blocks.primary.requirements.length !== blocks.translation.requirements.length) {
      errors.push('translation.requirements 的条数必须与 primary 一致')
    }
    if (blocks.primary.acceptance.length !== blocks.translation.acceptance.length) {
      errors.push('translation.acceptance 的条数必须与 primary 一致')
    }
  }

  return { errors, analysis, blocks }
}

/**
 * Deterministic, zero-cost structural self-check. It is not a model judge: it
 * only reports whether the assembled Prompt has the shape we promise.
 */
function evaluateQuality(validated, request, prompt) {
  const primary = validated.blocks.primary
  const translation = validated.blocks.translation
  const checks = [
    { id: 'structure', pass: prompt.startsWith('# ') && (prompt.match(/^## /gm) || []).length >= 3 },
    { id: 'requirements', pass: primary.requirements.length >= 2 },
    { id: 'acceptance', pass: primary.acceptance.length >= 2 },
    { id: 'constraints', pass: primary.constraints.length + primary.context.length > 0 },
    { id: 'gaps', pass: validated.analysis.gaps.length === 0 },
    { id: 'translation', pass: translation.requirements.length === primary.requirements.length && translation.acceptance.length === primary.acceptance.length && translation.goal !== '' },
    { id: 'target', pass: request.target === 'generic' || prompt.includes('> 目标环境：') || prompt.includes('> Target:') }
  ]
  const passed = checks.filter((check) => check.pass).length
  return { score: Math.round((passed / checks.length) * 100), checks }
}

/** Fold a validated payload into the final command/tool result. */
function buildResult(validated, request, route) {
  const prompt = assemblePrompt(validated.blocks.primary, request.primaryLanguage, request.mode, request.target)
  const translation = assemblePrompt(validated.blocks.translation, request.translationLanguage, request.mode, request.target)
  return {
    title: validated.blocks.primary.title,
    analysis: validated.analysis,
    prompt,
    translation,
    meta: {
      source: 'model',
      provider: route.provider,
      model: route.model,
      target: request.target,
      scenario: request.scenario,
      revision: request.previousPrompt !== '',
      quality: evaluateQuality(validated, request, prompt),
      promptChars: prompt.length
    }
  }
}

/** Resolve the deployed model route, preferring the profile default. */
async function resolveRoute(ctx, llm) {
  const defaults = ctx.get('agentDefaultModel')
  if (defaults !== undefined && defaults !== null && typeof defaults.currentSelection === 'function') {
    try {
      const selection = defaults.currentSelection()
      if (selection !== null && typeof selection === 'object'
        && typeof selection.provider === 'string' && selection.provider !== ''
        && typeof selection.model === 'string' && selection.model !== '') {
        return {
          provider: selection.provider,
          model: selection.model,
          ...(typeof selection.reasoningEffort === 'string' && selection.reasoningEffort !== ''
            ? { reasoningEffort: selection.reasoningEffort }
            : {})
        }
      }
    } catch {
      // Fall through to directory discovery.
    }
  }
  if (typeof llm.listProviders === 'function') {
    let providers = []
    try {
      providers = await llm.listProviders()
    } catch {
      providers = []
    }
    for (const provider of Array.isArray(providers) ? providers : []) {
      const id = provider !== null && typeof provider === 'object' ? provider.id : undefined
      if (typeof id !== 'string' || id === '' || typeof llm.listModels !== 'function') continue
      try {
        const models = await llm.listModels(id)
        const first = Array.isArray(models) ? models.find((m) => m !== null && typeof m === 'object' && typeof m.id === 'string') : undefined
        if (first !== undefined) return { provider: id, model: first.id }
      } catch {
        // Try the next route.
      }
    }
  }
  throw new CopilotError('E_NO_MODEL', '找不到可用的模型路由，请先在设置里选择默认模型。')
}

/**
 * Stream one completion and return its visible text.
 * The terminating `finish` chunk is the only failure/abort/truncation authority.
 */
async function streamCompletion(llm, route, system, userText, signal, detail) {
  const controller = new AbortController()
  const forwardAbort = () => {
    try {
      controller.abort(signal.reason)
    } catch {
      controller.abort()
    }
  }
  if (signal !== undefined) {
    if (signal.aborted) throw new CopilotError('E_ABORTED', '生成已取消。')
    signal.addEventListener('abort', forwardAbort, { once: true })
  }
  const timer = setTimeout(() => {
    try {
      controller.abort(new Error('requirement-copilot: timeout'))
    } catch {
      controller.abort()
    }
  }, TIMEOUT_MS)
  const maxTokens = detail === 'concise' ? 4096 : 8192
  let text = ''
  let failure
  let truncated = false
  try {
    const options = {
      provider: route.provider,
      model: route.model,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
      maxTokens,
      signal: controller.signal
    }
    if (route.reasoningEffort !== undefined) options.reasoningEffort = route.reasoningEffort
    for await (const chunk of llm.stream(options)) {
      if (chunk === null || typeof chunk !== 'object') continue
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
        text += chunk.text
        if (text.length > MAX_MODEL_TEXT_CHARS) {
          throw new CopilotError('E_OUTPUT_TOO_LONG', '模型输出过长，请缩短描述或降低详细程度后重试。')
        }
      } else if (chunk.type === 'finish' && chunk.reason !== null && typeof chunk.reason === 'object') {
        if (chunk.reason.kind === 'error') failure = chunk.reason.failure
        else if (chunk.reason.kind === 'aborted') failure = chunk.reason.failure
        else if (chunk.reason.kind === 'max-tokens') truncated = true
      }
    }
  } catch (error) {
    if (error instanceof CopilotError) throw error
    if (controller.signal.aborted) throw new CopilotError('E_TIMEOUT', '生成超时或被取消，请重试。')
    throw new CopilotError('E_LLM', '模型调用失败：' + messageOf(error))
  } finally {
    clearTimeout(timer)
    if (signal !== undefined) signal.removeEventListener('abort', forwardAbort)
  }
  if (controller.signal.aborted) {
    if (signal !== undefined && signal.aborted) throw new CopilotError('E_ABORTED', '生成已取消。')
    throw new CopilotError('E_TIMEOUT', '生成超时或被取消，请重试。')
  }
  if (failure !== undefined && failure !== null) {
    const code = typeof failure.code === 'string' ? failure.code : 'LLM_FAILURE'
    const message = typeof failure.message === 'string' ? failure.message : '模型调用失败'
    throw new CopilotError('E_LLM', '模型调用失败（' + code + '）：' + message)
  }
  if (truncated) {
    throw new CopilotError('E_TRUNCATED', '模型输出被截断（达到输出上限）。请把「详略」改为「精简」或缩短描述后重试。')
  }
  return text.trim()
}

/** Tolerant JSON-object extraction: fences, prose, and trailing noise are stripped. */
function parseJsonObject(text) {
  if (typeof text !== 'string' || text.trim() === '') return undefined
  const trimmed = text.trim()
  const candidates = [trimmed]
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
  if (fence !== null && typeof fence[1] === 'string') candidates.unshift(fence[1].trim())
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1))
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate)
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value
    } catch {
      // Try the next candidate.
    }
  }
  return undefined
}

/**
 * The one generation operation: generate → validate → one bounded repair.
 * Throws CopilotError on any failure; never returns an unvalidated payload.
 */
async function generate(ctx, input, signal) {
  const request = normalizeRequest(input)
  const llm = ctx.get('llm')
  if (llm === undefined || llm === null || typeof llm.stream !== 'function') {
    throw new CopilotError('E_NO_LLM', '当前部署没有可用的模型服务（ctx.llm），无法生成 Prompt。')
  }
  const route = await resolveRoute(ctx, llm)
  const system = SYSTEM_PROMPT
  const firstText = await streamCompletion(llm, route, system, buildUserMessage(request), signal, request.detail)
  const firstParsed = parseJsonObject(firstText)
  if (firstParsed === undefined) {
    // One repair round also covers an unparsable first answer.
    return repairAndBuild(ctx, { llm, route, system, request, signal, previousText: firstText, errors: ['输出不是合法 JSON 对象'] })
  }
  const validated = validatePayload(firstParsed, request)
  if (validated.errors.length === 0) return buildResult(validated, request, route)
  return repairAndBuild(ctx, { llm, route, system, request, signal, previousText: firstText, errors: validated.errors })
}

/** One bounded repair round; a second invalid answer is a hard failure. */
async function repairAndBuild(ctx, state) {
  const { llm, route, system, request, signal, previousText, errors } = state
  if (signal !== undefined && signal.aborted) throw new CopilotError('E_ABORTED', '生成已取消。')
  const repairText = buildRepairMessage(request, previousText, errors)
  const repairedText = await streamCompletion(llm, route, system, repairText, signal, request.detail)
  const repairedParsed = parseJsonObject(repairedText)
  if (repairedParsed === undefined) {
    throw new CopilotError('E_INVALID', '模型输出未通过校验，自动重试后仍不是合法 JSON。请重试或改用「精简」。')
  }
  const repaired = validatePayload(repairedParsed, request)
  if (repaired.errors.length > 0) {
    throw new CopilotError('E_INVALID', '模型输出未通过校验（已自动重试一次）：' + repaired.errors.slice(0, 3).join('；'))
  }
  return buildResult(repaired, request, route)
}

/** Model-facing rendering of one result. */
function renderForModel(value) {
  const data = value !== null && typeof value === 'object' ? value : {}
  const analysis = data.analysis !== null && typeof data.analysis === 'object' ? data.analysis : {}
  const section = (label, items) => {
    if (!Array.isArray(items) || items.length === 0) return []
    return ['', '### ' + label, ...items.map((item) => '- ' + String(item))]
  }
  const lines = []
  if (typeof data.title === 'string' && data.title !== '') lines.push('# ' + data.title)
  if (typeof analysis.summary === 'string' && analysis.summary !== '') lines.push('', '**摘要：** ' + analysis.summary)
  if (typeof analysis.intent === 'string' && analysis.intent !== '') lines.push('', '**意图：** ' + analysis.intent)
  lines.push(...section('交付物', analysis.deliverables))
  lines.push(...section('约束', analysis.constraints))
  lines.push(...section('假设', analysis.assumptions))
  lines.push(...section('待补充', analysis.gaps))
  lines.push('', '## Prompt', '', typeof data.prompt === 'string' ? data.prompt : '')
  if (typeof data.translation === 'string' && data.translation !== '') lines.push('', '## Translation', '', data.translation)
  return lines.join('\n')
}

/** Skill exposed to models: when and how to drive `refine_requirement`. */
const SKILL_NAME = 'requirement-refine'
const SKILL_DESCRIPTION = '把零散、不完整或含糊的需求描述整理成可直接交给智能体执行的 Prompt（含复述、缺口、假设、固定格式 Prompt 与中英译文）。'
const SKILL_WHEN_TO_USE = '用户要求「整理需求 / 补全需求 / 把需求翻译成给 Agent 的指令 / 这段描述怎么交给智能体做」时；或你需要在执行前把模糊需求变成可执行任务并确认缺口时。需求已足够具体、或用户只是闲聊时不要用。'

const SKILL_CONTENT = [
  '# 需求整理（Requirement Refine）',
  '',
  '把用户零散、不完整或含糊的需求描述，整理成一份可直接交给智能体执行的 Prompt。本 skill 通过 Host 工具 `refine_requirement` 完成整理：它会给出结构化分析（复述 / 意图 / 交付物 / 约束 / 假设 / 待补充）+ 固定格式的 Prompt + 另一语言译文。',
  '',
  '## 什么时候用',
  '- 用户说「帮我把这段需求整理成 prompt」「补全我的需求」「这句话怎么交给 Agent 做」「把需求翻译成任务指令」。',
  '- 用户给的是聊天记录、口头描述、零散要点，缺少验收标准 / 约束 / 输出格式。',
  '- 你要把一段模糊需求转成可执行任务，并希望在执行前先向用户确认缺口。',
  '',
  '## 什么时候不用',
  '- 需求已经足够具体，直接执行即可。',
  '- 用户只想闲聊或问概念。',
  '- 用户已经在输入框旁的 ✨「帮我说」面板里生成过结果——不要重复调用、重复计费。',
  '',
  '## 怎么调用',
  '工具：`refine_requirement`',
  '- `rough`（必填）：用户原话或聊天记录，尽量保持原文，不要提前总结。',
  '- `context`（可选）：已有约束、技术栈、相关文件路径、背景。',
  '- `previousPrompt` / `revisionNote`（可选）：续写时传入上一版 Prompt 和用户反馈；模型会保留未要求改变的内容，做增量修改。',
  '- `clarifications`（可选）：用户对上一轮 gaps 的回答，`[{question, answer}]`；有答案时不要重复问同一个问题。',
  '- `mode`：`agent`（默认，给智能体执行的任务指令）| `spec`（结构化需求规格）。',
  '- `scenario`：`general`（默认）| `coding` | `writing` | `research` | `data` | `automation`；只影响内容侧重，不改变输出结构。',
  '- `target`：`generic`（默认，通用 Markdown）| `claude-code` | `codex` | `cursor`；后三者会在 Prompt 开头加一行目标环境提示。',
  '- `detail`：`concise`（快速草稿、很长输入时用）| `standard`（默认）| `detailed`。',
  '- `language`：`auto`（默认，跟随原文语言）| `zh` | `en`；译文会自动给出另一种语言。',
  '',
  '示例参数：',
  '```json',
  '{"rough":"我想给团队做个周报工具，每周五自动汇总 GitLab 提交发飞书","mode":"agent","scenario":"automation","target":"generic","detail":"standard","language":"auto"}',
  '```',
  '',
  '## 结果怎么用',
  '工具返回 `title`、`analysis`（summary / intent / deliverables / constraints / assumptions / gaps）、`prompt`、`translation`、`meta`。呈现给用户时：',
  '1. 先用一句话复述你理解的目标，再列出 2-4 条最关键的 gaps（如果有）。',
  '2. 把 `prompt` 放进代码块给用户确认；不要贴原始 JSON，也不要逐字段复述。',
  '3. 说明这是「给智能体的指令」，询问用户是直接执行，还是先补 gaps 再执行。',
  '4. 只有用户需要英文时才提供 `translation`。',
  '',
  '## gaps 的处理',
  '- 用户没有回答 gaps 时不要卡住：可以带着合理的 assumptions 继续，但在结果中明确标注假设。',
  '- 用户在确认门里回答了 gaps 时，把 `[{question, answer}]` 放进 `clarifications` 再调用一次；不要把答案塞进 `rough`，也不要在新一轮里重复问同一个问题。',
  '- 用户补充信息后，把补充内容放进 `context` 再调用一次，而不是手动修改 Prompt 文本（保持格式一致）。',
  '',
  '## 失败处理',
  '- 返回「输出被截断」：改用 `detail: "concise"` 重试，或让用户缩短描述；不要编造。',
  '- 返回「未通过校验」：把 rough 拆短或补充 context 后重试一次；仍失败就如实告知，不要手工拼 Prompt。',
  '- 不要为了绕过校验而编造字段。',
  '',
  '## 成本与隐私',
  '- 每次调用是一次独立的模型请求（当前默认模型），会消耗用户额度；同一需求不要反复调用。',
  '- rough / context 会发送给模型提供方；提醒用户不要粘贴密钥、密码等敏感信息。'
].join('\n')

/**
 * Host plugin body: register the shared operation as one Agent tool and one
 * human command. Both are Cordis effects owned by this plugin's fiber.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.commands.register({
    name: COMMAND_NAME,
    description: '帮我说：把输入框附近的描述整理成可直接执行的 Agent Prompt（由帮我说面板调用）',
    recordInput: false,
    handler: async (invocation) => {
      const rawInput = typeof invocation.rawInput === 'string' ? invocation.rawInput.trim() : ''
      if (rawInput === '') {
        return { kind: 'error', text: '请通过输入框上方的「帮我说」面板使用 /' + COMMAND_NAME + '。' }
      }
      let payload
      try {
        payload = JSON.parse(rawInput)
      } catch {
        return { kind: 'error', text: '帮我说请求载荷不是合法 JSON。' }
      }
      try {
        const data = await generate(ctx, payload, invocation.signal)
        return { kind: 'success', text: JSON.stringify({ ok: true, data }) }
      } catch (error) {
        const code = error instanceof CopilotError ? error.code : 'E_UNKNOWN'
        return { kind: 'success', text: JSON.stringify({ ok: false, code, error: messageOf(error) }) }
      }
    }
  }), 'requirement-copilot: human command')

  ctx.effect(() => ctx.tools.register({
    name: TOOL_NAME,
    description: '把一段零散或不完整的需求描述整理成可直接交给 AI 智能体执行的 Prompt，并给出意图、交付物、约束、假设与缺失信息（gaps），同时提供英文/中文对照译文。当用户要求「把这段需求整理成 prompt」「补全我的需求」「把需求翻译成给 Agent 的指令」时调用。',
    parameters: {
      type: 'object',
      properties: {
        rough: { type: 'string', description: '用户原始需求描述，可以是零散笔记、口语化表达或聊天记录。' },
        context: { type: 'string', description: '可选的补充上下文：已有约束、相关文件、背景信息。' },
        previousPrompt: { type: 'string', description: '可选：上一版 Prompt。提供时模型做增量修改，而不是从头重写。' },
        revisionNote: { type: 'string', description: '可选：用户对上一版的反馈/续写要求（最多 2000 字符）。' },
        clarifications: {
          type: 'array',
          maxItems: 6,
          description: '用户对上一轮 gaps 的回答，例如 [{"question":"要不要登录？","answer":"要，支持手机号登录"}]；有答案时不要重复提问。',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string' },
              answer: { type: 'string' }
            },
            required: ['question', 'answer'],
            additionalProperties: false
          }
        },
        mode: {
          type: 'string',
          enum: ['agent', 'spec'],
          description: 'agent=可直接给智能体执行的任务提示词（默认）；spec=结构化需求规格。'
        },
        scenario: {
          type: 'string',
          enum: ['general', 'coding', 'writing', 'research', 'data', 'automation'],
          description: '任务场景，默认 general；只影响内容侧重（如编码的验收写测试），不改变输出结构。'
        },
        detail: {
          type: 'string',
          enum: ['concise', 'standard', 'detailed'],
          description: '输出详略程度，默认 standard。'
        },
        language: {
          type: 'string',
          enum: ['auto', 'zh', 'en'],
          description: 'Prompt 主语言，默认 auto（跟随原始描述）。'
        },
        target: {
          type: 'string',
          enum: ['generic', 'claude-code', 'codex', 'cursor'],
          description: '目标环境，默认 generic；claude-code/codex/cursor 会在 Prompt 开头加入对应环境提示。'
        }
      },
      required: ['rough'],
      additionalProperties: false
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(args, value) {
        return [{ type: 'text', text: renderForModel(value) }]
      }
    },
    async execute(args, exec) {
      return generate(ctx, args, exec.signal)
    }
  }), 'requirement-copilot: agent tool')

  // Embedded skill: tells models when and how to drive `refine_requirement`.
  // The registry is optional so the bundle still loads in compositions without it.
  try {
    const skills = ctx.get('skills')
    if (skills !== undefined && skills !== null && typeof skills.register === 'function') {
      ctx.effect(() => skills.register({
        name: SKILL_NAME,
        description: SKILL_DESCRIPTION,
        whenToUse: SKILL_WHEN_TO_USE,
        content: SKILL_CONTENT,
        invocation: { modelInvocable: true, userInvocable: false }
      }), 'requirement-copilot: embedded skill')
    }
  } catch {
    // Skill registry unavailable: the tool description still covers direct use.
  }
}

export const inject = ['commands', 'tools']
