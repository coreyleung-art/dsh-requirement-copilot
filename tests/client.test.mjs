import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8')

function createReactStub() {
  return {
    Fragment: 'Fragment',
    createElement: () => null,
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useRef: (initial) => ({ current: initial }),
    useCallback: (callback) => callback,
    memo: (component) => component
  }
}

function loadClientModule() {
  let entry
  const storage = new Map()
  const window = {
    __ModuleLoader__: {
      load(value) {
        entry = value
      }
    },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key)
    }
  }
  const document = { addEventListener() {}, removeEventListener() {} }
  const navigator = { clipboard: undefined }
  const run = new Function('window', 'document', 'navigator', 'console', source)
  run(window, document, navigator, { log() {}, error() {} })

  assert.ok(entry !== undefined, 'client bundle should call window.__ModuleLoader__.load')
  assert.equal(entry.id, 'dsh-requirement-copilot')
  assert.equal(typeof entry.factory, 'function')

  const required = []
  const react = createReactStub()
  const moduleExports = entry.factory((name) => {
    required.push(name)
    if (name === 'react') return react
    throw new Error('unexpected module request: ' + name)
  })
  return { entry, moduleExports, required, window }
}

function createClientContext(remote) {
  const registrations = []
  const locales = []
  const ctx = {
    get(name) {
      if (name === 'remote') return remote
      if (name === 'remote.commands') return remote === undefined ? undefined : remote.commands
      return undefined
    },
    effect(fn) {
      const disposer = fn()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    locale: {
      register(namespace, dicts) {
        locales.push({ namespace, dicts })
        return () => {}
      }
    },
    slots: {
      inject(_owner, register) {
        register()
        return () => {}
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      }
    }
  }
  return { ctx, registrations, locales }
}

function registrationNamed(registrations, name) {
  return registrations.find((entry) => entry.options.name === name)
}

function createRetryRemote() {
  const argCounts = []
  return {
    argCounts,
    commands: {
      async execute(...args) {
        argCounts.push(args.length)
        if (argCounts.length === 1) throw new Error('expected 3 argument(s), got 4')
        return { ok: true, value: { result: { kind: 'success', text: '{"ok":true,"data":{"prompt":"P"}}' } } }
      },
      async list() {
        return { ok: true, value: [1, 2] }
      }
    }
  }
}

test('client: bundle contract, locale parity and slot registrations', () => {
  const { entry, moduleExports, required } = loadClientModule()
  assert.equal(entry.id, 'dsh-requirement-copilot')
  assert.deepEqual(moduleExports.inject, ['slots', 'locale'])
  assert.equal(typeof moduleExports.apply, 'function')
  assert.deepEqual(required, ['react'], 'the client bundle must only require react')

  const remote = createRetryRemote()
  const { ctx, registrations, locales } = createClientContext(remote)
  moduleExports.apply(ctx)

  assert.equal(locales.length, 1)
  assert.equal(locales[0].namespace, 'reqcopilot')
  const zhKeys = Object.keys(locales[0].dicts.zh).sort()
  const enKeys = Object.keys(locales[0].dicts.en).sort()
  assert.deepEqual(zhKeys, enKeys, 'zh/en locale keys must stay aligned')
  for (const key of ['action.restore', 'status.alreadyInserted', 'field.label', 'status.restored', 'status.applied', 'status.draftChanged', 'option.target', 'option.target.claude-code', 'option.target.codex', 'option.target.cursor', 'gate.title', 'gate.apply', 'gate.skip', 'gate.pendingApply', 'gate.choices', 'gate.supplement', 'gate.prev', 'gate.next', 'gate.skipOne', 'aria.drag', 'option.scenario', 'option.scenario.coding', 'quality.title', 'quality.check.structure', 'history.title', 'history.load', 'history.clear', 'revision.open', 'revision.apply', 'revision.cancel', 'diff.title', 'diff.compare', 'diff.previous']) {
    assert.ok(zhKeys.includes(key), 'missing zh locale key: ' + key)
    assert.ok(enKeys.includes(key), 'missing en locale key: ' + key)
  }
  assert.equal(locales[0].dicts.zh['trigger.title'], '帮我说')
  assert.equal(locales[0].dicts.zh['panel.title'], '帮我说')
  assert.equal(locales[0].dicts.en['trigger.title'], 'Say It For Me')
  assert.equal(locales[0].dicts.en['panel.title'], 'Say It For Me')
  const zhMeta = JSON.parse(fs.readFileSync(path.join(here, '..', 'locale', 'zh.json'), 'utf8'))
  const enMeta = JSON.parse(fs.readFileSync(path.join(here, '..', 'locale', 'en.json'), 'utf8'))
  assert.equal(zhMeta.meta.title, '帮我说')
  assert.equal(enMeta.meta.title, 'Say It For Me')

  assert.equal(registrations.length, 3)
  const trigger = registrationNamed(registrations, 'conversation.input.right')
  assert.ok(trigger, 'trigger registration missing')
  assert.equal(trigger.options.id, 'requirement-copilot-trigger')
  assert.equal(typeof trigger.component, 'function')

  const panel = registrationNamed(registrations, 'conversation.input.overlay')
  assert.ok(panel, 'panel registration missing')
  assert.equal(panel.options.id, 'requirement-copilot-panel')
  assert.equal(typeof panel.component, 'function')
  assert.equal(typeof panel.options.inject, 'function')
  const injected = panel.options.inject()
  assert.equal(typeof injected.executeCommand, 'function')

  const commandRow = registrationNamed(registrations, 'conversation.chat.commandview')
  assert.ok(commandRow, 'command row registration missing')
  assert.equal(commandRow.options.key, 'refine-prompt')
  assert.equal(typeof commandRow.component, 'function')
  assert.equal(commandRow.component(), null, 'the command row must render nothing')
})

test('client: command resolver retries the three-argument form after an arity error', async () => {
  const { moduleExports } = loadClientModule()
  const remote = createRetryRemote()
  const { ctx, registrations } = createClientContext(remote)
  moduleExports.apply(ctx)
  const panel = registrationNamed(registrations, 'conversation.input.overlay')
  const { executeCommand } = panel.options.inject()

  const execution = await executeCommand('session-1', '/refine-prompt {}', new AbortController().signal)
  assert.deepEqual(remote.argCounts, [4, 3])
  assert.equal(execution.result.kind, 'success')
  assert.equal(execution.result.text, '{"ok":true,"data":{"prompt":"P"}}')
})

test('client: resolver failure includes the remote error and the probe result', async () => {
  const { moduleExports } = loadClientModule()
  const remote = {
    commands: {
      async execute() {
        throw new Error('remote-access/denied: no-allow')
      },
      async list() {
        throw new Error('list boom')
      }
    }
  }
  const { ctx, registrations } = createClientContext(remote)
  moduleExports.apply(ctx)
  const panel = registrationNamed(registrations, 'conversation.input.overlay')
  const { executeCommand } = panel.options.inject()

  await assert.rejects(
    executeCommand('session-1', '/refine-prompt {}', new AbortController().signal),
    (error) => {
      assert.match(error.message, /remote-access\/denied: no-allow/)
      assert.match(error.message, /list failed: list boom/)
      return true
    }
  )
})

test('client: ok:false envelope becomes the thrown message, probe reports the catalog size', async () => {
  const { moduleExports } = loadClientModule()
  const remote = {
    commands: {
      async execute() {
        return { ok: false, error: { code: 'denied', message: 'nope' } }
      },
      async list() {
        return { ok: true, value: [] }
      }
    }
  }
  const { ctx, registrations } = createClientContext(remote)
  moduleExports.apply(ctx)
  const panel = registrationNamed(registrations, 'conversation.input.overlay')
  const { executeCommand } = panel.options.inject()

  await assert.rejects(
    executeCommand('session-1', '/refine-prompt {}', new AbortController().signal),
    (error) => {
      assert.match(error.message, /nope/)
      assert.match(error.message, /\[list=0\]/)
      return true
    }
  )
})

test('client: a missing commands namespace is reported clearly', async () => {
  const { moduleExports } = loadClientModule()
  const { ctx, registrations } = createClientContext(undefined)
  moduleExports.apply(ctx)
  const panel = registrationNamed(registrations, 'conversation.input.overlay')
  const { executeCommand } = panel.options.inject()

  await assert.rejects(
    executeCommand('session-1', '/refine-prompt {}', new AbortController().signal),
    /commands Remote namespace unresolved/
  )
})

test('client: static guardrails (no harness packages, theme tokens only, a11y hooks present)', () => {
  assert.ok(!source.includes('@deepseek-ai/'), 'client must not import Harness client packages')
  assert.ok(source.includes("require('react')"))

  const cssStart = source.indexOf('const CSS = [')
  assert.ok(cssStart >= 0)
  const cssEnd = source.indexOf("].join('')", cssStart)
  const css = source.slice(cssStart, cssEnd)
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.exec(css), null, 'CSS must not hardcode colors')

  assert.ok(source.includes('aria-live'), 'status/error regions should announce changes')
  assert.ok(source.includes('maxLength'), 'the requirement textarea should cap input length')
  assert.ok(source.includes('aria-label'), 'the requirement textarea should have an accessible name')
})
