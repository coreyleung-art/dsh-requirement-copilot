import test from 'node:test'
import assert from 'node:assert/strict'

import { apply, inject } from '../index.js'

const DEFAULT_SELECTION = { provider: 'test-provider', model: 'test-model' }

/** A fresh, valid model payload for the deterministic assembler. */
function validPayload(overrides = {}) {
  return {
    analysis: {
      summary: '在设置页新增深色模式开关并持久化。',
      intent: '开发功能',
      deliverables: ['开关组件', '主题切换逻辑'],
      constraints: ['切换后立即生效'],
      assumptions: ['项目已有主题机制'],
      gaps: ['是否需要跟随系统？'],
      gapChoices: [['是', '否']]
    },
    primary: {
      language: 'zh',
      title: '设置页深色模式开关',
      role: '负责前端功能实现的工程师',
      goal: '新增深色模式开关，切换立即生效并持久化。',
      context: ['设置页已有主题样式体系。'],
      requirements: ['在设置页加入开关', '切换后立即更新主题', '持久化用户选择'],
      constraints: ['复用现有主题变量', '不改变其他设置项'],
      output: ['提交改动文件清单'],
      acceptance: ['切换后当前页面立即变深色', '刷新后保持上次选择'],
      risks: ['首屏可能出现主题闪烁']
    },
    translation: {
      language: 'en',
      title: 'Dark mode toggle in settings',
      role: 'Frontend engineer',
      goal: 'Add a dark mode toggle that applies instantly and persists.',
      context: ['The settings page already has theming.'],
      requirements: ['Add the toggle', 'Apply the theme instantly', 'Persist the choice'],
      constraints: ['Reuse existing theme variables', 'Do not change other settings'],
      output: ['List changed files'],
      acceptance: ['Toggling switches to dark immediately', 'The choice survives a refresh'],
      risks: ['Possible first-paint flicker']
    },
    ...overrides
  }
}

function createHarness(options = {}) {
  const responses = options.responses ?? []
  const calls = []
  const commandDefs = []
  const toolDefs = []
  const skillDefs = []
  const llm = options.withLlm === false
    ? undefined
    : {
        async *stream(request) {
          calls.push(request)
          const spec = responses[Math.min(calls.length - 1, responses.length - 1)] ?? { text: '' }
          if (spec.throw !== undefined) throw spec.throw
          if (typeof spec.text === 'string' && spec.text !== '') {
            const half = Math.max(1, Math.floor(spec.text.length / 2))
            yield { type: 'text-delta', text: spec.text.slice(0, half) }
            yield { type: 'text-delta', text: spec.text.slice(half) }
          }
          yield { type: 'finish', reason: spec.truncate === true ? { kind: 'max-tokens' } : { kind: 'stop' } }
        }
      }
  const ctx = {
    effect(fn) {
      const disposer = fn()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    get(name) {
      if (name === 'llm') return llm
      if (name === 'agentDefaultModel') return { currentSelection: () => (options.selection ?? DEFAULT_SELECTION) }
      if (name === 'skills') {
        return {
          register(definition) {
            skillDefs.push(definition)
            return () => {}
          }
        }
      }
      return undefined
    },
    commands: {
      register(definition) {
        commandDefs.push(definition)
        return () => {}
      }
    },
    tools: {
      register(definition) {
        toolDefs.push(definition)
        return () => {}
      }
    }
  }
  apply(ctx)
  return { calls, commandDefs, toolDefs, skillDefs }
}

function getTool(harness) {
  const tool = harness.toolDefs.find((definition) => definition.name === 'refine_requirement')
  assert.ok(tool, 'refine_requirement tool should be registered')
  return tool
}

async function callTool(harness, args) {
  return getTool(harness).execute(args, { signal: new AbortController().signal })
}

async function callCommand(harness, payload) {
  const command = harness.commandDefs.find((definition) => definition.name === 'refine-prompt')
  assert.ok(command, 'refine-prompt command should be registered')
  const execution = await command.handler({
    rawInput: JSON.stringify(payload),
    signal: new AbortController().signal
  })
  return { command, execution, body: JSON.parse(execution.text) }
}

async function assertRejectsCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `expected code ${code}, got ${String(error.code)} (${error.message})`)
    return true
  })
}

