/**
 * Say It For Me (帮我说) — Client half.
 *
 * Registers two composer seats:
 *  - `conversation.input.right`: the compact ✨ trigger beside the send area;
 *  - `conversation.input.overlay`: the floating panel, anchored to the top edge
 *    of the composer card and only visible while open.
 *
 * The panel collects a rough requirement, dispatches the Host `refine-prompt`
 * command through the mounted `commands` Remote, renders the analysis / prompt /
 * translation, and writes the result back into the resident composer through the
 * documented `InputActions` face:
 *
 *   captureInsertion() -> insertText(text, span)   // undoable insertion
 *   setDraft(text)                                 // whole-draft replace
 *
 * It also registers an empty renderer for the command's transcript row
 * (`conversation.chat.commandview` keyed by the command name) so a generation
 * never leaves a command card in the visible Chat flow.
 */

window.__ModuleLoader__.load({
  id: 'dsh-requirement-copilot',
  factory(require) {
    'use strict'

    const React = require('react')
    const h = React.createElement

    const NS = 'reqcopilot'
    const COMMAND_NAME = 'refine-prompt'
    const BACKGROUND_START_COMMAND = 'refine-prompt-start'
    const BACKGROUND_STATUS_COMMAND = 'refine-prompt-status'
    const BACKGROUND_CANCEL_COMMAND = 'refine-prompt-cancel'
    const JOB_KEY_PREFIX = 'rcp-job:'
    const MAX_INPUT_CHARS = 8000

    /**
     * Last-resort diagnostics. The panel already surfaces failures inline; this
     * also leaves a durable record in browser storage so a failure can be read
     * back from outside the page without devtools.
     */
    function writeDiagnostic(payload) {
      try {
        if (typeof window === 'undefined' || window.localStorage === undefined) return
        const record = Object.assign({ at: new Date().toISOString() }, payload)
        window.localStorage.setItem('rcp-diagnostic-last', JSON.stringify(record).slice(0, 4000))
        let history = []
        try {
          const raw = window.localStorage.getItem('rcp-diagnostic-history')
          const parsed = raw === null ? [] : JSON.parse(raw)
          if (Array.isArray(parsed)) history = parsed
        } catch {
          history = []
        }
        history.push(record)
        window.localStorage.setItem('rcp-diagnostic-history', JSON.stringify(history.slice(-10)).slice(0, 24000))
      } catch {
        // Diagnostics must never break the feature.
      }
    }

    // --------------------------------------------------------------- history

    const HISTORY_LIMIT = 10
    const HISTORY_MAX_CHARS = 160000

    function historyKeyFor(sessionId) {
      const key = typeof sessionId === 'string' && sessionId !== '' ? sessionId : 'default'
      return 'rcp-history:' + key
    }

    function readHistory(sessionId) {
      try {
        if (typeof window === 'undefined' || window.localStorage === undefined) return []
        const raw = window.localStorage.getItem(historyKeyFor(sessionId))
        const parsed = raw === null ? [] : JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.filter((entry) => entry !== null && typeof entry === 'object') : []
      } catch {
        return []
      }
    }

    function writeHistory(sessionId, entries) {
      try {
        if (typeof window === 'undefined' || window.localStorage === undefined) return
        let kept = Array.isArray(entries) ? entries.slice(0, HISTORY_LIMIT) : []
        let text = JSON.stringify(kept)
        while (kept.length > 1 && text.length > HISTORY_MAX_CHARS) {
          kept = kept.slice(0, kept.length - 1)
          text = JSON.stringify(kept)
        }
        window.localStorage.setItem(historyKeyFor(sessionId), text)
      } catch {
        // Storage can be full or disabled; history is optional.
      }
    }

    function historyTime(value) {
      try {
        const date = new Date(value)
        if (Number.isNaN(date.getTime())) return ''
        return date.toLocaleTimeString()
      } catch {
        return ''
      }
    }

    // ------------------------------------------------------- background jobs

    function jobKeyFor(sessionId) {
      const key = typeof sessionId === 'string' && sessionId !== '' ? sessionId : 'default'
      return JOB_KEY_PREFIX + key
    }

    function readJobRecord(sessionId) {
      try {
        if (typeof window === 'undefined' || window.localStorage === undefined) return null
        const raw = window.localStorage.getItem(jobKeyFor(sessionId))
        if (raw === null) return null
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object' || typeof parsed.jobId !== 'string' || parsed.jobId === '') return null
        return parsed
      } catch {
        return null
      }
    }

    function writeJobRecord(sessionId, record) {
      try {
        if (typeof window === 'undefined' || window.localStorage === undefined) return
        window.localStorage.setItem(jobKeyFor(sessionId), JSON.stringify(record).slice(0, 8000))
      } catch {
        // Job persistence is best-effort.
      }
    }

    function clearJobRecord(sessionId) {
      try {
        if (typeof window === 'undefined' || window.localStorage === undefined) return
        window.localStorage.removeItem(jobKeyFor(sessionId))
      } catch {
        // ignore
      }
    }

    function commandEnvelope(execution) {
      if (execution === undefined || execution === null || execution.result === undefined || execution.result === null) return null
      if (execution.result.kind !== 'success' || typeof execution.result.text !== 'string') return null
      try {
        const value = JSON.parse(execution.result.text)
        return value !== null && typeof value === 'object' ? value : null
      } catch {
        return null
      }
    }

    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms))
    }

    // ---------------------------------------------------------------- locale

    const ZH = {
      'trigger.title': '帮我说',
      'trigger.hint': '把零散描述整理成可直接执行的 Prompt',
      'panel.title': '帮我说',
      'panel.subtitle': '收集 · 分析 · 补全 · 翻译成给智能体执行的 Prompt',
      'panel.close': '收起',
      'field.placeholder': '把零散的想法、口头需求、聊天记录粘进来……\n不完整也没关系：我会补全缺失信息、标注假设，并给出可直接执行的 Prompt。',
      'field.gather': '读取输入框',
      'field.clear': '清空',
      'field.emptyDraft': '输入框当前没有内容',
      'field.chars': '字',
      'field.label': '需求描述',
      'option.mode': '用途',
      'option.mode.agent': '交给 Agent',
      'option.mode.spec': '需求规格',
      'option.detail': '详略',
      'option.detail.concise': '精简',
      'option.detail.standard': '标准',
      'option.detail.detailed': '详尽',
      'option.language': '语言',
      'option.language.auto': '跟随输入',
      'option.language.zh': '中文',
      'option.language.en': 'English',
      'option.target': '目标',
      'option.target.generic': '通用',
      'option.target.claude-code': 'Claude Code',
      'option.target.codex': 'Codex',
      'option.target.cursor': 'Cursor',
      'option.scenario': '场景',
      'option.scenario.general': '通用',
      'option.scenario.coding': '编码',
      'option.scenario.writing': '写作',
      'option.scenario.research': '调研',
      'option.scenario.data': '数据',
      'option.scenario.automation': '自动化',
      'action.generate': '生成 Prompt',
      'action.cancel': '停止',
      'action.regenerate': '重新生成',
      'action.copy': '复制',
      'action.insert': '插入到输入框',
      'action.replace': '替换输入框',
      'action.confirmReplace': '确认覆盖当前草稿？',
      'action.confirmYes': '确认覆盖',
      'action.confirmNo': '取消',
      'action.restore': '恢复原草稿',
      'tab.analysis': '解析',
      'tab.prompt': 'Prompt',
      'tab.translation': '译文',
      'section.deliverables': '交付物',
      'section.constraints': '约束',
      'section.assumptions': '假设',
      'section.gaps': '待补充',
      'status.generating': '正在生成…',
      'status.model': '模型',
      'status.local': '本地模板（未调用模型）',
      'status.applied': '已整理并写回输入框',
      'status.restored': '已恢复原草稿',
      'status.draftChanged': '已生成；输入框内容已变化，未自动覆盖',
      'status.alreadyInserted': '输入框中已经是这段内容',
      'status.busy': '后台已有 2 个生成任务，请稍候再试。',
      'status.backgroundReady': '生成完成；会话已切换，结果已保留，未自动写回。',
      'gate.title': '开工前确认',
      'gate.subtitle': '一次只问一题。点选候选答案，或补充说明；也可以跳过。',
      'gate.choices': '候选答案',
      'gate.supplement': '补充说明（可选）',
      'gate.supplementPlaceholder': '补充你的答案、边界或约束；可留空',
      'gate.prev': '上一题',
      'gate.next': '下一题',
      'gate.skipOne': '跳过本题',
      'gate.answerPlaceholder': '补充说明（可选）',
      'gate.apply': '用回答重新生成',
      'gate.skip': '跳过，直接使用当前结果',
      'gate.needOne': '请至少回答一个问题，或选择跳过。',
      'gate.pendingApply': '有未确认的问题；回答或跳过之后才会写回输入框。',
      'gate.why': '回答会作为澄清上下文使用，不会覆盖原始描述。',
      'quality.title': '质量自检',
      'quality.note': '结构自检，不调用模型',
      'quality.ready': '可交付',
      'quality.usable': '可用，建议补强',
      'quality.needsWork': '建议先补强',
      'quality.check.structure': '结构完整',
      'quality.check.requirements': '需求条目',
      'quality.check.acceptance': '验收标准',
      'quality.check.constraints': '约束/上下文',
      'quality.check.gaps': '无待确认问题',
      'quality.check.translation': '中英对齐',
      'quality.check.target': '目标环境',
      'revision.open': '继续优化',
      'revision.title': '继续优化（基于当前版本）',
      'revision.placeholder': '补充下一句或修改要求，例如：验收标准再严格一点，补上失败处理',
      'revision.apply': '应用修改',
      'revision.cancel': '取消',
      'revision.needNote': '请先写一句要修改或补充的内容。',
      'revision.limit': '已达到 5 轮续写上限；可重新生成或手动修改。',
      'diff.title': '版本对比',
      'diff.compare': '对比',
      'diff.previous': '对比上一版',
      'diff.close': '关闭对比',
      'diff.empty': '两个版本内容相同',
      'aria.drag': '拖动标题栏移动面板；双击恢复默认位置',
      'history.title': '历史版本',
      'history.note': '保存在本机浏览器，最多 10 版',
      'history.clear': '清空',
      'history.load': '载入',
      'history.loaded': '已载入历史版本',
      'history.empty': '暂无历史',
      'status.inserted': '已插入输入框',
      'status.replaced': '已替换输入框草稿',
      'status.blocked': '输入框当前不可写入（可能正在发送），请稍后重试',
      'status.copied': '已复制',
      'status.copyFailed': '复制失败，请手动选择文本复制',
      'hint.panel': '生成结果只写到输入框，不会自动发送。',
      'err.empty': '请先填写需求描述（至少 2 个字符）。',
      'err.tooLong': '描述过长（上限 8000 字符），请分段处理。',
      'err.remote': '当前页面没有可用的命令通道，请刷新页面后重试。',
      'err.fallback': '模型调用未成功，已改用本地模板生成。',
      'err.badPayload': '生成结果无法解析，请重试。',
      'aria.expand': '展开帮我说',
      'aria.collapse': '收起帮我说',
    }

    const EN = {
      'trigger.title': 'Say It For Me',
      'trigger.hint': 'Turn rough notes into an agent-ready prompt',
      'panel.title': 'Say It For Me',
      'panel.subtitle': 'Collect · analyze · complete · translate your request into an agent-ready prompt',
      'panel.close': 'Collapse',
      'field.placeholder': 'Paste scattered notes, spoken requests, or chat logs…\nIncomplete is fine: I fill the gaps, mark assumptions, and produce an executable prompt.',
      'field.gather': 'Read composer',
      'field.clear': 'Clear',
      'field.emptyDraft': 'The composer is empty',
      'field.chars': 'chars',
      'field.label': 'Requirement description',
      'option.mode': 'Purpose',
      'option.mode.agent': 'Agent task',
      'option.mode.spec': 'Spec',
      'option.detail': 'Detail',
      'option.detail.concise': 'Short',
      'option.detail.standard': 'Standard',
      'option.detail.detailed': 'Full',
      'option.language': 'Language',
      'option.language.auto': 'Auto',
      'option.language.zh': '中文',
      'option.language.en': 'English',
      'option.target': 'Target',
      'option.target.generic': 'Generic',
      'option.target.claude-code': 'Claude Code',
      'option.target.codex': 'Codex',
      'option.target.cursor': 'Cursor',
      'option.scenario': 'Scenario',
      'option.scenario.general': 'General',
      'option.scenario.coding': 'Coding',
      'option.scenario.writing': 'Writing',
      'option.scenario.research': 'Research',
      'option.scenario.data': 'Data',
      'option.scenario.automation': 'Automation',
      'action.generate': 'Generate prompt',
      'action.cancel': 'Stop',
      'action.regenerate': 'Regenerate',
      'action.copy': 'Copy',
      'action.insert': 'Insert into composer',
      'action.replace': 'Replace composer',
      'action.confirmReplace': 'Replace the current draft?',
      'action.confirmYes': 'Replace',
      'action.confirmNo': 'Cancel',
      'action.restore': 'Restore original draft',
      'tab.analysis': 'Analysis',
      'tab.prompt': 'Prompt',
      'tab.translation': 'Translation',
      'section.deliverables': 'Deliverables',
      'section.constraints': 'Constraints',
      'section.assumptions': 'Assumptions',
      'section.gaps': 'Missing details',
      'status.generating': 'Generating…',
      'status.model': 'Model',
      'status.local': 'Local template (model not called)',
      'status.applied': 'Organized and written back to the composer',
      'status.restored': 'Original draft restored',
      'status.draftChanged': 'Generated, but the composer changed, so it was not overwritten',
      'status.alreadyInserted': 'The composer already contains this text',
      'status.busy': 'Two background generations are already running; try again shortly.',
      'status.backgroundReady': 'Generation finished after you switched sessions; the result was kept and not written back automatically.',
      'gate.title': 'Confirm before you start',
      'gate.subtitle': 'One question at a time. Pick a suggested answer, add a note, or skip.',
      'gate.choices': 'Suggestions',
      'gate.supplement': 'Additional note (optional)',
      'gate.supplementPlaceholder': 'Add context, boundaries or constraints; optional',
      'gate.prev': 'Previous',
      'gate.next': 'Next',
      'gate.skipOne': 'Skip this question',
      'gate.answerPlaceholder': 'Additional note (optional)',
      'gate.apply': 'Regenerate with answers',
      'gate.skip': 'Skip and use the current result',
      'gate.needOne': 'Answer at least one question, or choose skip.',
      'gate.pendingApply': 'There are unanswered questions; the composer will be updated only after you answer or skip them.',
      'gate.why': 'Answers are used as clarification context; your original description is preserved.',
      'aria.drag': 'Drag the title bar to move this panel; double-click to reset',
      'quality.title': 'Quality check',
      'quality.note': 'Structural self-check; no model call',
      'quality.ready': 'Ready to dispatch',
      'quality.usable': 'Usable; consider strengthening',
      'quality.needsWork': 'Strengthen before dispatch',
      'quality.check.structure': 'Structure',
      'quality.check.requirements': 'Requirement items',
      'quality.check.acceptance': 'Acceptance criteria',
      'quality.check.constraints': 'Constraints/context',
      'quality.check.gaps': 'No open questions',
      'quality.check.translation': 'Bilingual parity',
      'quality.check.target': 'Target environment',
      'revision.open': 'Keep refining',
      'revision.title': 'Refine the current version',
      'revision.placeholder': 'Add the next sentence or a change, e.g. stricter acceptance criteria and failure handling',
      'revision.apply': 'Apply changes',
      'revision.cancel': 'Cancel',
      'revision.needNote': 'Write a change or addition first.',
      'revision.limit': '5 refinement rounds reached; regenerate or edit manually.',
      'diff.title': 'Version diff',
      'diff.compare': 'Compare',
      'diff.previous': 'Compare with previous',
      'diff.close': 'Close diff',
      'diff.empty': 'The two versions are identical',
      'history.title': 'Versions',
      'history.note': 'Stored in this browser, max 10',
      'history.clear': 'Clear',
      'history.load': 'Load',
      'history.loaded': 'Loaded a version',
      'history.empty': 'No versions yet',
      'status.inserted': 'Inserted into the composer',
      'status.replaced': 'Composer draft replaced',
      'status.blocked': 'The composer is not writable right now; try again in a moment',
      'status.copied': 'Copied',
      'status.copyFailed': 'Copy failed; select the text manually',
      'hint.panel': 'The result is written to the composer only — nothing is sent automatically.',
      'err.empty': 'Enter a requirement description first (at least 2 characters).',
      'err.tooLong': 'The description is too long (8000 characters max); split it into parts.',
      'err.remote': 'The command channel is unavailable in this page. Refresh and retry.',
      'err.fallback': 'The model call did not succeed; a local template was used instead.',
      'err.badPayload': 'The generated payload could not be parsed; please retry.',
      'aria.expand': 'Expand Say It For Me',
      'aria.collapse': 'Collapse Say It For Me',
    }

    // ------------------------------------------------------------------ style

    const CSS = [
      '.rcp-root{width:100%;font-family:inherit}',
      '.rcp-trigger{position:relative;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;padding:0;border:.5px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.rcp-trigger:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.rcp-trigger[data-open="true"]{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}',
      '.rcp-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.rcp-trigger svg{display:block;flex:none}',
    '.rcp-trigger-dot{position:absolute;top:3px;right:3px;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-1)}',
      '.rcp-popover{position:absolute;right:0;bottom:8px;z-index:30;width:min(620px,calc(100vw - 32px));box-sizing:border-box}',
      '.rcp-popover[hidden]{display:none}',
      '.rcp-panel{display:flex;flex-direction:column;gap:10px;padding:12px 14px 13px;border:.5px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-overlay);max-height:min(560px,58vh);overflow:auto;box-sizing:border-box}',
      '.rcp-head{display:flex;align-items:flex-start;gap:8px}',
      '.rcp-head-main{min-width:0;flex:1;cursor:grab;touch-action:none;user-select:none}',
      '.rcp-head-main:active{cursor:grabbing}',
      '.rcp-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);line-height:1.4;display:flex;align-items:center;gap:6px}',
      '.rcp-subtitle{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.5;margin-top:2px}',
      '.rcp-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;flex:none;border:none;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0}',
      '.rcp-icon-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.rcp-icon-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.rcp-textarea{width:100%;min-height:104px;max-height:220px;resize:vertical;box-sizing:border-box;padding:9px 11px;border:.5px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:1.65}',
      '.rcp-textarea::placeholder{color:var(--dsw-alias-label-secondary);opacity:.85}',
      '.rcp-textarea:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}',
      '.rcp-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.rcp-row-grow{flex:1;min-width:0}',
      '.rcp-muted{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.rcp-link{border:none;background:transparent;padding:0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;cursor:pointer;text-decoration:underline;text-underline-offset:3px}',
      '.rcp-link:hover{color:var(--dsw-alias-label-primary)}',
      '.rcp-link:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:4px}',
      '.rcp-group{display:inline-flex;align-items:center;gap:6px;min-width:0}',
      '.rcp-group-label{font-size:11px;color:var(--dsw-alias-label-secondary);flex:none}',
      '.rcp-seg{display:inline-flex;align-items:center;gap:2px;padding:2px;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}',
      '.rcp-seg-btn{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;line-height:1;padding:4px 8px;border-radius:6px;cursor:pointer;white-space:nowrap}',
      '.rcp-seg-btn:hover{color:var(--dsw-alias-label-primary)}',
      '.rcp-seg-btn[data-active="true"]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:0 0 0 .5px var(--dsw-alias-border-l2)}',
      '.rcp-seg-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.rcp-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.rcp-btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 12px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1;cursor:pointer}',
      '.rcp-btn:hover{border-color:var(--dsw-alias-border-l2)}',
      '.rcp-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.rcp-btn[disabled]{opacity:.5;cursor:default}',
      '.rcp-btn-primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-bg-base);font-weight:600}',
      '.rcp-btn-primary:hover{filter:brightness(1.05);border-color:transparent}',
      '.rcp-btn-ghost{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary)}',
      '.rcp-btn-ghost:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.rcp-spin{width:12px;height:12px;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);animation:rcp-spin .8s linear infinite}',
      '@keyframes rcp-spin{to{transform:rotate(360deg)}}',
      '@media (prefers-reduced-motion: reduce){.rcp-spin{animation:none}}',
      '.rcp-notice{font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:6px}',
      '.rcp-notice[data-kind="warn"]{color:var(--dsw-alias-state-warn-primary)}',
      '.rcp-notice[data-kind="ok"]{color:var(--dsw-alias-state-success-primary)}',
      '.rcp-error{font-size:11.5px;line-height:1.5;color:var(--dsw-alias-state-error-primary);padding:7px 9px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l1)}',
      '.rcp-result{display:flex;flex-direction:column;gap:8px;min-height:0}',
      '.rcp-tabs{display:flex;align-items:center;gap:2px;border-bottom:.5px solid var(--dsw-alias-border-l1);padding-bottom:6px}',
      '.rcp-tab{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;padding:3px 9px;border-radius:6px;cursor:pointer;line-height:1.4}',
      '.rcp-tab:hover{color:var(--dsw-alias-label-primary)}',
      '.rcp-tab[data-active="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.rcp-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.rcp-tab-grow{flex:1}',
      '.rcp-pane{min-height:0;max-height:280px;overflow:auto;padding-right:2px}',
      '.rcp-quote{margin:0;font-size:12.5px;line-height:1.7;color:var(--dsw-alias-label-primary)}',
      '.rcp-intent{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--dsw-alias-label-secondary);padding:2px 8px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}',
      '.rcp-gate{display:flex;flex-direction:column;gap:6px;padding:9px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1)}',
      '.rcp-gate-head{display:flex;align-items:center;gap:6px}',
      '.rcp-gate-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.rcp-gate-sub{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.5}',
      '.rcp-gate-item{display:flex;flex-direction:column;gap:3px}',
      '.rcp-gate-q{font-size:11.5px;color:var(--dsw-alias-label-primary);line-height:1.5}',
      '.rcp-gate-input{width:100%;box-sizing:border-box;padding:5px 8px;border:.5px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;line-height:1.5}',
      '.rcp-gate-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}',
      '.rcp-gate-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.rcp-gate-hint{font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.rcp-gate-progress{font-size:10.5px;color:var(--dsw-alias-label-secondary);margin-left:auto}',
      '.rcp-gate-choices{display:flex;flex-wrap:wrap;gap:4px}',
      '.rcp-choice{border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:1.4;padding:4px 8px;border-radius:999px;cursor:pointer}',
      '.rcp-choice:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}',
      '.rcp-choice[data-active="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}',
      '.rcp-choice:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.rcp-preset{border:.5px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:10.5px;line-height:1;padding:4px 7px;border-radius:999px;cursor:pointer}',
      '.rcp-preset:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}',
      '.rcp-preset[data-active="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}',
      '.rcp-preset:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.rcp-quality{display:flex;flex-direction:column;gap:5px;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1)}',
      '.rcp-quality-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.rcp-quality-score{font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary);line-height:1}',
      '.rcp-quality-label{font-size:11px;color:var(--dsw-alias-label-primary)}',
      '.rcp-quality-note{font-size:10.5px;color:var(--dsw-alias-label-secondary);margin-left:auto}',
      '.rcp-quality-checks{display:flex;flex-wrap:wrap;gap:4px 10px}',
      '.rcp-quality-check{font-size:10.5px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.rcp-quality-check[data-pass="true"]{color:var(--dsw-alias-state-success-primary)}',
      '.rcp-quality-check[data-pass="false"]{color:var(--dsw-alias-state-warn-primary)}',
      '.rcp-history{display:flex;flex-direction:column;gap:5px;margin-top:8px;padding-top:7px;border-top:.5px solid var(--dsw-alias-border-l1)}',
      '.rcp-history-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.rcp-history-note{font-size:10.5px;color:var(--dsw-alias-label-secondary);margin-left:auto}',
      '.rcp-history-list{display:flex;flex-direction:column;gap:4px;max-height:140px;overflow:auto}',
      '.rcp-history-item{display:flex;align-items:center;gap:8px;padding:4px 0}',
      '.rcp-history-main{min-width:0;flex:1}',
      '.rcp-history-title{font-size:11.5px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.rcp-history-meta{font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.rcp-diff{display:flex;flex-direction:column;gap:5px;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1)}',
      '.rcp-diff-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.rcp-diff-body{max-height:180px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word}',
      '.rcp-diff-line[data-kind="add"]{color:var(--dsw-alias-state-success-primary)}',
      '.rcp-diff-line[data-kind="remove"]{color:var(--dsw-alias-state-error-primary)}',
      '.rcp-diff-line[data-kind="same"]{color:var(--dsw-alias-label-secondary)}',
      '.rcp-revision{display:flex;flex-direction:column;gap:6px;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1)}',
      '.rcp-revision-input{width:100%;min-height:56px;max-height:140px;resize:vertical;box-sizing:border-box;padding:6px 8px;border:.5px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;line-height:1.5}',
      '.rcp-revision-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}',
      '.rcp-section{display:flex;flex-direction:column;gap:3px;margin-top:8px}',
      '.rcp-section-title{font-size:11px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-secondary)}',
      '.rcp-items{margin:0;padding-left:16px;font-size:12px;line-height:1.65;color:var(--dsw-alias-label-primary)}',
      '.rcp-items li{margin:1px 0}',
      '.rcp-items[data-tone="warn"] li::marker{color:var(--dsw-alias-state-warn-primary)}',
      '.rcp-empty{font-size:11.5px;color:var(--dsw-alias-label-secondary)}',
      '.rcp-pre{margin:0;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;font-size:11.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word;max-height:230px;overflow:auto;box-sizing:border-box}',
      '.rcp-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.rcp-foot-grow{flex:1;min-width:0}',
      '.rcp-badge{font-size:10.5px;line-height:1;padding:3px 7px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}',
      '.rcp-badge[data-kind="local"]{color:var(--dsw-alias-state-warn-primary)}',
    ].join('')

    // ------------------------------------------------------------------ icons

    function IconSparkle(props) {
      const size = props && props.size ? props.size : 14
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M12 3.5l1.9 4.9 4.9 1.9-4.9 1.9L12 17.1l-1.9-4.9L5.2 10.3l4.9-1.9L12 3.5Z', stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round' }),
        h('path', { d: 'M18.4 15.6l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9.9-2.2Z', fill: 'currentColor', opacity: .55 }))
    }

    function IconX() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M6 6l12 12M18 6L6 18', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }))
    }

    function IconArrowIn() {
      return h('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M12 4v10m0 0l-4-4m4 4l4-4', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { d: 'M5 19h14', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }))
    }

    function IconCopy() {
      return h('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('rect', { x: 8.5, y: 8.5, width: 11, height: 11, rx: 2.2, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M15.5 8.5v-2A2.5 2.5 0 0013 4H6.5A2.5 2.5 0 004 6.5V13a2.5 2.5 0 002.5 2.5h2', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }))
    }

    function IconRefresh() {
      return h('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M19.5 12a7.5 7.5 0 11-2.2-5.3', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
        h('path', { d: 'M19.5 4.5v4h-4', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

    function IconGather() {
      return h('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M12 4v9m0 0l-3.5-3.5M12 13l3.5-3.5', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { d: 'M4 16.5v1.2A2.3 2.3 0 006.3 20h11.4a2.3 2.3 0 002.3-2.3v-1.2', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }))
    }

    // --------------------------------------------------------- local fallback

    const INTENT_RULES = [
      { zh: '修复缺陷', en: 'Bug fixing', re: /(修复|报错|异常|崩溃|不工作|fix|bug|broken|crash|error)/i },
      { zh: '重构优化', en: 'Refactoring / optimization', re: /(重构|优化|性能|refactor|optimi[sz]e|performance)/i },
      { zh: '调研分析', en: 'Research', re: /(调研|研究|评估|对比|research|survey|evaluate|compare)/i },
      { zh: '写作文档', en: 'Writing', re: /(文档|说明|readme|文章|文案|write|documentation|article|copywriting)/i },
      { zh: '数据分析', en: 'Data analysis', re: /(数据|表格|报表|统计|excel|csv|data|report|analytics)/i },
      { zh: '设计创作', en: 'Design', re: /(设计|界面|交互|视觉|design|layout|mockup|figma|ui)/i },
      { zh: '自动化流程', en: 'Automation', re: /(自动化|脚本|批量|流程|automate|script|pipeline|workflow)/i },
      { zh: '开发功能', en: 'Feature development', re: /(开发|实现|新增|添加|做一个|搭建|功能|页面|应用|接口|feature|implement|build|create|api|page|app)/i },
    ]

    const GAP_RULES = [
      { zh: '目标用户或使用场景是谁？', en: 'Who is the target user or the usage scenario?', re: /(给谁|用户|受众|面向|场景|who|audience|user|scenario)/i },
      { zh: '最终交付物是什么形式（代码、文档、页面、数据文件）？', en: 'What is the final deliverable (code, document, page, data file)?', re: /(交付|产出|结果|输出|格式|文件|文档|报告|deliverable|output|format)/i },
      { zh: '有指定的技术栈、工具或运行环境限制吗？', en: 'Any required stack, tooling, or runtime constraints?', re: /(技术栈|语言|框架|工具|环境|依赖|stack|framework|python|node|java|rust)/i },
      { zh: '怎样算完成？验收标准是什么？', en: 'What counts as done? What are the acceptance criteria?', re: /(验收|成功|标准|质量|测试|acceptance|success|criteria|test)/i },
      { zh: '有时间或截止日期要求吗？', en: 'Is there a deadline or time constraint?', re: /(时间|截止|多久|期限|deadline|timeline|days|weeks)/i },
      { zh: '对风格、语气或视觉表现有偏好吗？', en: 'Any preference for style, tone, or visual presentation?', re: /(风格|语气|界面|视觉|设计|style|tone|visual|design)/i },
    ]

    const CONSTRAINT_RE = /(必须|不要|不能|禁止|只能|限制|不超过|最多|至少|上限|截止|兼容|安全|隐私|格式|必须用|must|should|only|no more than|at most|within|compatible|security|privacy|format)/i
    const BULLET_RE = /^([-*•·]|\d+[.、)]|\(\d+\))\s+/

    function hasChinese(text) {
      if (typeof text !== 'string' || text === '') return false
      const cjk = (text.match(/[\u3400-\u9fff]/gu) || []).length
      const compact = text.replace(/\s/gu, '').length
      return cjk >= Math.max(2, compact * 0.15)
    }

    /** Deterministic line diff for the history compare view (bounded input). */
    function diffLines(before, after) {
      const a = String(before).split('\n').slice(0, 500)
      const b = String(after).split('\n').slice(0, 500)
      const n = a.length
      const m = b.length
      const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
      for (let i = n - 1; i >= 0; i -= 1) {
        for (let j = m - 1; j >= 0; j -= 1) {
          dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
        }
      }
      const out = []
      let i = 0
      let j = 0
      while (i < n && j < m) {
        if (a[i] === b[j]) {
          out.push({ type: 'same', text: a[i] })
          i += 1
          j += 1
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
          out.push({ type: 'remove', text: a[i] })
          i += 1
        } else {
          out.push({ type: 'add', text: b[j] })
          j += 1
        }
      }
      while (i < n) out.push({ type: 'remove', text: a[i++] })
      while (j < m) out.push({ type: 'add', text: b[j++] })
      return out
    }

    /** Deterministic fallback choices when the model did not supply gapChoices. */
    function defaultGapChoices(gap) {
      const text = typeof gap === 'string' ? gap : ''
      const chinese = hasChinese(text)
      if (/是否|要不要|有没有|能否|需不需要|可不可以/u.test(text)) {
        return chinese ? ['是', '否', '按常见做法'] : ['Yes', 'No', 'Use default']
      }
      if (/时间|何时|多久|频率|周期|截止|日期/u.test(text)) {
        return chinese ? ['尽快', '本周内', '下周', '暂不确定'] : ['ASAP', 'This week', 'Next week', 'Not sure']
      }
      if (/范围|哪些|包含|覆盖|边界/u.test(text)) {
        return chinese ? ['最小范围', '完整范围', '先做核心'] : ['Minimal', 'Full', 'Core first']
      }
      if (/优先级|先做|先后/u.test(text)) {
        return ['P0', 'P1', 'P2']
      }
      if (/用户|受众|谁/u.test(text)) {
        return chinese ? ['内部团队', '外部客户', '两者都有'] : ['Internal team', 'External customers', 'Both']
      }
      return chinese ? ['按常见做法', '先不做', '需要补充说明'] : ['Use default', 'Skip for now', 'I will add details']
    }

    function splitLines(text) {
      return String(text).split(/\r?\n/gu).map((line) => line.trim()).filter((line) => line !== '')
    }

    function bulletItems(lines) {
      const out = []
      for (const line of lines) {
        if (!BULLET_RE.test(line)) continue
        const item = line.replace(BULLET_RE, '').trim()
        if (item !== '') out.push(item)
      }
      return out
    }

    function guessIntent(text, chinese) {
      for (const rule of INTENT_RULES) {
        if (rule.re.test(text)) return chinese ? rule.zh : rule.en
      }
      return chinese ? '其它' : 'Other'
    }

    /** Deterministic first line shared with the Host half for target presets. */
    function targetPreamble(target, chinese) {
      if (target === 'claude-code') {
        return chinese
          ? '> 目标环境：Claude Code（终端/IDE）。先阅读相关文件与项目约定，再开始修改；保持改动聚焦。'
          : '> Target: Claude Code (terminal/IDE). Read the relevant files and project conventions before editing; keep changes focused.'
      }
      if (target === 'codex') {
        return chinese
          ? '> 目标环境：Codex（仓库内执行）。先检查代码库与现有测试，保持最小改动，并在完成后运行相关检查。'
          : '> Target: Codex (in-repository execution). Inspect the codebase and existing tests, keep the diff minimal, and run the relevant checks when done.'
      }
      if (target === 'cursor') {
        return chinese
          ? '> 目标环境：Cursor（编辑器工作区）。先阅读相关文件，做聚焦修改，不要改动无关代码。'
          : '> Target: Cursor (editor workspace). Read the relevant files first, make focused edits, and leave unrelated code unchanged.'
      }
      return ''
    }

    /** Deterministic offline fallback: useful prompt scaffold plus explicit gaps. */
    function buildLocalResult(rough, options) {
      const chinese = options.language === 'zh' ? true : options.language === 'en' ? false : hasChinese(rough)
      const preamble = targetPreamble(options.target, chinese)
      const lines = splitLines(rough)
      const bullets = bulletItems(lines)
      const constraints = lines.filter((line) => CONSTRAINT_RE.test(line)).slice(0, 6)
      const intent = guessIntent(rough, chinese)
      const gaps = []
      for (const rule of GAP_RULES) {
        if (gaps.length >= 4) break
        if (!rule.re.test(rough)) gaps.push(chinese ? rule.zh : rule.en)
      }
      const deliverables = bullets.length > 0
        ? bullets.slice(0, 6)
        : [chinese ? '按描述产出一个可直接使用的结果（具体形式待确认）' : 'One directly usable result matching the description (exact form to be confirmed)']
      const assumption = chinese
        ? '未提及的信息按最常见、最保守的做法处理；不引入额外依赖，不扩大范围。'
        : 'Unmentioned details follow the most common, conservative practice; no extra dependencies and no scope expansion.'
      const promptLines = []
      if (chinese) {
        promptLines.push('## 任务', rough, '')
        promptLines.push('## 背景与上下文', chinese ? '未提供。请先根据任务描述推断；关键信息不足时先向我确认。' : 'Not provided. Infer from the task; ask before guessing when key facts are missing.', '')
        promptLines.push('## 需求要点')
        for (const item of deliverables) promptLines.push('- ' + item)
        promptLines.push('')
        promptLines.push('## 约束')
        if (constraints.length === 0) promptLines.push('- 未特别说明；采用最常见、最保守的做法。')
        else for (const item of constraints) promptLines.push('- ' + item)
        promptLines.push('')
        promptLines.push('## 执行要求')
        promptLines.push('- 先给出简要计划（步骤、范围、风险），再开始执行。')
        promptLines.push('- 输出结构化结果，并在结尾列出你的关键假设与未决问题。')
        promptLines.push('- 不要编造事实；遇到不确定之处先列出问题。')
        promptLines.push('')
        if (gaps.length > 0) {
          promptLines.push('## 请先确认')
          for (let index = 0; index < gaps.length; index += 1) promptLines.push(String(index + 1) + '. ' + gaps[index])
        }
        promptLines.push('', '## 验收标准')
        promptLines.push('- 结果覆盖上述需求要点，可直接使用或继续迭代。')
        promptLines.push('- 未决问题被明确列出，而不是被猜测掩盖。')
      } else {
        promptLines.push('## Task', rough, '')
        promptLines.push('## Context', 'Not provided. Infer from the task; ask before guessing when key facts are missing.', '')
        promptLines.push('## Requirements')
        for (const item of deliverables) promptLines.push('- ' + item)
        promptLines.push('')
        promptLines.push('## Constraints')
        if (constraints.length === 0) promptLines.push('- None stated; follow the most common, conservative practice.')
        else for (const item of constraints) promptLines.push('- ' + item)
        promptLines.push('')
        promptLines.push('## Execution')
        promptLines.push('- Start with a short plan (steps, scope, risks), then execute.')
        promptLines.push('- Return a structured result and close with your key assumptions and open questions.')
        promptLines.push('- Do not invent facts; list uncertainties instead of guessing.')
        promptLines.push('')
        if (gaps.length > 0) {
          promptLines.push('## Confirm before starting')
          for (let index = 0; index < gaps.length; index += 1) promptLines.push(String(index + 1) + '. ' + gaps[index])
        }
        promptLines.push('', '## Acceptance')
        promptLines.push('- The result covers the stated requirements and is directly usable or ready for iteration.')
        promptLines.push('- Open questions are listed explicitly rather than hidden by guesses.')
      }
      const titleSource = lines.length > 0 ? lines[0] : rough
      const promptText = (preamble !== '' ? preamble + '\n\n' : '') + promptLines.join('\n')
      return {
        title: (chinese ? '需求 Prompt' : 'Requirement Prompt') + ' · ' + intent,
        analysis: {
          summary: titleSource.slice(0, 160),
          intent,
          deliverables,
          constraints,
          assumptions: [assumption],
          gaps,
        },
        prompt: promptText,
        meta: { source: 'local', target: typeof options.target === 'string' ? options.target : 'generic', scenario: typeof options.scenario === 'string' ? options.scenario : 'general', promptChars: promptText.length },
      }
    }

    // ------------------------------------------------------------ remote call

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
     * Unwrap a generated Remote result. The gateway answers `{ ok, value }` or
     * `{ ok: false, error }`; a bare value is tolerated for resilience.
     */
    function unwrapRemote(response) {
      if (response !== null && typeof response === 'object' && Object.prototype.hasOwnProperty.call(response, 'ok')) {
        if (response.ok === true) return response.value
        const failure = response.error !== undefined && response.error !== null ? response.error : response
        const message = typeof failure.message === 'string'
          ? failure.message
          : typeof failure.code === 'string'
            ? failure.code
            : 'remote commands.execute failed'
        throw new Error(message)
      }
      return response
    }

    /**
     * Resolve the mounted `commands` Remote namespace. Cordis exposes nested
     * services both through the caller context and through dotted keys, so every
     * documented access path is tried before giving up.
     */
    function resolveCommandsNamespace(ctx) {
      const candidates = []
      const push = (value) => {
        if (value !== undefined && value !== null) candidates.push(value)
      }
      try {
        if (typeof ctx.get === 'function') push(ctx.get('remote.commands'))
      } catch {
        // try the next path
      }
      try {
        if (typeof ctx.get === 'function') {
          const remote = ctx.get('remote')
          if (remote !== undefined && remote !== null) push(remote.commands)
        }
      } catch {
        // try the next path
      }
      try {
        if (ctx.remote !== undefined && ctx.remote !== null) push(ctx.remote.commands)
      } catch {
        // namespace not reachable through this path
      }
      for (const candidate of candidates) {
        try {
          if (typeof candidate.execute === 'function') return candidate
        } catch {
          // keep looking
        }
      }
      return undefined
    }

    /** Whether a Remote error complains about the call arity. */
    function isArityError(error) {
      const message = messageOf(error)
      return /expected .*argument|plus an optional AbortSignal/i.test(message)
    }

    /**
     * Build the one-command bridge used by the panel. The gateway accepts an
     * optional trailing AbortSignal for commands.execute; older compositions
     * only take the three business arguments, so a rejected arity retries.
     */
    function createCommandResolver(ctx) {
      return async function executeCommand(sessionId, line, signal) {
        const commands = resolveCommandsNamespace(ctx)
        writeDiagnostic({
          stage: 'resolve',
          resolved: commands !== undefined,
          sessionIdKind: typeof sessionId,
          lineLength: typeof line === 'string' ? line.length : -1,
        })
        if (commands === undefined) throw new Error('commands Remote namespace unresolved')
        const attempts = [
          [sessionId, line, [], signal],
          [sessionId, line, []],
          [sessionId, line],
          [line, [], signal],
          [line, []],
        ]
        let failure
        for (const args of attempts) {
          try {
            return unwrapRemote(await commands.execute.apply(commands, args))
          } catch (error) {
            failure = error
            if (!isArityError(error)) break
          }
        }
        let probe = ''
        try {
          if (typeof commands.list === 'function') {
            const listed = unwrapRemote(await commands.list(sessionId))
            probe = ' [list=' + (Array.isArray(listed) ? String(listed.length) : 'ok') + ']'
          }
        } catch (listError) {
          probe = ' [list failed: ' + messageOf(listError).slice(0, 140) + ']'
        }
        writeDiagnostic({
          stage: 'execute-failed',
          message: messageOf(failure).slice(0, 800),
          probe,
        })
        throw new Error(messageOf(failure) + probe)
      }
    }

    /** The resolver installed by `apply`, available to both slot entries. */
    let activeCommandResolver = null

    // --------------------------------------------------- shared session store

    /**
     * The trigger sits in the composer tool row (`conversation.input.right`),
     * while the panel floats from `conversation.input.overlay`. They are two
     * slot entries, so the open flag and the one-click organize request live in
     * one tiny store keyed by session id.
     */
    const sessionStores = new Map()

    /** Per-session generation state, kept alive across session switches. */
    const generationCache = new Map()
    const generationControllers = new Map()
    const MAX_ACTIVE_GENERATIONS = 2
    let activeGenerations = 0

    function defaultGenerationState() {
      return {
        status: 'idle',
        result: null,
        error: '',
        notice: '',
        noticeKind: 'info',
        pendingApply: null,
        restoreDraft: null,
        rough: '',
        mode: 'agent',
        detail: 'standard',
        language: 'auto',
        target: 'generic',
        scenario: 'general',
        unseen: false,
        startedAt: 0,
      }
    }

    function generationFor(sessionId) {
      const key = typeof sessionId === 'string' ? sessionId : ''
      let state = generationCache.get(key)
      if (state === undefined) {
        state = defaultGenerationState()
        generationCache.set(key, state)
      }
      return state
    }

    function storeFor(sessionId) {
      const key = typeof sessionId === 'string' ? sessionId : ''
      let store = sessionStores.get(key)
      if (store === undefined) {
        store = { key, open: false, seq: 0, text: '', appliedText: '', listeners: new Set() }
        sessionStores.set(key, store)
      }
      return store
    }

    function snapshotOf(store) {
      return {
        open: store.open,
        seq: store.seq,
        text: store.text,
        appliedText: store.appliedText,
        gen: generationFor(store.key),
      }
    }

    function notifySession(sessionId) {
      const store = storeFor(sessionId)
      for (const listener of [...store.listeners]) {
        try {
          listener()
        } catch {
          // A broken listener must not block the others.
        }
      }
    }

    function useSessionStore(sessionId) {
      const key = typeof sessionId === 'string' ? sessionId : ''
      const [state, setState] = React.useState(() => snapshotOf(storeFor(key)))

      React.useEffect(() => {
        const store = storeFor(key)
        const sync = () => setState(snapshotOf(store))
        sync()
        store.listeners.add(sync)
        return () => {
          store.listeners.delete(sync)
        }
      }, [key])

      const update = React.useCallback((mutate) => {
        const store = storeFor(key)
        mutate(store)
        for (const listener of [...store.listeners]) {
          try {
            listener()
          } catch {
            // A broken listener must not block the others.
          }
        }
      }, [key])

      const setOpen = React.useCallback((next) => {
        update((store) => {
          const value = typeof next === 'function' ? next(store.open) : next
          if (store.open !== value) store.open = value
        })
      }, [update])

      const requestOrganize = React.useCallback((text) => {
        update((store) => {
          store.open = true
          store.seq += 1
          store.text = typeof text === 'string' ? text : ''
        })
      }, [update])

      const noteApplied = React.useCallback((text) => {
        update((store) => {
          store.appliedText = typeof text === 'string' ? text : ''
        })
      }, [update])

      return [state, { setOpen, requestOrganize, noteApplied }]
    }

    // -------------------------------------------------------------- component

    function Segmented(props) {
      const items = props.items
      const value = props.value
      const onChange = props.onChange
      const label = props.label
      return h('span', { className: 'rcp-group' },
        h('span', { className: 'rcp-group-label' }, label),
        h('span', { className: 'rcp-seg', role: 'group', 'aria-label': label },
          items.map((item) => h('button', {
            key: item.value,
            type: 'button',
            className: 'rcp-seg-btn',
            'data-active': value === item.value ? 'true' : 'false',
            'aria-pressed': value === item.value,
            onClick: () => onChange(item.value),
          }, item.label))))
    }

    function ItemList(props) {
      const items = props.items
      if (!Array.isArray(items) || items.length === 0) return null
      return h('div', { className: 'rcp-section' },
        h('div', { className: 'rcp-section-title' }, props.title),
        h('ul', { className: 'rcp-items', 'data-tone': props.tone === undefined ? 'normal' : props.tone },
          items.map((item, index) => h('li', { key: index }, item))))
    }

    function RequirementPanel(props) {
      const t = typeof props.t === 'function'
        ? props.t
        : (key) => key
      const useInput = typeof props.useInput === 'function' ? props.useInput : undefined
      const inputActions = props.inputActions
      const sessionId = props.sessionId
      const executeCommand = typeof props.executeCommand === 'function'
        ? props.executeCommand
        : activeCommandResolver === null ? undefined : activeCommandResolver

      const draft = useInput === undefined ? '' : useInput((state) => state.draft)

      const [sessionState, sessionActions] = useSessionStore(sessionId)
      const open = sessionState.open
      const setOpen = sessionActions.setOpen
      const [rough, setRough] = React.useState('')
      const [mode, setMode] = React.useState('agent')
      const [detail, setDetail] = React.useState('standard')
      const [language, setLanguage] = React.useState('auto')
      const [target, setTarget] = React.useState('generic')
      const [scenario, setScenario] = React.useState('general')
      const [status, setStatus] = React.useState('idle')
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [noticeKind, setNoticeKind] = React.useState('info')
      const [result, setResult] = React.useState(null)
      const [tab, setTab] = React.useState('analysis')
      const [copyState, setCopyState] = React.useState('idle')
      const [confirmReplace, setConfirmReplace] = React.useState(false)
      const [restoreDraft, setRestoreDraft] = React.useState(null)
      const [clarifyAnswers, setClarifyAnswers] = React.useState({})
      const [clarifyDismissed, setClarifyDismissed] = React.useState(false)
      const [pendingApply, setPendingApply] = React.useState(null)
      const [gateIndex, setGateIndex] = React.useState(0)
      const [clarifySelections, setClarifySelections] = React.useState({})
      const [history, setHistory] = React.useState(() => readHistory(sessionId))
      const [revisionOpen, setRevisionOpen] = React.useState(false)
      const [revisionNote, setRevisionNote] = React.useState('')
      const [revisionDepth, setRevisionDepth] = React.useState(0)
      const [diffTarget, setDiffTarget] = React.useState(null)

      React.useEffect(() => {
        setHistory(readHistory(sessionId))
      }, [sessionId])
      const textareaRef = React.useRef(null)
      const popoverRef = React.useRef(null)
      const dragRef = React.useRef(null)
      const [dragOffset, setDragOffset] = React.useState({ x: 0, y: 0 })
      const handledSeqRef = React.useRef({})
      const lastDraftRef = React.useRef(typeof draft === 'string' ? draft : '')
      // Latest composer draft for async completion checks (render closures go stale).
      const draftRef = React.useRef(typeof draft === 'string' ? draft : '')
      draftRef.current = typeof draft === 'string' ? draft : ''
      const currentSessionRef = React.useRef(sessionId)
      const previousSessionRef = React.useRef(sessionId)
      const mountedRef = React.useRef(true)
      currentSessionRef.current = sessionId

      React.useEffect(() => {
        mountedRef.current = true
        return () => {
          mountedRef.current = false
        }
      }, [])

      // Session switches must not cancel a running generation. Keep the previous
      // session's state in the module cache, then hydrate the newly visible one.
      React.useEffect(() => {
        const previous = previousSessionRef.current
        if (previous !== sessionId) {
          const previousState = generationFor(previous)
          // A request may have completed while the user was switching; do not
          // overwrite that terminal state with the stale render snapshot.
          if (previousState.status !== 'ready' && previousState.status !== 'error') {
            Object.assign(previousState, {
              status,
              result,
              error,
              notice,
              noticeKind,
              pendingApply,
              restoreDraft,
              rough,
              mode,
              detail,
              language,
              target,
              scenario,
            })
          }
        }
        const cached = generationFor(sessionId)
        setRough(cached.rough)
        setMode(cached.mode)
        setDetail(cached.detail)
        setLanguage(cached.language)
        setTarget(cached.target)
        setScenario(cached.scenario)
        setStatus(cached.status)
        setResult(cached.result)
        setError(cached.error)
        setNotice(cached.notice)
        setNoticeKind(cached.noticeKind)
        setPendingApply(cached.pendingApply)
        setRestoreDraft(cached.restoreDraft)
        setTab('analysis')
        setConfirmReplace(false)
        setClarifyAnswers({})
        setClarifySelections({})
        setGateIndex(0)
        setClarifyDismissed(false)
        setRevisionOpen(false)
        setRevisionNote('')
        setRevisionDepth(0)
        setDiffTarget(null)
        lastDraftRef.current = typeof draft === 'string' ? draft : ''
        previousSessionRef.current = sessionId
      }, [sessionId])

      React.useEffect(() => {
        if (copyState === 'idle') return undefined
        const timer = setTimeout(() => setCopyState('idle'), 1800)
        return () => clearTimeout(timer)
      }, [copyState])

      // Opening the popover clears the background-result dot.
      React.useEffect(() => {
        if (!open) return
        const cached = generationFor(sessionId)
        if (cached.unseen === true) {
          cached.unseen = false
          notifySession(sessionId)
        }
      }, [open, sessionId])

      // Opening the popover seeds an empty editor from the composer draft once.
      React.useEffect(() => {
        if (!open) return
        if (rough.trim() !== '') return
        const seed = typeof draft === 'string' ? draft.trim() : ''
        if (seed !== '') setRough(draft)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [open])

      // One-click organize: the trigger stores the composer text and a sequence
      // number, so the panel generates immediately when the request arrives.
      React.useEffect(() => {
        if (sessionState.seq === 0) return
        const handled = handledSeqRef.current[sessionId] === undefined ? 0 : handledSeqRef.current[sessionId]
        if (handled === sessionState.seq) return
        handledSeqRef.current[sessionId] = sessionState.seq
        const text = typeof sessionState.text === 'string' ? sessionState.text : ''
        if (text.trim() === '') return
        setRough(text)
        void runGenerate(text, { autoApply: true, original: text })
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [sessionState.seq, sessionId])

      // Sending a message (or otherwise clearing the composer) ends the current
      // round: retire the panel's result and source draft so the next round
      // cannot show or re-insert stale content from the previous round.
      React.useEffect(() => {
        const current = typeof draft === 'string' ? draft : ''
        const previous = lastDraftRef.current
        lastDraftRef.current = current
        if (previous === '' || current !== '') return
        const inflight = generationControllers.get(sessionId)
        if (inflight !== undefined) {
          try {
            inflight.abort()
          } catch {
            // ignore
          }
          generationControllers.delete(sessionId)
        }
        publishGeneration(sessionId, {
          status: 'idle',
          result: null,
          error: '',
          notice: '',
          pendingApply: null,
          restoreDraft: null,
        })
        sessionActions.noteApplied('')
        setResult(null)
        setRestoreDraft(null)
        setStatus('idle')
        setError('')
        setNotice('')
        setConfirmReplace(false)
        setRough('')
        setTab('analysis')
        setClarifyAnswers({})
        setClarifySelections({})
        setGateIndex(0)
        setClarifyDismissed(false)
        setPendingApply(null)
        setRevisionOpen(false)
        setRevisionNote('')
        setRevisionDepth(0)
        setDiffTarget(null)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [draft])

      // Escape or a click outside dismisses the popover.
      React.useEffect(() => {
        if (!open) return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            setOpen(false)
            setConfirmReplace(false)
          }
        }
        const onPointerDown = (event) => {
          const target = event.target
          if (target === null || typeof target.closest !== 'function') return
          if (target.closest('[data-rcp-panel]') !== null) return
          if (target.closest('[data-rcp-trigger]') !== null) return
          setOpen(false)
          setConfirmReplace(false)
        }
        document.addEventListener('keydown', onKeyDown, true)
        document.addEventListener('pointerdown', onPointerDown, true)
        return () => {
          document.removeEventListener('keydown', onKeyDown, true)
          document.removeEventListener('pointerdown', onPointerDown, true)
        }
      }, [open, setOpen])

      const closePanel = () => {
        setOpen(false)
        setConfirmReplace(false)
      }

      const onDragStart = (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return
        const node = popoverRef.current
        if (node === null || typeof node.getBoundingClientRect !== 'function') return
        const rect = node.getBoundingClientRect()
        dragRef.current = {
          startX: event.clientX,
          startY: event.clientY,
          baseX: dragOffset.x,
          baseY: dragOffset.y,
          rect,
        }
        if (typeof event.currentTarget.setPointerCapture === 'function') {
          event.currentTarget.setPointerCapture(event.pointerId)
        }
        event.preventDefault()
      }

      const onDragMove = (event) => {
        const drag = dragRef.current
        if (drag === null) return
        const width = typeof window !== 'undefined' && typeof window.innerWidth === 'number' ? window.innerWidth : 0
        const height = typeof window !== 'undefined' && typeof window.innerHeight === 'number' ? window.innerHeight : 0
        let dx = event.clientX - drag.startX
        let dy = event.clientY - drag.startY
        if (width > 0 && height > 0) {
          const margin = 16
          const minX = margin - drag.rect.left
          const maxX = width - margin - drag.rect.right
          const minY = margin - drag.rect.top
          const maxY = height - margin - drag.rect.bottom
          dx = Math.max(minX, Math.min(maxX, dx))
          dy = Math.max(minY, Math.min(maxY, dy))
        }
        setDragOffset({ x: drag.baseX + dx, y: drag.baseY + dy })
      }

      const onDragEnd = (event) => {
        dragRef.current = null
        if (typeof event.currentTarget.releasePointerCapture === 'function') {
          try {
            event.currentTarget.releasePointerCapture(event.pointerId)
          } catch {
            // ignore
          }
        }
      }

      const gatherComposer = () => {
        const text = typeof draft === 'string' ? draft.trim() : ''
        if (text === '') {
          setNotice(t('field.emptyDraft'))
          setNoticeKind('info')
          return
        }
        setRough(text)
        setNotice('')
        if (textareaRef.current !== null && typeof textareaRef.current.focus === 'function') {
          textareaRef.current.focus()
        }
      }

      /** Update one session's cached generation state and mirror it into the
       *  visible component only when that session is still the active one. */
      const publishGeneration = (owner, patch) => {
        Object.assign(generationFor(owner), patch)
        notifySession(owner)
        if (!mountedRef.current || currentSessionRef.current !== owner) return false
        if (Object.prototype.hasOwnProperty.call(patch, 'status')) setStatus(patch.status)
        if (Object.prototype.hasOwnProperty.call(patch, 'result')) setResult(patch.result)
        if (Object.prototype.hasOwnProperty.call(patch, 'error')) setError(patch.error)
        if (Object.prototype.hasOwnProperty.call(patch, 'notice')) setNotice(patch.notice)
        if (Object.prototype.hasOwnProperty.call(patch, 'noticeKind')) setNoticeKind(patch.noticeKind)
        if (Object.prototype.hasOwnProperty.call(patch, 'pendingApply')) setPendingApply(patch.pendingApply)
        if (Object.prototype.hasOwnProperty.call(patch, 'restoreDraft')) setRestoreDraft(patch.restoreDraft)
        return true
      }

      /** Write a finished model result back into the composer, preserving the source text. */
      const applyRefined = (data, original, owner) => {
        const ownerSession = typeof owner === 'string' ? owner : sessionId
        if (!mountedRef.current || currentSessionRef.current !== ownerSession) {
          const cached = generationFor(ownerSession)
          cached.pendingApply = typeof original === 'string' ? original : ''
          cached.unseen = true
          return
        }
        const meta = data !== null && typeof data === 'object' && data.meta !== null && typeof data.meta === 'object' ? data.meta : {}
        if (meta.source !== 'model') return
        const prompt = typeof data.prompt === 'string' ? data.prompt : ''
        if (prompt.trim() === '') return
        if (inputActions === undefined || inputActions === null || typeof inputActions.setDraft !== 'function') return
        const current = draftRef.current.trim()
        const source = typeof original === 'string' ? original.trim() : ''
        if (source !== '' && current !== source) {
          setNotice(t('status.draftChanged'))
          setNoticeKind('warn')
          const cached = generationFor(ownerSession)
          cached.notice = t('status.draftChanged')
          cached.noticeKind = 'warn'
          return
        }
        try {
          inputActions.setDraft(prompt)
          setRestoreDraft(typeof original === 'string' ? original : '')
          setNotice(t('status.applied'))
          setNoticeKind('ok')
          sessionActions.noteApplied(prompt)
          setOpen(false)
          const cached = generationFor(ownerSession)
          cached.notice = t('status.applied')
          cached.noticeKind = 'ok'
          cached.restoreDraft = typeof original === 'string' ? original : ''
          cached.pendingApply = null
        } catch {
          setNotice(t('status.blocked'))
          setNoticeKind('warn')
          const cached = generationFor(ownerSession)
          cached.notice = t('status.blocked')
          cached.noticeKind = 'warn'
        }
      }

      const recordHistory = (data, text, owner) => {
        if (data === null || typeof data !== 'object' || typeof data.prompt !== 'string' || data.prompt.trim() === '') return
        const targetSession = typeof owner === 'string' ? owner : sessionId
        const entry = {
          id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 7),
          at: new Date().toISOString(),
          title: typeof data.title === 'string' ? data.title : '',
          prompt: data.prompt,
          translation: typeof data.translation === 'string' ? data.translation : '',
          analysis: data.analysis,
          meta: data.meta,
          rough: text,
          mode,
          detail,
          language,
          target,
          scenario,
        }
        const previous = readHistory(targetSession)
        if (previous.length > 0 && previous[0].prompt === entry.prompt) return
        const next = [entry, ...previous].slice(0, HISTORY_LIMIT)
        writeHistory(targetSession, next)
        if (mountedRef.current && currentSessionRef.current === targetSession) setHistory(next)
      }

      const loadHistoryEntry = (entry) => {
        if (entry === null || typeof entry !== 'object' || typeof entry.prompt !== 'string') return
        setResult({
          title: typeof entry.title === 'string' ? entry.title : '',
          analysis: entry.analysis,
          prompt: entry.prompt,
          translation: typeof entry.translation === 'string' ? entry.translation : '',
          meta: entry.meta,
        })
        setTab('prompt')
        setClarifyAnswers({})
        setClarifySelections({})
        setGateIndex(0)
        setClarifyDismissed(true)
        setPendingApply(null)
        setRevisionOpen(false)
        setRevisionNote('')
        setRevisionDepth(0)
        setDiffTarget(null)
        if (typeof entry.mode === 'string') setMode(entry.mode)
        if (typeof entry.detail === 'string') setDetail(entry.detail)
        if (typeof entry.language === 'string') setLanguage(entry.language)
        if (typeof entry.target === 'string') setTarget(entry.target)
        if (typeof entry.scenario === 'string') setScenario(entry.scenario)
        setNotice(t('history.loaded'))
        setNoticeKind('ok')
      }

      const clearHistory = () => {
        setHistory([])
        setDiffTarget(null)
        writeHistory(sessionId, [])
      }

      const pollBackgroundJob = async (owner, jobId, signal) => {
        let first = true
        while (!signal.aborted) {
          await sleep(first ? 600 : 1500)
          first = false
          if (signal.aborted) break
          const execution = await executeCommand(
            owner,
            '/' + BACKGROUND_STATUS_COMMAND + ' ' + JSON.stringify({ jobId }),
            signal,
          )
          const body = commandEnvelope(execution)
          if (body === null) throw new Error(t('err.remote'))
          if (body.ok !== true) {
            clearJobRecord(owner)
            throw new Error(typeof body.error === 'string' && body.error !== '' ? body.error : t('err.remote'))
          }
          const job = body.data
          if (job === null || typeof job !== 'object' || typeof job.status !== 'string') throw new Error(t('err.badPayload'))
          if (job.status === 'running' || job.status === 'queued') continue
          clearJobRecord(owner)
          if (job.status === 'succeeded') return job.result
          if (job.status === 'failed') throw new Error(typeof job.error === 'string' && job.error !== '' ? job.error : t('err.fallback'))
          if (job.status === 'cancelled') throw new Error(typeof job.error === 'string' && job.error !== '' ? job.error : '生成已取消。')
          throw new Error(t('err.badPayload'))
        }
        const aborted = new Error('生成已取消。')
        aborted.code = 'E_ABORTED'
        throw aborted
      }

      const cancelBackgroundForSession = async (owner) => {
        const record = readJobRecord(owner)
        if (record === null) return
        clearJobRecord(owner)
        try {
          await executeCommand(
            owner,
            '/' + BACKGROUND_CANCEL_COMMAND + ' ' + JSON.stringify({ jobId: record.jobId }),
            undefined,
          )
        } catch {
          // The job may already have finished; starting a new one can still work.
        }
      }

      const startBackgroundJob = async (owner, request, signal) => {
        let execution
        try {
          execution = await executeCommand(
            owner,
            '/' + BACKGROUND_START_COMMAND + ' ' + JSON.stringify(Object.assign({}, request, { ownerSessionId: owner })),
            signal,
          )
        } catch {
          return null
        }
        const body = commandEnvelope(execution)
        if (body === null) return null
        if (body.ok !== true) {
          const code = typeof body.code === 'string' ? body.code : ''
          if (code === 'E_BUSY' || code === 'E_BAD_PAYLOAD') {
            throw new Error(typeof body.error === 'string' && body.error !== '' ? body.error : t('err.remote'))
          }
          return null
        }
        const data = body.data
        if (data === null || typeof data !== 'object' || typeof data.jobId !== 'string' || data.jobId === '') return null
        writeJobRecord(owner, {
          jobId: data.jobId,
          rough: typeof request.rough === 'string' ? request.rough : '',
          options: {
            mode: request.mode,
            detail: request.detail,
            language: request.language,
            target: request.target,
            scenario: request.scenario,
          },
          at: Date.now(),
        })
        return pollBackgroundJob(owner, data.jobId, signal)
      }

      const resumeBackgroundJob = async (owner, record) => {
        if (generationControllers.has(owner)) return
        const cached = generationFor(owner)
        const options = record.options !== null && typeof record.options === 'object' ? record.options : {}
        const restored = {
          mode: typeof options.mode === 'string' ? options.mode : cached.mode,
          detail: typeof options.detail === 'string' ? options.detail : cached.detail,
          language: typeof options.language === 'string' ? options.language : cached.language,
          target: typeof options.target === 'string' ? options.target : cached.target,
          scenario: typeof options.scenario === 'string' ? options.scenario : cached.scenario,
        }
        Object.assign(cached, {
          status: 'generating',
          result: null,
          error: '',
          notice: '',
          noticeKind: 'info',
          rough: typeof record.rough === 'string' ? record.rough : cached.rough,
          pendingApply: null,
          restoreDraft: null,
          ...restored,
        })
        if (currentSessionRef.current === owner) {
          setStatus('generating')
          setResult(null)
          setError('')
          setNotice('')
          if (typeof record.rough === 'string') setRough(record.rough)
          setMode(restored.mode)
          setDetail(restored.detail)
          setLanguage(restored.language)
          setTarget(restored.target)
          setScenario(restored.scenario)
        }
        const controller = new AbortController()
        generationControllers.set(owner, controller)
        activeGenerations += 1
        try {
          const result = await pollBackgroundJob(owner, record.jobId, controller.signal)
          publishGeneration(owner, {
            status: 'ready',
            result,
            error: '',
            notice: '',
            noticeKind: 'info',
            pendingApply: null,
            unseen: true,
          })
          if (result !== null && typeof result === 'object' && result.meta !== null && typeof result.meta === 'object' && result.meta.source === 'model') {
            recordHistory(result, typeof record.rough === 'string' ? record.rough : '', owner)
          }
          if (currentSessionRef.current === owner) setTab('analysis')
        } catch (failure) {
          if (controller.signal.aborted) return
          const message = messageOf(failure)
          publishGeneration(owner, {
            status: 'error',
            result: null,
            error: message,
            notice: '',
            noticeKind: 'warn',
            pendingApply: null,
          })
        } finally {
          if (generationControllers.get(owner) === controller) generationControllers.delete(owner)
          activeGenerations = Math.max(0, activeGenerations - 1)
        }
      }

      // Recover a Host job after a page reload/session remount.
      React.useEffect(() => {
        const record = readJobRecord(sessionId)
        if (record === null) return
        if (generationControllers.has(sessionId)) return
        void resumeBackgroundJob(sessionId, record)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [sessionId])

      const runGenerate = async (textOverride, options) => {
        const opts = options === undefined || options === null ? {} : options
        const owner = sessionId
        const ownerIsCurrent = () => mountedRef.current && currentSessionRef.current === owner
        const text = typeof textOverride === 'string'
          ? textOverride.trim()
          : typeof rough === 'string' ? rough.trim() : ''
        if (text.length < 2) {
          setError(t('err.empty'))
          return
        }
        if (text.length > MAX_INPUT_CHARS) {
          setError(t('err.tooLong'))
          return
        }
        const previousController = generationControllers.get(owner)
        if (previousController === undefined && activeGenerations >= MAX_ACTIVE_GENERATIONS) {
          setNotice(t('status.busy'))
          setNoticeKind('warn')
          return
        }
        if (readJobRecord(owner) !== null) await cancelBackgroundForSession(owner)
        if (previousController !== undefined) {
          try {
            previousController.abort()
          } catch {
            // ignore
          }
        }
        const canCall = executeCommand !== undefined
          && typeof owner === 'string' && owner !== ''
        writeDiagnostic({
          stage: 'generate-start',
          hasResolver: executeCommand !== undefined,
          sessionIdKind: typeof owner,
          textLength: text.length,
        })

        const clarifications = Array.isArray(opts.clarifications) ? opts.clarifications : []
        if (clarifications.length === 0 && ownerIsCurrent()) setPendingApply(null)

        Object.assign(generationFor(owner), {
          status: 'generating',
          result: null,
          error: '',
          notice: '',
          noticeKind: 'info',
          pendingApply: null,
          restoreDraft: null,
          rough: text,
          mode,
          detail,
          language,
          target,
          scenario,
          startedAt: Date.now(),
          unseen: false,
        })

        // A new generation never inherits the previous result.
        if (ownerIsCurrent()) {
          setResult(null)
          setRestoreDraft(null)
          setTab('analysis')
          setError('')
          setNotice('')
          setConfirmReplace(false)
          setClarifyAnswers({})
          setClarifyDismissed(false)
          setRevisionOpen(false)
          setRevisionNote('')
          setDiffTarget(null)
          if (typeof opts.previousPrompt !== 'string' || opts.previousPrompt === '') setRevisionDepth(0)
        }

        if (!canCall) {
          writeDiagnostic({ stage: 'no-resolver', hasResolver: executeCommand !== undefined, sessionIdKind: typeof owner })
          const local = buildLocalResult(text, { mode, detail, language, target, scenario })
          publishGeneration(owner, {
            status: 'ready',
            result: local,
            error: t('err.fallback') + ' · ' + t('err.remote'),
            notice: '',
            noticeKind: 'warn',
            pendingApply: null,
          })
          if (ownerIsCurrent()) setTab('analysis')
          return
        }

        setStatus('generating')
        const controller = new AbortController()
        generationControllers.set(owner, controller)
        activeGenerations += 1
        const request = { rough: text, mode, detail, language, target, scenario }
        if (clarifications.length > 0) request.clarifications = clarifications
        if (typeof opts.previousPrompt === 'string' && opts.previousPrompt !== '') {
          request.previousPrompt = opts.previousPrompt
          request.revisionNote = typeof opts.revisionNote === 'string' ? opts.revisionNote : ''
        }
        const line = '/' + COMMAND_NAME + ' ' + JSON.stringify(request)
        try {
          let execution
          const backgroundResult = await startBackgroundJob(owner, request, controller.signal)
          if (backgroundResult !== null) {
            execution = { result: { kind: 'success', text: JSON.stringify({ ok: true, data: backgroundResult }) } }
          } else {
            execution = await executeCommand(owner, line, controller.signal)
          }
          if (execution === undefined || execution === null || execution.result === undefined || execution.result === null) {
            throw new Error(t('err.badPayload'))
          }
          if (execution.result.kind !== 'success' || typeof execution.result.text !== 'string') {
            throw new Error(typeof execution.result.text === 'string' ? execution.result.text : t('err.badPayload'))
          }
          let payload
          try {
            payload = JSON.parse(execution.result.text)
          } catch {
            throw new Error(t('err.badPayload'))
          }
          if (payload === null || typeof payload !== 'object' || payload.ok !== true || payload.data === undefined) {
            throw new Error(payload !== null && typeof payload === 'object' && typeof payload.error === 'string'
              ? payload.error
              : t('err.badPayload'))
          }
          if (controller.signal.aborted) return
          writeDiagnostic({
            stage: 'ok',
            promptChars: typeof payload.data.prompt === 'string' ? payload.data.prompt.length : -1,
            translation: typeof payload.data.translation === 'string',
            source: payload.data.meta !== null && typeof payload.data.meta === 'object' ? payload.data.meta.source : undefined,
          })
          const dataMeta = payload.data.meta !== null && typeof payload.data.meta === 'object' ? payload.data.meta : {}
          const gaps = payload.data.analysis !== null && typeof payload.data.analysis === 'object'
            && Array.isArray(payload.data.analysis.gaps) ? payload.data.analysis.gaps : []
          const sourceOriginal = typeof opts.original === 'string' ? opts.original : text
          let pending = null
          let deferred = false
          let applyNow = false
          if (opts.autoApply === true) {
            if (gaps.length > 0 && dataMeta.source === 'model') {
              pending = sourceOriginal
            } else if (gaps.length === 0) {
              if (ownerIsCurrent()) applyNow = true
              else {
                pending = sourceOriginal
                deferred = true
              }
            }
          }
          publishGeneration(owner, {
            status: 'ready',
            result: payload.data,
            error: '',
            notice: deferred ? t('status.backgroundReady') : pending !== null ? t('gate.pendingApply') : '',
            noticeKind: deferred || pending !== null ? 'warn' : 'info',
            pendingApply: pending,
            unseen: !ownerIsCurrent(),
          })
          if (applyNow) applyRefined(payload.data, opts.original, owner)
          if (payload.data.meta !== null && typeof payload.data.meta === 'object' && payload.data.meta.source === 'model') {
            recordHistory(payload.data, text, owner)
          }
          if (ownerIsCurrent()) {
            setTab('analysis')
            if (typeof opts.previousPrompt === 'string' && opts.previousPrompt !== '') {
              setRevisionDepth((value) => Math.min(5, value + 1))
            }
          }
        } catch (failure) {
          if (controller.signal.aborted) return
          const failureMessage = messageOf(failure)
          writeDiagnostic({ stage: 'error', message: failureMessage.slice(0, 800) })
          const local = buildLocalResult(text, { mode, detail, language, target, scenario })
          publishGeneration(owner, {
            status: 'ready',
            result: local,
            error: t('err.fallback') + (failureMessage === '' ? '' : ' · ' + failureMessage.slice(0, 320)),
            notice: '',
            noticeKind: 'warn',
            pendingApply: null,
          })
          if (ownerIsCurrent()) setTab('analysis')
        } finally {
          if (generationControllers.get(owner) === controller) generationControllers.delete(owner)
          activeGenerations = Math.max(0, activeGenerations - 1)
        }
      }

      const cancelGenerate = () => {
        const record = readJobRecord(sessionId)
        if (record !== null && executeCommand !== undefined) {
          void executeCommand(
            sessionId,
            '/' + BACKGROUND_CANCEL_COMMAND + ' ' + JSON.stringify({ jobId: record.jobId }),
            undefined,
          ).catch(() => {})
        }
        clearJobRecord(sessionId)
        const controller = generationControllers.get(sessionId)
        if (controller !== undefined) {
          try {
            controller.abort()
          } catch {
            // ignore
          }
          generationControllers.delete(sessionId)
        }
        publishGeneration(sessionId, { status: 'idle' })
      }

      const submitClarifications = () => {
        if (result === null) return
        const gaps = result.analysis !== null && typeof result.analysis === 'object' && Array.isArray(result.analysis.gaps)
          ? result.analysis.gaps
          : []
        const answers = []
        for (let index = 0; index < gaps.length; index += 1) {
          const choice = typeof clarifySelections[index] === 'string' ? clarifySelections[index].trim() : ''
          const note = typeof clarifyAnswers[index] === 'string' ? clarifyAnswers[index].trim() : ''
          const answer = [choice, note].filter((part) => part !== '').join(' / ')
          if (answer !== '') answers.push({ question: String(gaps[index]), answer })
        }
        if (answers.length === 0) {
          setNotice(t('gate.needOne'))
          setNoticeKind('warn')
          return
        }
        setNotice('')
        void runGenerate(rough.trim(), {
          clarifications: answers,
          autoApply: pendingApply !== null,
          original: pendingApply !== null ? pendingApply : undefined,
        })
      }

      const skipClarifications = () => {
        setClarifyDismissed(true)
        setClarifyAnswers({})
        setClarifySelections({})
        setGateIndex(0)
        setNotice('')
        if (pendingApply !== null && result !== null) {
          const source = pendingApply
          setPendingApply(null)
          applyRefined(result, source)
          return
        }
        setTab('prompt')
      }

      const openRevision = () => {
        if (revisionDepth >= 5) {
          setNotice(t('revision.limit'))
          setNoticeKind('warn')
          return
        }
        setRevisionOpen(true)
      }

      const applyRevision = () => {
        if (result === null) return
        if (revisionDepth >= 5) {
          setNotice(t('revision.limit'))
          setNoticeKind('warn')
          return
        }
        const note = revisionNote.trim()
        if (note.length < 2) {
          setNotice(t('revision.needNote'))
          setNoticeKind('warn')
          return
        }
        setNotice('')
        setRevisionOpen(false)
        void runGenerate(rough.trim(), {
          previousPrompt: result.prompt,
          revisionNote: note,
          autoApply: false,
        })
      }

      const activeText = () => {
        if (result === null) return ''
        if (tab === 'translation' && typeof result.translation === 'string' && result.translation !== '') return result.translation
        return typeof result.prompt === 'string' ? result.prompt : ''
      }

      const insertText = (replaceDraft) => {
        const text = activeText()
        if (text.trim() === '') return
        if (inputActions === undefined || inputActions === null) {
          setNotice(t('status.blocked'))
          setNoticeKind('warn')
          return
        }
        const currentDraft = typeof draftRef.current === 'string' ? draftRef.current.trim() : ''
        if (currentDraft !== '' && currentDraft === text.trim()) {
          setNotice(t('status.alreadyInserted'))
          setNoticeKind('info')
          setConfirmReplace(false)
          return
        }
        if (replaceDraft) {
          if (typeof inputActions.setDraft !== 'function') {
            setNotice(t('status.blocked'))
            setNoticeKind('warn')
            return
          }
          try {
            inputActions.setDraft(text)
            sessionActions.noteApplied(text)
            setNotice(t('status.replaced'))
            setNoticeKind('ok')
            setConfirmReplace(false)
          } catch {
            setNotice(t('status.blocked'))
            setNoticeKind('warn')
          }
          return
        }
        if (typeof inputActions.captureInsertion !== 'function' || typeof inputActions.insertText !== 'function') {
          setNotice(t('status.blocked'))
          setNoticeKind('warn')
          return
        }
        try {
          const span = inputActions.captureInsertion()
          const inserted = inputActions.insertText(text, span)
          if (inserted === true) sessionActions.noteApplied(text)
          setNotice(inserted === true ? t('status.inserted') : t('status.blocked'))
          setNoticeKind(inserted === true ? 'ok' : 'warn')
        } catch {
          setNotice(t('status.blocked'))
          setNoticeKind('warn')
        }
      }

      const requestReplace = () => {
        const draftText = typeof draft === 'string' ? draft.trim() : ''
        if (draftText === '') {
          insertText(true)
          return
        }
        setConfirmReplace(true)
      }

      const copyText = () => {
        const text = activeText()
        if (text === '' || typeof navigator === 'undefined' || navigator.clipboard === undefined) {
          setCopyState('failed')
          return
        }
        try {
          navigator.clipboard.writeText(text).then(() => setCopyState('copied'), () => setCopyState('failed'))
        } catch {
          setCopyState('failed')
        }
      }

      const generating = status === 'generating'

      const modeItems = [
        { value: 'agent', label: t('option.mode.agent') },
        { value: 'spec', label: t('option.mode.spec') },
      ]
      const detailItems = [
        { value: 'concise', label: t('option.detail.concise') },
        { value: 'standard', label: t('option.detail.standard') },
        { value: 'detailed', label: t('option.detail.detailed') },
      ]
      const languageItems = [
        { value: 'auto', label: t('option.language.auto') },
        { value: 'zh', label: t('option.language.zh') },
        { value: 'en', label: t('option.language.en') },
      ]
      const targetItems = [
        { value: 'generic', label: t('option.target.generic') },
        { value: 'claude-code', label: t('option.target.claude-code') },
        { value: 'codex', label: t('option.target.codex') },
        { value: 'cursor', label: t('option.target.cursor') },
      ]
      const SCENARIO_PRESETS = {
        general: { mode: 'agent', detail: 'standard' },
        coding: { mode: 'agent', detail: 'detailed' },
        writing: { mode: 'agent', detail: 'standard' },
        research: { mode: 'spec', detail: 'detailed' },
        data: { mode: 'spec', detail: 'detailed' },
        automation: { mode: 'agent', detail: 'detailed' },
      }
      const scenarioItems = [
        { value: 'general', label: t('option.scenario.general') },
        { value: 'coding', label: t('option.scenario.coding') },
        { value: 'writing', label: t('option.scenario.writing') },
        { value: 'research', label: t('option.scenario.research') },
        { value: 'data', label: t('option.scenario.data') },
        { value: 'automation', label: t('option.scenario.automation') },
      ]
      const applyScenario = (value) => {
        setScenario(value)
        const preset = SCENARIO_PRESETS[value]
        if (preset !== undefined) {
          setMode(preset.mode)
          setDetail(preset.detail)
        }
      }

      const hasTranslation = result !== null && typeof result.translation === 'string' && result.translation !== ''
      const activeTab = tab === 'translation' && !hasTranslation ? 'prompt' : tab
      const currentText = activeTab === 'translation' && result !== null && hasTranslation
        ? result.translation
        : result !== null && typeof result.prompt === 'string' ? result.prompt : ''
      const analysis = result !== null && result.analysis !== null && typeof result.analysis === 'object' ? result.analysis : {}
      const meta = result !== null && result.meta !== null && typeof result.meta === 'object' ? result.meta : {}
      const isLocal = meta.source === 'local'
      const gaps = result !== null && Array.isArray(analysis.gaps) ? analysis.gaps : []
      const showGate = result !== null && meta.source === 'model' && gaps.length > 0 && !clarifyDismissed
      const quality = meta.quality !== null && typeof meta.quality === 'object'
        && typeof meta.quality.score === 'number' && Array.isArray(meta.quality.checks)
        ? meta.quality
        : null
      const qualityScore = quality === null ? 0 : Math.max(0, Math.min(100, Math.round(quality.score)))
      const qualityLabel = qualityScore >= 90
        ? t('quality.ready')
        : qualityScore >= 70 ? t('quality.usable') : t('quality.needsWork')
      const currentGapIndex = Math.min(gateIndex, Math.max(0, gaps.length - 1))
      const currentGap = gaps.length > 0 ? String(gaps[currentGapIndex]) : ''
      const modelChoices = Array.isArray(analysis.gapChoices) && Array.isArray(analysis.gapChoices[currentGapIndex])
        ? analysis.gapChoices[currentGapIndex].filter((choice) => typeof choice === 'string' && choice.trim() !== '')
        : []
      const currentChoices = modelChoices.length > 0 ? modelChoices : defaultGapChoices(currentGap)
      const atLastGap = gateIndex >= gaps.length - 1

      const toggleChoice = (choice) => {
        const next = Object.assign({}, clarifySelections)
        if (next[currentGapIndex] === choice) delete next[currentGapIndex]
        else next[currentGapIndex] = choice
        setClarifySelections(next)
      }

      const skipCurrentGap = () => {
        const nextAnswers = Object.assign({}, clarifyAnswers)
        const nextSelections = Object.assign({}, clarifySelections)
        delete nextAnswers[currentGapIndex]
        delete nextSelections[currentGapIndex]
        setClarifyAnswers(nextAnswers)
        setClarifySelections(nextSelections)
        if (!atLastGap) setGateIndex(currentGapIndex + 1)
      }

      const goNextGap = () => {
        if (atLastGap) {
          submitClarifications()
          return
        }
        setGateIndex(currentGapIndex + 1)
      }

      const tabs = [
        { key: 'analysis', label: t('tab.analysis') },
        { key: 'prompt', label: t('tab.prompt') },
        ...(hasTranslation ? [{ key: 'translation', label: t('tab.translation') }] : []),
      ]

      const qualityPane = quality === null
        ? null
        : h('div', { className: 'rcp-quality' },
          h('div', { className: 'rcp-quality-head' },
            h('span', { className: 'rcp-quality-score' }, String(qualityScore)),
            h('span', { className: 'rcp-quality-label' }, qualityLabel),
            h('span', { className: 'rcp-quality-note' }, t('quality.note'))),
          h('div', { className: 'rcp-quality-checks' },
            quality.checks.map((check) => h('span', {
              key: String(check.id),
              className: 'rcp-quality-check',
              'data-pass': check.pass === true ? 'true' : 'false',
            }, (check.pass === true ? '✓ ' : '✕ ') + t('quality.check.' + String(check.id))))))

      const analysisPane = h('div', { className: 'rcp-pane' },
        qualityPane,
        analysis.summary !== undefined && analysis.summary !== ''
          ? h('p', { className: 'rcp-quote' }, String(analysis.summary))
          : null,
        analysis.intent !== undefined && analysis.intent !== ''
          ? h('div', { className: 'rcp-row' },
            h('span', { className: 'rcp-intent' },
              h(IconSparkle, { size: 11 }),
              h('span', null, String(analysis.intent))))
          : null,
        h(ItemList, { title: t('section.deliverables'), items: analysis.deliverables }),
        h(ItemList, { title: t('section.constraints'), items: analysis.constraints }),
        h(ItemList, { title: t('section.assumptions'), items: analysis.assumptions }),
        h(ItemList, { title: t('section.gaps'), items: analysis.gaps, tone: 'warn' }),
        history.length > 0
          ? h('div', { className: 'rcp-history' },
            h('div', { className: 'rcp-history-head' },
              h('span', { className: 'rcp-section-title' }, t('history.title')),
              h('span', { className: 'rcp-history-note' }, t('history.note')),
              h('button', { type: 'button', className: 'rcp-link', onClick: clearHistory }, t('history.clear'))),
            h('div', { className: 'rcp-history-list' },
              history.map((entry) => h('div', { key: String(entry.id), className: 'rcp-history-item' },
                h('div', { className: 'rcp-history-main' },
                  h('div', { className: 'rcp-history-title' },
                    typeof entry.title === 'string' && entry.title !== '' ? entry.title : entry.prompt.slice(0, 40)),
                  h('div', { className: 'rcp-history-meta' },
                    historyTime(entry.at) + ' · ' + String(
                      entry.meta !== null && typeof entry.meta === 'object' && typeof entry.meta.target === 'string'
                        ? entry.meta.target
                        : 'generic'))),
                h('button', {
                  type: 'button',
                  className: 'rcp-btn rcp-btn-ghost',
                  onClick: () => loadHistoryEntry(entry),
                }, t('history.load')),
                result !== null
                  ? h('button', {
                    type: 'button',
                    className: 'rcp-link',
                    onClick: () => setDiffTarget(entry),
                  }, t('diff.compare'))
                  : null))))
          : null,
        (analysis.summary === undefined || analysis.summary === '')
          && (!Array.isArray(analysis.deliverables) || analysis.deliverables.length === 0)
          ? h('div', { className: 'rcp-empty' }, t('err.badPayload'))
          : null)

      const textPane = h('div', { className: 'rcp-pane' },
        currentText === ''
          ? h('div', { className: 'rcp-empty' }, t('err.badPayload'))
          : h('pre', { className: 'rcp-pre' }, currentText))

      const diff = diffTarget !== null && result !== null ? diffLines(diffTarget.prompt, result.prompt) : []
      const diffChanged = diff.some((line) => line.type !== 'same')
      const diffPane = diffTarget !== null && result !== null
        ? h('div', { className: 'rcp-diff' },
          h('div', { className: 'rcp-diff-head' },
            h('span', { className: 'rcp-section-title' }, t('diff.title')),
            h('span', { className: 'rcp-history-note' },
              (typeof diffTarget.title === 'string' ? diffTarget.title : '') + ' · ' + historyTime(diffTarget.at)),
            h('button', {
              type: 'button',
              className: 'rcp-link',
              onClick: () => setDiffTarget(null),
            }, t('diff.close'))),
          diffChanged
            ? h('div', { className: 'rcp-diff-body' },
              diff.map((line, index) => h('div', {
                key: 'diff-' + String(index),
                className: 'rcp-diff-line',
                'data-kind': line.type,
              }, (line.type === 'add' ? '+ ' : line.type === 'remove' ? '- ' : '  ') + line.text)))
            : h('div', { className: 'rcp-empty' }, t('diff.empty')))
        : null

      const revisionPane = revisionOpen && result !== null
        ? h('div', { className: 'rcp-revision' },
          h('div', { className: 'rcp-section-title' }, t('revision.title')),
          h('textarea', {
            className: 'rcp-revision-input',
            value: revisionNote,
            maxLength: 2000,
            placeholder: t('revision.placeholder'),
            'aria-label': t('revision.title'),
            onChange: (event) => setRevisionNote(event.target.value),
          }),
          h('div', { className: 'rcp-actions' },
            h('button', { type: 'button', className: 'rcp-btn rcp-btn-primary', onClick: applyRevision, disabled: generating },
              t('revision.apply')),
            h('button', {
              type: 'button',
              className: 'rcp-btn rcp-btn-ghost',
              onClick: () => {
                setRevisionOpen(false)
                setRevisionNote('')
              },
            }, t('revision.cancel'))))
        : null

      const gatePane = showGate
        ? h('div', { className: 'rcp-gate', role: 'group', 'aria-label': t('gate.title') },
          h('div', { className: 'rcp-gate-head' },
            h('span', { className: 'rcp-gate-title' }, t('gate.title')),
            h('span', { className: 'rcp-badge' }, String(gaps.length)),
            h('span', { className: 'rcp-gate-progress' }, String(currentGapIndex + 1) + ' / ' + String(gaps.length))),
          h('div', { className: 'rcp-gate-sub' }, t('gate.subtitle')),
          h('div', { className: 'rcp-gate-item' },
            h('span', { className: 'rcp-gate-q' }, currentGap),
            h('div', { className: 'rcp-gate-choices', role: 'group', 'aria-label': t('gate.choices') },
              currentChoices.map((choice, index) => h('button', {
                key: 'choice-' + String(index),
                type: 'button',
                className: 'rcp-choice',
                'data-active': clarifySelections[currentGapIndex] === choice ? 'true' : 'false',
                'aria-pressed': clarifySelections[currentGapIndex] === choice ? 'true' : 'false',
                onClick: () => toggleChoice(choice),
              }, choice))),
            h('span', { className: 'rcp-gate-hint' }, t('gate.supplement')),
            h('input', {
              className: 'rcp-gate-input',
              type: 'text',
              value: typeof clarifyAnswers[currentGapIndex] === 'string' ? clarifyAnswers[currentGapIndex] : '',
              placeholder: t('gate.supplementPlaceholder'),
              'aria-label': t('gate.supplement'),
              onChange: (event) => {
                const next = Object.assign({}, clarifyAnswers)
                next[currentGapIndex] = event.target.value
                setClarifyAnswers(next)
              },
            })),
          h('div', { className: 'rcp-gate-actions' },
            h('button', {
              type: 'button',
              className: 'rcp-btn rcp-btn-ghost',
              onClick: () => setGateIndex(Math.max(0, currentGapIndex - 1)),
              disabled: currentGapIndex === 0 || generating,
            }, t('gate.prev')),
            h('button', {
              type: 'button',
              className: 'rcp-btn rcp-btn-ghost',
              onClick: skipCurrentGap,
              disabled: generating,
            }, t('gate.skipOne')),
            h('button', {
              type: 'button',
              className: 'rcp-btn rcp-btn-primary',
              onClick: goNextGap,
              disabled: generating,
            }, atLastGap ? t('gate.apply') : t('gate.next')),
            h('button', {
              type: 'button',
              className: 'rcp-btn rcp-btn-ghost',
              onClick: skipClarifications,
            }, t('gate.skip'))),
          h('span', { className: 'rcp-gate-hint' }, t('gate.why')),
          pendingApply !== null ? h('div', { className: 'rcp-gate-hint' }, t('gate.pendingApply')) : null)
        : null

      const resultPane = h('div', { className: 'rcp-result' },
        diffPane,
        revisionPane,
        gatePane,
        h('div', { className: 'rcp-tabs' },
          tabs.map((item) => h('button', {
            key: item.key,
            type: 'button',
            className: 'rcp-tab',
            'data-active': activeTab === item.key ? 'true' : 'false',
            onClick: () => setTab(item.key),
          }, item.label)),
          h('span', { className: 'rcp-tab-grow' })),
        activeTab === 'analysis' ? analysisPane : textPane,
        h('div', { className: 'rcp-actions' },
          h('button', {
            type: 'button',
            className: 'rcp-btn rcp-btn-primary',
            onClick: () => insertText(false),
            disabled: currentText.trim() === '',
          }, h(IconArrowIn), h('span', null, t('action.insert'))),
          confirmReplace
            ? h(React.Fragment, null,
              h('span', { className: 'rcp-muted' }, t('action.confirmReplace')),
              h('button', {
                type: 'button',
                className: 'rcp-btn',
                onClick: () => insertText(true),
              }, t('action.confirmYes')),
              h('button', {
                type: 'button',
                className: 'rcp-btn rcp-btn-ghost',
                onClick: () => setConfirmReplace(false),
              }, t('action.confirmNo')))
            : h('button', {
              type: 'button',
              className: 'rcp-btn',
              onClick: requestReplace,
              disabled: currentText.trim() === '',
            }, t('action.replace')),
          h('button', {
            type: 'button',
            className: 'rcp-btn rcp-btn-ghost',
            onClick: copyText,
            disabled: currentText.trim() === '',
          }, h(IconCopy), h('span', null, copyState === 'copied' ? t('status.copied') : copyState === 'failed' ? t('status.copyFailed') : t('action.copy'))),
          restoreDraft !== null
            ? h('button', {
              type: 'button',
              className: 'rcp-btn rcp-btn-ghost',
              onClick: () => {
                if (inputActions === undefined || inputActions === null || typeof inputActions.setDraft !== 'function') {
                  setNotice(t('status.blocked'))
                  setNoticeKind('warn')
                  return
                }
                try {
                  inputActions.setDraft(restoreDraft)
                  sessionActions.noteApplied('')
                  setRestoreDraft(null)
                  setNotice(t('status.restored'))
                  setNoticeKind('ok')
                } catch {
                  setNotice(t('status.blocked'))
                  setNoticeKind('warn')
                }
              },
            }, t('action.restore'))
            : null,
          !revisionOpen
            ? h('button', {
              type: 'button',
              className: 'rcp-btn rcp-btn-ghost',
              onClick: openRevision,
              disabled: generating || isLocal || showGate || revisionDepth >= 5,
              title: revisionDepth >= 5 ? t('revision.limit') : undefined,
            }, h(IconRefresh), h('span', null, t('revision.open')))
            : null,
          history.length > 1 && result !== null && history[1].prompt !== result.prompt
            ? h('button', {
              type: 'button',
              className: 'rcp-btn rcp-btn-ghost',
              onClick: () => setDiffTarget(history[1]),
            }, t('diff.previous'))
            : null,
          h('span', { className: 'rcp-foot-grow' }),
          generating
            ? h('button', { type: 'button', className: 'rcp-btn rcp-btn-ghost', onClick: cancelGenerate }, t('action.cancel'))
            : h('button', { type: 'button', className: 'rcp-btn rcp-btn-ghost', onClick: () => runGenerate() }, h(IconRefresh), h('span', null, t('action.regenerate')))),
        h('div', { className: 'rcp-foot' },
          h('span', { className: 'rcp-badge', 'data-kind': isLocal ? 'local' : 'model' },
            isLocal
              ? t('status.local')
              : t('status.model') + ': ' + String(meta.provider === undefined ? '' : meta.provider) + ' / ' + String(meta.model === undefined ? '' : meta.model)),
          h('span', null, String(currentText.length) + ' ' + t('field.chars'))))

      return h('div', { className: 'rcp-popover', hidden: !open, 'data-rcp-panel': 'true', ref: popoverRef, style: { transform: 'translate(' + String(dragOffset.x) + 'px,' + String(dragOffset.y) + 'px)' } },
        h('div', { className: 'rcp-root' },
        h('style', null, CSS),
        h('div', { className: 'rcp-panel', role: 'region', 'aria-label': t('panel.title') },
          h('div', { className: 'rcp-head' },
            h('div', {
              className: 'rcp-head-main',
              title: t('aria.drag'),
              onPointerDown: onDragStart,
              onPointerMove: onDragMove,
              onPointerUp: onDragEnd,
              onPointerCancel: onDragEnd,
              onDoubleClick: () => setDragOffset({ x: 0, y: 0 }),
            },
              h('div', { className: 'rcp-title' }, h(IconSparkle, { size: 14 }), h('span', null, t('panel.title'))),
              h('div', { className: 'rcp-subtitle' }, t('panel.subtitle'))),
            h('button', {
              type: 'button',
              className: 'rcp-icon-btn',
              'aria-label': t('aria.collapse'),
              title: t('panel.close'),
              onClick: closePanel,
            }, h(IconX))),
          h('textarea', {
            ref: textareaRef,
            className: 'rcp-textarea',
            value: rough,
            'aria-label': t('field.label'),
            maxLength: MAX_INPUT_CHARS,
            placeholder: t('field.placeholder'),
            spellCheck: false,
            onChange: (event) => {
              setRough(event.target.value)
              if (error !== '') setError('')
            },
          }),
          h('div', { className: 'rcp-row' },
            h('button', { type: 'button', className: 'rcp-btn rcp-btn-ghost', onClick: gatherComposer },
              h(IconGather), h('span', null, t('field.gather'))),
            h('button', {
              type: 'button',
              className: 'rcp-btn rcp-btn-ghost',
              onClick: () => {
                setRough('')
                setError('')
                setNotice('')
                setResult(null)
                setStatus('idle')
                setRestoreDraft(null)
                setTab('analysis')
                setConfirmReplace(false)
              },
            }, t('field.clear')),
            h('span', { className: 'rcp-foot-grow' }),
            h('span', { className: 'rcp-muted' }, String(rough.length) + ' / ' + String(MAX_INPUT_CHARS) + ' ' + t('field.chars'))),
          h('div', { className: 'rcp-row' },
            h('span', { className: 'rcp-group-label' }, t('option.scenario')),
            scenarioItems.map((item) => h('button', {
              key: item.value,
              type: 'button',
              className: 'rcp-preset',
              'data-active': scenario === item.value ? 'true' : 'false',
              'aria-pressed': scenario === item.value ? 'true' : 'false',
              onClick: () => applyScenario(item.value),
            }, item.label))),
          h('div', { className: 'rcp-row' },
            h(Segmented, { label: t('option.mode'), items: modeItems, value: mode, onChange: setMode }),
            h(Segmented, { label: t('option.detail'), items: detailItems, value: detail, onChange: setDetail })),
          h('div', { className: 'rcp-row' },
            h(Segmented, { label: t('option.language'), items: languageItems, value: language, onChange: setLanguage }),
            h(Segmented, { label: t('option.target'), items: targetItems, value: target, onChange: setTarget })),
          h('div', { className: 'rcp-actions' },
            h('button', {
              type: 'button',
              className: 'rcp-btn rcp-btn-primary',
              onClick: () => runGenerate(),
              disabled: generating || rough.trim().length < 2,
            },
              generating ? h('span', { className: 'rcp-spin' }) : h(IconSparkle, { size: 13 }),
              h('span', null, generating ? t('status.generating') : t('action.generate'))),
            generating
              ? h('button', { type: 'button', className: 'rcp-btn rcp-btn-ghost', onClick: cancelGenerate }, t('action.cancel'))
              : null,
            h('span', { className: 'rcp-foot-grow' }),
            h('span', { className: 'rcp-muted' }, t('hint.panel'))),
          error !== '' ? h('div', { className: 'rcp-error', role: 'alert' }, error) : null,
          notice !== ''
            ? h('div', { className: 'rcp-notice', role: 'status', 'aria-live': 'polite', 'data-kind': noticeKind }, notice)
            : null,
          result !== null ? resultPane : null),
        ),
      )
    }

    /**
     * Compact composer control. With text in the composer it organizes that
     * text immediately (one click); with an empty composer it opens the panel
     * for typing/pasting. A second click collapses an open panel.
     */
    function CopilotTrigger(props) {
      const t = typeof props.t === 'function'
        ? props.t
        : (key) => key
      const useInput = typeof props.useInput === 'function' ? props.useInput : undefined
      const [sessionState, sessionActions] = useSessionStore(props.sessionId)
      const draft = useInput === undefined ? '' : useInput((state) => state.draft)
      const open = sessionState.open
      const background = sessionState.gen !== undefined
        && (sessionState.gen.unseen === true || (sessionState.gen.status === 'generating' && !open))
      return h('button', {
        type: 'button',
        className: 'rcp-trigger',
        'data-rcp-trigger': 'true',
        'data-open': open ? 'true' : 'false',
        'aria-expanded': open,
        'aria-label': open ? t('aria.collapse') : t('aria.expand'),
        title: open ? t('aria.collapse') : t('trigger.title') + ' — ' + t('trigger.hint'),
        onMouseDown: (event) => event.preventDefault(),
        onClick: () => {
          const cached = generationFor(props.sessionId)
          if (cached.unseen === true) {
            cached.unseen = false
            notifySession(props.sessionId)
          }
          if (open) {
            sessionActions.setOpen(false)
            return
          }
          const text = typeof draft === 'string' ? draft.trim() : ''
          const applied = typeof sessionState.appliedText === 'string' ? sessionState.appliedText.trim() : ''
          if (applied !== '' && text === applied) {
            sessionActions.setOpen(true)
            return
          }
          if (text.length >= 2) sessionActions.requestOrganize(draft)
          else sessionActions.setOpen(true)
        },
      }, h(IconSparkle, { size: 15 }), background
        ? h('span', { className: 'rcp-trigger-dot', 'data-rcp-background': 'true', 'aria-hidden': 'true' })
        : null)
    }

    // ------------------------------------------------------------------- apply

    function apply(ctx) {
      const attempt = (label, run) => {
        try {
          return run()
        } catch (error) {
          try {
            console.error('[requirement-copilot] ' + label + ': ' + String(error && error.message ? error.message : error))
          } catch {
            // ignore
          }
          return undefined
        }
      }

      attempt('locale', () => ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'requirement-copilot: locale'))

      const executeCommand = createCommandResolver(ctx)
      activeCommandResolver = executeCommand

      // Composer tool row: one compact trigger button beside the send area.
      attempt('trigger', () => ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
        name: 'conversation.input.right',
        id: 'requirement-copilot-trigger',
        order: 10,
        locale: NS,
      }, CopilotTrigger)))

      // Floating popover anchored to the top edge of the composer card.
      attempt('panel', () => ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
        name: 'conversation.input.overlay',
        id: 'requirement-copilot-panel',
        order: 10,
        locale: NS,
        inject: () => ({ executeCommand }),
      }, RequirementPanel)))

      // The command lifecycle is log-only, but the Chat target still renders a
      // command row. Hide every command this plugin dispatches so background
      // polling never appears in the visible transcript.
      for (const commandName of [COMMAND_NAME, BACKGROUND_START_COMMAND, BACKGROUND_STATUS_COMMAND, BACKGROUND_CANCEL_COMMAND]) {
        attempt('command-row:' + commandName, () => ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
          name: 'conversation.chat.commandview',
          key: commandName,
        }, function RequirementCommandRow() {
          return null
        })))
      }
    }

    return {
      inject: ['slots', 'locale'],
      apply,
      __testing: { generationFor, defaultGenerationState, MAX_ACTIVE_GENERATIONS },
    }
  },
})
