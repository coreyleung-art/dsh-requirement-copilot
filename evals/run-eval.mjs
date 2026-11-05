#!/usr/bin/env node
/**
 * Offline/live evaluation runner for the requirement-prompt pipeline.
 *
 *   node evals/run-eval.mjs                 # validate the corpus only (no model calls)
 *   node evals/run-eval.mjs --live          # call an OpenAI-compatible endpoint per case
 *
 * Live mode reads EVAL_BASE_URL, EVAL_MODEL and (optionally) EVAL_API_KEY from
 * the environment. Secrets are never written to the repository.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { apply } from '../index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const casesPath = path.join(here, 'cases.json')
const live = process.argv.includes('--live')
const outIndex = process.argv.indexOf('--out')
const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : ''

const MODES = new Set(['agent', 'spec'])
const DETAILS = new Set(['concise', 'standard', 'detailed'])
const LANGUAGES = new Set(['auto', 'zh', 'en'])
const TARGETS = new Set(['generic', 'claude-code', 'codex', 'cursor'])

function fail(message) {
  console.error('[eval] ' + message)
  process.exit(1)
}

function readCases() {
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(casesPath, 'utf8'))
  } catch (error) {
    fail('cannot read cases.json: ' + (error instanceof Error ? error.message : String(error)))
  }
  if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.cases) || parsed.cases.length === 0) {
    fail('cases.json must contain a non-empty "cases" array')
  }
  const ids = new Set()
  const cases = parsed.cases.map((raw, index) => {
    if (raw === null || typeof raw !== 'object') fail('case #' + index + ' is not an object')
    const id = typeof raw.id === 'string' ? raw.id.trim() : ''
    if (id === '') fail('case #' + index + ' is missing id')
    if (ids.has(id)) fail('duplicate case id: ' + id)
    ids.add(id)
    if (typeof raw.rough !== 'string' || raw.rough.trim().length < 2) fail(id + ': rough is too short')
    if (raw.rough.length > 8000) fail(id + ': rough exceeds 8000 characters')
    if (!MODES.has(raw.mode)) fail(id + ': invalid mode')
    if (!DETAILS.has(raw.detail)) fail(id + ': invalid detail')
    if (!LANGUAGES.has(raw.language)) fail(id + ': invalid language')
    if (!TARGETS.has(raw.target)) fail(id + ': invalid target')
    if (!Array.isArray(raw.mustInclude) || raw.mustInclude.length === 0 || raw.mustInclude.some((item) => typeof item !== 'string' || item.trim() === '')) {
      fail(id + ': mustInclude must be a non-empty string array')
    }
    if (typeof raw.category !== 'string' || raw.category.trim() === '') fail(id + ': category is required')
    return {
      id,
      category: raw.category,
      rough: raw.rough,
      mode: raw.mode,
      detail: raw.detail,
      language: raw.language,
      target: raw.target,
      mustInclude: raw.mustInclude
    }
  })
  return cases
}

function normalize(text) {
  return String(text === undefined || text === null ? '' : text)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function scoreCase(def, result) {
  const prompt = typeof result.prompt === 'string' ? result.prompt : ''
  const haystack = normalize(prompt)
  const keywordHits = def.mustInclude.filter((keyword) => haystack.includes(normalize(keyword)))
  const keywordCoverage = def.mustInclude.length === 0 ? 1 : keywordHits.length / def.mustInclude.length
  const headingCount = (prompt.match(/^## /gm) || []).length
  const gapsOk = Array.isArray(result.analysis && result.analysis.gaps)
    && result.analysis.gaps.every((gap) => /[?？]$/.test(String(gap)))
  const bilingual = typeof result.translation === 'string' && result.translation.trim() !== ''
  const targetOk = def.target === 'generic' || prompt.includes('> Target:') || prompt.includes('> 目标环境：')
  const sourceOk = result.meta !== null && typeof result.meta === 'object' && result.meta.source === 'model'
  const pass = keywordCoverage >= 0.8 && headingCount >= 3 && gapsOk && bilingual && targetOk && sourceOk
  return {
    pass,
    keywordHits,
    keywordCoverage,
    headingCount,
    gapsOk,
    bilingual,
    targetOk,
    sourceOk,
    promptChars: prompt.length
  }
}

function createHttpStream({ baseUrl, model, apiKey }) {
  const endpoint = baseUrl.replace(/\/+$/, '') + '/chat/completions'
  return async function* stream(options) {
    const messages = []
    if (typeof options.system === 'string' && options.system !== '') {
      messages.push({ role: 'system', content: options.system })
    }
    for (const message of Array.isArray(options.messages) ? options.messages : []) {
      const content = Array.isArray(message.content)
        ? message.content.map((part) => (part !== null && typeof part === 'object' && typeof part.text === 'string' ? part.text : '')).join('')
        : String(message.content === undefined || message.content === null ? '' : message.content)
      messages.push({ role: typeof message.role === 'string' ? message.role : 'user', content })
    }
    const headers = { 'content-type': 'application/json' }
    if (apiKey !== '') headers.authorization = 'Bearer ' + apiKey
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.maxTokens,
        temperature: 0.2,
        stream: false
      }),
      signal: options.signal
    })
    if (!response.ok) {
      const body = await response.text()
      throw new Error('HTTP ' + String(response.status) + ': ' + body.slice(0, 300))
    }
    const payload = await response.json()
    const content = payload !== null && typeof payload === 'object'
      && Array.isArray(payload.choices) && payload.choices[0] !== null && typeof payload.choices[0] === 'object'
      && payload.choices[0].message !== null && typeof payload.choices[0].message === 'object'
      ? payload.choices[0].message.content
      : undefined
    if (typeof content !== 'string' || content.trim() === '') throw new Error('endpoint returned empty content')
    yield { type: 'text-delta', text: content }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function createHarness(stream, model) {
  const toolDefs = []
  const skillDefs = []
  const ctx = {
    effect(fn) {
      const disposer = fn()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    get(name) {
      if (name === 'llm') return { stream }
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'eval', model }) }
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
      register() {
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
  const tool = toolDefs.find((definition) => definition.name === 'refine_requirement')
  if (tool === undefined) fail('refine_requirement tool was not registered')
  return tool
}

async function main() {
  const cases = readCases()
  const categories = [...new Set(cases.map((item) => item.category))]
  console.log('[eval] corpus v' + String(1) + ': ' + String(cases.length) + ' cases, ' + String(categories.length) + ' categories')
  console.log('[eval] categories: ' + categories.join(', '))

  if (!live) {
    console.log('[eval] dry run: corpus is valid; no model call was made.')
    console.log('[eval] run with --live and EVAL_BASE_URL/EVAL_MODEL/EVAL_API_KEY to build a baseline.')
    return
  }

  const baseUrl = (process.env.EVAL_BASE_URL || '').trim()
  const model = (process.env.EVAL_MODEL || '').trim()
  const apiKey = (process.env.EVAL_API_KEY || '').trim()
  if (baseUrl === '') fail('EVAL_BASE_URL is required in --live mode')
  if (model === '') fail('EVAL_MODEL is required in --live mode')

  const tool = createHarness(createHttpStream({ baseUrl, model, apiKey }), model)
  const results = []
  for (const def of cases) {
    const startedAt = Date.now()
    let result
    let errorCode = ''
    let errorMessage = ''
    try {
      result = await tool.execute({
        rough: def.rough,
        mode: def.mode,
        detail: def.detail,
        language: def.language,
        target: def.target
      }, { signal: new AbortController().signal })
    } catch (error) {
      errorCode = error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : 'E_UNKNOWN'
      errorMessage = error instanceof Error ? error.message : String(error)
    }
    const elapsedMs = Date.now() - startedAt
    const score = result === undefined
      ? { pass: false, keywordHits: [], keywordCoverage: 0, headingCount: 0, gapsOk: false, bilingual: false, targetOk: false, sourceOk: false, promptChars: 0 }
      : scoreCase(def, result)
    results.push({
      id: def.id,
      category: def.category,
      target: def.target,
      mode: def.mode,
      pass: score.pass,
      keywordHits: score.keywordHits,
      keywordCoverage: score.keywordCoverage,
      promptChars: score.promptChars,
      elapsedMs,
      errorCode,
      errorMessage: errorMessage.slice(0, 300)
    })
    console.log(
      '[eval] ' + (score.pass ? 'PASS' : 'FAIL') + ' ' + def.id
      + ' keywords=' + String(score.keywordHits.length) + '/' + String(def.mustInclude.length)
      + (errorCode === '' ? '' : ' error=' + errorCode)
    )
  }

  const passed = results.filter((item) => item.pass).length
  const coverage = results.length === 0
    ? 0
    : results.reduce((sum, item) => sum + item.keywordCoverage, 0) / results.length
  console.log('[eval] result: ' + String(passed) + '/' + String(results.length) + ' passed; avg keyword coverage=' + coverage.toFixed(2))
  console.log('[eval] review the qualitative rubric in evals/rubric.md; structural pass is not a quality guarantee.')

  if (outPath !== '') {
    const report = {
      generatedAt: new Date().toISOString(),
      model,
      total: results.length,
      passed,
      averageKeywordCoverage: Number(coverage.toFixed(4)),
      results
    }
    fs.writeFileSync(path.resolve(outPath), JSON.stringify(report, null, 2) + '\n', 'utf8')
    console.log('[eval] wrote ' + path.resolve(outPath))
  }

  if (passed !== results.length) process.exitCode = 1
}

main().catch((error) => {
  console.error('[eval] fatal: ' + (error instanceof Error ? error.message : String(error)))
  process.exit(1)
})