test('host: registers one command, one tool and one embedded skill', () => {
  const harness = createHarness()
  assert.equal(harness.commandDefs.length, 1)
  assert.equal(harness.commandDefs[0].name, 'refine-prompt')
  assert.equal(harness.commandDefs[0].recordInput, false)
  assert.match(harness.commandDefs[0].description, /帮我说/)
  assert.equal(harness.toolDefs.length, 1)
  assert.equal(harness.toolDefs[0].name, 'refine_requirement')
  assert.equal(harness.skillDefs.length, 1)
  assert.equal(harness.skillDefs[0].name, 'requirement-refine')
  assert.deepEqual(harness.skillDefs[0].invocation, { modelInvocable: true, userInvocable: false })
  assert.match(harness.skillDefs[0].content, /帮我说/)
  assert.deepEqual(inject, ['commands', 'tools'])
})

test('host: assembles the agent prompt deterministically and ignores model markdown', async () => {
  const payload = validPayload({ prompt: 'MODEL_MARKDOWN_SHOULD_BE_IGNORED' })
  const harness = createHarness({ responses: [{ text: JSON.stringify(payload) }] })
  const result = await callTool(harness, { rough: '给设置页加深色模式开关' })

  assert.equal(harness.calls.length, 1)
  assert.equal(result.title, '设置页深色模式开关')
  assert.equal(result.analysis.intent, '开发功能')
  assert.deepEqual(result.analysis.gaps, ['是否需要跟随系统？'])
  assert.deepEqual(result.analysis.gapChoices, [['是', '否']])
  assert.match(result.prompt, /^# 设置页深色模式开关\n\n## 角色/)
  assert.match(result.prompt, /## 目标/)
  assert.match(result.prompt, /## 具体要求\n\n1\. 在设置页加入开关/)
  assert.match(result.prompt, /## 验收标准/)
  assert.ok(!result.prompt.includes('MODEL_MARKDOWN_SHOULD_BE_IGNORED'), 'model-provided markdown must not be reused')
  assert.match(result.translation, /^# Dark mode toggle in settings\n\n## Role/)
  assert.match(result.translation, /## Requirements/)
  assert.equal(result.meta.source, 'model')
  assert.equal(result.meta.provider, 'test-provider')
  assert.equal(result.meta.model, 'test-model')
  assert.equal(result.meta.promptChars, result.prompt.length)
})

test('host: spec mode uses the fixed spec section labels', async () => {
  const harness = createHarness({ responses: [{ text: JSON.stringify(validPayload()) }] })
  const result = await callTool(harness, { rough: '把需求整理成规格', mode: 'spec' })
  assert.match(result.prompt, /## 功能需求/)
  assert.match(result.prompt, /## 约束与非功能要求/)
  assert.match(result.prompt, /## 交付物与形式/)
  assert.match(result.translation, /## Functional requirements/)
})

test('host: target presets add a deterministic environment preamble', async () => {
  for (const [target, marker] of [
    ['claude-code', '> 目标环境：Claude Code'],
    ['codex', '> 目标环境：Codex'],
    ['cursor', '> 目标环境：Cursor']
  ]) {
    const harness = createHarness({ responses: [{ text: JSON.stringify(validPayload()) }] })
    const result = await callTool(harness, { rough: '整理需求', target })
    assert.equal(result.meta.target, target)
    assert.match(result.prompt, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(result.prompt, /## 角色/)
  }

  const englishPayload = validPayload()
  englishPayload.analysis.intent = 'Feature development'
  englishPayload.primary.language = 'en'
  englishPayload.primary.title = 'Dark mode toggle'
  englishPayload.translation.language = 'zh'
  const englishHarness = createHarness({ responses: [{ text: JSON.stringify(englishPayload) }] })
  const english = await callTool(englishHarness, { rough: 'organize this request', language: 'en', target: 'codex' })
  assert.match(english.prompt, /> Target: Codex \(in-repository execution\)\./)
  assert.equal(english.meta.target, 'codex')
})

test('host: scenario presets shape the model guidance and are recorded', async () => {
  const harness = createHarness({ responses: [{ text: JSON.stringify(validPayload()) }] })
  const result = await callTool(harness, { rough: '把订单导出改成异步', scenario: 'coding' })
  const userText = harness.calls[0].messages[0].content[0].text
  assert.match(userText, /场景：编码实现/)
  assert.equal(result.meta.scenario, 'coding')
})

test('host: unknown scenario falls back to general', async () => {
  const harness = createHarness({ responses: [{ text: JSON.stringify(validPayload()) }] })
  const result = await callTool(harness, { rough: '整理需求', scenario: 'not-a-scenario' })
  assert.equal(result.meta.scenario, 'general')
})

test('host: deterministic quality checks are attached to model results', async () => {
  const clean = validPayload()
  clean.analysis.gaps = []
  clean.analysis.gapChoices = []
  const harness = createHarness({ responses: [{ text: JSON.stringify(clean) }] })
  const result = await callTool(harness, { rough: '整理需求' })
  const byId = Object.fromEntries(result.meta.quality.checks.map((check) => [check.id, check.pass]))
  assert.equal(result.meta.quality.score, 100)
  assert.equal(byId.structure, true)
  assert.equal(byId.requirements, true)
  assert.equal(byId.acceptance, true)
  assert.equal(byId.gaps, true)
  assert.equal(byId.translation, true)

  const withGap = validPayload()
  const gapHarness = createHarness({ responses: [{ text: JSON.stringify(withGap) }] })
  const gapResult = await callTool(gapHarness, { rough: '整理需求' })
  assert.equal(gapResult.meta.quality.checks.find((check) => check.id === 'gaps').pass, false)
  assert.ok(gapResult.meta.quality.score < 100)
})

test('host: english primary uses english labels and the english intent enum', async () => {
  const payload = validPayload()
  payload.analysis.intent = 'Feature development'
  payload.primary.language = 'en'
  payload.primary.title = 'Dark mode toggle'
  payload.translation.language = 'zh'
  payload.translation.title = '深色模式开关'

  const harness = createHarness({ responses: [{ text: JSON.stringify(payload) }] })
  const result = await callTool(harness, { rough: 'add a dark mode toggle to settings', language: 'en' })
  assert.match(result.prompt, /^# Dark mode toggle\n\n## Role/)
  assert.match(result.prompt, /## Acceptance criteria/)
  assert.match(result.translation, /^# 深色模式开关\n\n## 角色/)
  assert.match(result.translation, /## 验收标准/)
})

test('host: truncation is a failure and is not retried', async () => {
  const harness = createHarness({ responses: [{ text: '{"analysis":{}', truncate: true }] })
  await assertRejectsCode(callTool(harness, { rough: '生成一个很长很长的需求' }), 'E_TRUNCATED')
  assert.equal(harness.calls.length, 1)
})

test('host: invalid JSON triggers exactly one repair round', async () => {
  const harness = createHarness({
    responses: [{ text: 'not json at all' }, { text: JSON.stringify(validPayload()) }]
  })
  const result = await callTool(harness, { rough: '补全这个需求' })
  assert.equal(harness.calls.length, 2)
  const repairText = harness.calls[1].messages[0].content[0].text
  assert.match(repairText, /校验未通过/)
  assert.match(result.prompt, /## 角色/)
})

test('host: a second invalid answer fails with E_INVALID', async () => {
  const harness = createHarness({ responses: [{ text: 'no json' }, { text: 'still no json' }] })
  await assertRejectsCode(callTool(harness, { rough: '补全这个需求' }), 'E_INVALID')
  assert.equal(harness.calls.length, 2)
})

test('host: validation errors are fed back in the repair round', async () => {
  const invalid = validPayload()
  invalid.analysis.gaps = ['这不是一个问句'] // must end with ？ or ?
  const harness = createHarness({
    responses: [{ text: JSON.stringify(invalid) }, { text: JSON.stringify(validPayload()) }]
  })
  const result = await callTool(harness, { rough: '补全这个需求' })
  assert.equal(harness.calls.length, 2)
  const repairText = harness.calls[1].messages[0].content[0].text
  assert.match(repairText, /analysis\.gaps/)
  assert.match(result.prompt, /## 待补充|## 角色/)
})

test('host: fenced JSON is accepted without a repair round', async () => {
  const text = '```json\n' + JSON.stringify(validPayload()) + '\n```'
  const harness = createHarness({ responses: [{ text }] })
  const result = await callTool(harness, { rough: '整理需求' })
  assert.equal(harness.calls.length, 1)
  assert.match(result.prompt, /^# 设置页深色模式开关/)
})

test('host: confirmation answers are sent to the model as clarification context', async () => {
  const harness = createHarness({ responses: [{ text: JSON.stringify(validPayload()) }] })
  const result = await callTool(harness, {
    rough: '给设置页加深色模式开关',
    clarifications: [
      { question: '是否需要跟随系统？', answer: '需要，默认跟随系统' },
      { question: '是否持久化？', answer: '需要，刷新后保持' }
    ]
  })
  assert.equal(harness.calls.length, 1)
  const userText = harness.calls[0].messages[0].content[0].text
  assert.match(userText, /用户已确认的澄清/)
  assert.match(userText, /是否需要跟随系统/)
  assert.match(userText, /默认跟随系统/)
  assert.match(result.prompt, /## 角色/)
  assert.equal(getTool(harness).parameters.properties.clarifications.type, 'array')
})

test('host: continuation passes the previous prompt and feedback to the model', async () => {
  const harness = createHarness({ responses: [{ text: JSON.stringify(validPayload()) }] })
  const result = await callTool(harness, {
    rough: '给设置页加深色模式开关',
    previousPrompt: '# 旧版 Prompt\n\n## 角色\n工程师',
    revisionNote: '把验收标准写得更严格，补上失败处理'
  })
  assert.equal(result.meta.revision, true)
  const userText = harness.calls[0].messages[0].content[0].text
  assert.match(userText, /上一版 Prompt/)
  assert.match(userText, /旧版 Prompt/)
  assert.match(userText, /把验收标准写得更严格/)
  assert.match(userText, /这是续写/)
})

test('host: malformed clarification entries are dropped without failing', async () => {
  const harness = createHarness({ responses: [{ text: JSON.stringify(validPayload()) }] })
  await callTool(harness, {
    rough: '整理需求',
    clarifications: [null, { question: '', answer: 'x' }, { question: '有效问题？', answer: '有效答案' }, { question: '有效问题？', answer: '重复答案' }]
  })
  const userText = harness.calls[0].messages[0].content[0].text
  assert.match(userText, /有效问题/)
  assert.equal((userText.match(/有效问题/g) || []).length, 1)
})

test('host: gapChoices must align with gaps', async () => {
  const invalid = validPayload()
  invalid.analysis.gaps = ['问题一？', '问题二？']
  invalid.analysis.gapChoices = [['是']]
  const harness = createHarness({
    responses: [{ text: JSON.stringify(invalid) }, { text: JSON.stringify(invalid) }]
  })
  await assertRejectsCode(callTool(harness, { rough: '整理需求' }), 'E_INVALID')
  assert.equal(harness.calls.length, 2)
})

test('host: empty and oversized input fail before any model call', async () => {
  const emptyHarness = createHarness({ responses: [{ text: JSON.stringify(validPayload()) }] })
  await assertRejectsCode(callTool(emptyHarness, { rough: '' }), 'E_EMPTY')
  assert.equal(emptyHarness.calls.length, 0)

  const longHarness = createHarness({ responses: [{ text: JSON.stringify(validPayload()) }] })
  await assertRejectsCode(callTool(longHarness, { rough: 'x'.repeat(8001) }), 'E_TOO_LONG')
  assert.equal(longHarness.calls.length, 0)
})

test('host: missing llm service fails with E_NO_LLM', async () => {
  const harness = createHarness({ withLlm: false })
  await assertRejectsCode(callTool(harness, { rough: '整理需求' }), 'E_NO_LLM')
})

test('host: command returns the ok/data envelope through the command result text', async () => {
  const harness = createHarness({ responses: [{ text: JSON.stringify(validPayload()) }] })
  const { command, body } = await callCommand(harness, {
    rough: '给设置页加深色模式',
    mode: 'agent',
    detail: 'standard',
    language: 'auto'
  })
  assert.equal(command.recordInput, false)
  assert.equal(body.ok, true)
  assert.match(body.data.prompt, /## 角色/)
  assert.equal(body.data.meta.source, 'model')
  assert.equal(body.data.meta.provider, 'test-provider')
})

test('host: tool render exposes the assembled prompt and analysis', async () => {
  const harness = createHarness({ responses: [{ text: JSON.stringify(validPayload()) }] })
  const result = await callTool(harness, { rough: '整理需求' })
  const tool = getTool(harness)
  const blocks = tool.output.render({}, result)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'text')
  assert.match(blocks[0].text, /^# 设置页深色模式开关/)
  assert.match(blocks[0].text, /## Prompt/)
  assert.match(blocks[0].text, /## Translation/)
})
