import { loopBudgetValue } from './loop-budget.js'
import { toolActivity } from './tool-activity.js'
/**
 * The agent engine — the skeleton's loop, one per thread.
 *
 *     const engine = new Engine({ name, systemPrompt, soul, llm, tools, context, ... })
 *     engine.listen((event) => ...)
 *     const answer = await engine.invoke('hello')     // never throws
 *
 * Port of the skeleton's `core/engine.py` (BaseEngine + ReActEngine as one class, because a
 * base engine is a ReAct engine whose first reply is always `done`). The loop:
 *
 *     heard → compress → render → stream → parse (repair) → done? answer : act → observe → repeat
 *
 * The sheet: soul, job, learned, tools, context, conversation, response format.
 * `render()` is the whole prompt. Read it and you have seen every token the model is sent.
 *
 * What this port adds, each from a named source (docs/rewrite/ARCHITECTURE.md §3):
 *   - tool results are cached only when the tool explicitly declares cacheability
 *   - budget warnings at 70% and 90% of the step budget ride on the observation     (Hermes)
 *   - at the step cap, one last call with no tools asks for the best answer          (Hermes)
 *   - every event carries enough to render the thread without asking it             (UX §U12)
 */

import { tokens } from './inference.js'
import { CompactReAct, SingleReAct, ReAct, responseModel } from './responses.js'
import { runToolResult } from './tools.js'
import { snapshot } from './prompt.js'
import { buildAgentPrompt } from './agent-prompt.js'
import { calibrationKey, reportedInputTokens } from './token-budget.js'

const FINAL_NOTE =
  '## THIS IS YOUR LAST STEP\n\nThe step budget is spent. Set do to done and give the best answer you ' +
  'have, saying plainly what is unfinished. No more tools.'

const STOPPED = 'stopped by the owner'

export class Engine {
  constructor(options) {
    this.name = options.name
    this.path = options.path ?? options.name
    this.description = options.description ?? ''
    this.systemPrompt = options.systemPrompt ?? ''
    this.soul = options.soul ?? ''
    this.learned = options.learned ?? '' // what experience taught this agent, accepted by the owner
    this.llm = options.llm // async () → inference, resolved per step so a model change reaches the next step
    this.contractVersion = options.contractVersion ?? 1
    if (![1, 2, 3].includes(this.contractVersion)) throw new Error(`unsupported contract version: ${this.contractVersion}`)
    if (this.contractVersion >= 2 && options.responseFormat && options.responseFormat !== 'json') throw new Error(`contract version ${this.contractVersion} requires JSON`)
    this.response = responseModel(options.shape ?? (this.contractVersion === 3 ? SingleReAct : this.contractVersion === 2 ? CompactReAct : ReAct), options.responseFormat ?? (this.contractVersion >= 2 ? 'json' : 'toon'))
    this.observationFormat = options.observationFormat ?? 'legacy'
    if (!['legacy', 'compact'].includes(this.observationFormat)) throw new Error(`unsupported observation format: ${this.observationFormat}`)
    this.historyFormat = options.historyFormat ?? 'transcript'
    if (!['transcript', 'messages'].includes(this.historyFormat)) throw new Error('Unsupported history_format')
    this.promptTemplate = options.promptTemplate
    this.outputReserve = options.outputReserve ?? null
    this.tools = options.tools ?? []
    this.context = options.context ?? []
    this.history = this.contractVersion === 2 ? (options.history ?? []).map(turn => {
      // Older v2 sessions stored accepted tool turns as their bare act array. Migrate only
      // that exact validated shape; user text, prose and malformed/live responses stay strict.
      if (turn.role !== 'assistant' || typeof turn.content !== 'string') return turn
      try {
        const act = JSON.parse(turn.content)
        const value = { do: 'tool', act }
        if (Array.isArray(act) && !CompactReAct.validate(value).length) return { ...turn, content: JSON.stringify(value) }
      } catch { /* Historical prose is not an action. */ }
      return turn
    }) : options.history ?? []
    this.maxSteps = loopBudgetValue('maxSteps', options.maxSteps)
    this.repairs = loopBudgetValue('repairs', options.repairs)
    this.compactAt = options.compactAt ?? 0.9
    this.keep = loopBudgetValue('keep', options.keep)
    this.summarise = options.summarise ?? null // async (text) → summary, written by the compactor agent
    this.ctx = options.ctx ?? {}
    this.onHistory = options.onHistory ?? null
    this.verifyCompletion = options.verifyCompletion ?? options.ctx?.verifyCompletion ?? null
    this.listener = null
    this.inbox = []
    this.signal = null
    this.status = 'idle'
    this.goal = ''
    this.steps = 0
    this.calls = []
    this.results = new Map()
    this.running = []
    this.startedAt = 0
    this.error = ''
    this.lastModel = ''
    this.attempts = 0
    this.terminationReason = ''
    this.promptBudget = null
    this.tokenCalibrations = new Map()
    this.activeLLM = null
    this.runId = crypto.randomUUID()
    this.currentAttemptId = ''
  }

  listen(listener) {
    this.listener = listener
  }

  /** Tell the listener. With no listener the engine is silent and the run is unchanged. */
  emit(kind, name = '', value = '', extra = {}) {
    this.listener?.({ kind, name, value: typeof value === 'string' ? value : JSON.stringify(value), ...extra })
  }

  enter(status) {
    this.status = status
    this.emit('status', '', status, { slot: this.progress() })
  }

  /** The turn so far, measured rather than asked for. */
  progress() {
    const [first, ...others] = this.running
    return {
      agent: this.path,
      status: this.status,
      goal: this.goal,
      steps: this.steps,
      maxSteps: this.maxSteps,
      seconds: this.startedAt ? Math.round((Date.now() - this.startedAt) / 100) / 10 : 0,
      startedAt: this.startedAt,
      calls: this.calls.length,
      repeats: this.calls.length - new Set(this.calls).size,
      current: first ? `${first}${others.length ? ` +${others.length}` : ''}` : '',
      model: this.lastModel,
      error: this.error,
      attempts: this.attempts,
      terminationReason: this.terminationReason,
      inputTokens: this.promptBudget?.inputTokens ?? 0,
      outputReserve: this.promptBudget?.outputReserve ?? 0,
    }
  }

  /** Leave a note for a run under way. It is read before the next step, as a user turn. */
  nudge(note) {
    this.inbox.push(String(note))
  }

  heard() {
    while (this.inbox.length) {
      const note = this.inbox.shift()
      this.remember({ role: 'user', content: note, note: true })
      this.emit('heard', '', note, { step: this.steps + 1 })
    }
  }

  remember(turn) {
    this.history.push({ ...turn, at: Date.now() })
    this.onHistory?.(this.history)
  }

  async window() {
    return (this.activeLLM ?? await this.llm()).context()
  }

  /**
   * The whole prompt sheet, in the skeleton's order: soul, job, tools, context, conversation,
   * response format. The configured history format preserves a transcript or distinct messages,
   * so providers that cache a prefix can reuse it.
   */
  async render(note = '', { final = false } = {}) {
    const contextText = (await Promise.all(this.context.map((piece) => piece.name === 'budget' ? '__HARNESS_BUDGET__' : piece.render(this)))).filter(Boolean).join('\n')
    const llm = this.activeLLM ?? await this.llm()
    const rendered = buildAgentPrompt({
      soul: this.soul, job: this.systemPrompt, learned: this.learned, tools: this.tools,
      contextText, history: this.history, historyFormat: this.historyFormat, response: this.response, template: this.promptTemplate,
      window: Number(await llm.context()), outputReserve: Math.max(1, Number(this.outputReserve) || 0, Number(llm.settings?.maxOutputTokens) || 4096),
      structuredOutput: llm.settings?.structuredOutput,
      calibration: this.tokenCalibrations.get(calibrationKey(llm)),
      steps: this.steps, maxSteps: this.maxSteps, observationFormat: this.observationFormat, note, final,
    })
    this.promptBudget = rendered.budget
    return rendered
  }

  /** Fold older turns into one summary when the sheet nears the context window. */
  async compress() {
    if (!this.summarise || this.history.length <= this.keep + 1) return
    const { budget } = await this.render()
    if (budget.total <= this.compactAt * budget.window) return
    this.enter('compacting')
    const older = this.history.slice(0, -this.keep)
    let summary
    try {
      summary = await this.summarise(older.map((turn) => `${turn.role}: ${turn.content}`).join('\n\n'))
      if (typeof summary !== 'string' || !summary.trim() || /^\s*\((failed|incomplete|cancelled|interrupted):/i.test(summary) || this.signal?.aborted) throw new Error('compactor returned no usable summary')
      if (tokens(summary) >= tokens(older.map((turn) => turn.content).join('\n\n'))) throw new Error('summary did not reduce the history')
    } catch (error) {
      this.emit('compaction_failed', '', error?.message ?? String(error))
      return
    }
    this.history = [{ role: 'summary', content: summary, at: Date.now() }, ...this.history.slice(-this.keep)]
    this.onHistory?.(this.history)
    this.emit('compacted', '', `compacted history: ${older.length} turns → 1 summary`)
  }

  /** One model call, repaired if the reply will not parse. Never throws. */
  async step(final = false) {
    this.activeLLM = await this.llm()
    await this.compress()
    this.steps += 1
    this.enter('thinking')
    let note = final ? `\n\n${FINAL_NOTE}` : ''
    let raw = ''
    for (let attempt = 0; attempt <= this.repairs; attempt += 1) {
      this.activeLLM = await this.llm()
      const { sheet, messages, budget, layers, responseMode, toolNames, responseSchema } = await this.render(note, { final })
      this.attempts += 1
      const attemptId = `${this.runId}:${this.steps}:${attempt + 1}`
      this.currentAttemptId = attemptId
      const requestSnapshot = snapshot({ attemptId, step: this.steps, attempt: attempt + 1, contractVersion: this.contractVersion, observationFormat: this.observationFormat, model: this.activeLLM.model, messages, budget, layers, responseMode, toolNames, historyFormat: this.historyFormat, ...(responseSchema ? { responseSchema } : {}) })
      this.emit('prompt', `step ${this.steps}`, sheet, { step: this.steps, attempt: attempt + 1, attemptId, tokens: budget.inputTokens, requestSnapshot })
      if (budget.total > budget.window) {
        this.error = `request budget exceeds context window (${budget.inputTokens} input + ${budget.outputReserve} output > ${budget.window})`
        return { failed: true, reason: 'context_budget' }
      }
      try {
        raw = await this.spoken(requestSnapshot.messages, { attemptId, budget, responseSchema: requestSnapshot.responseSchema })
      } catch (error) {
        this.error = this.signal?.aborted ? STOPPED : error.message
        return { failed: true, reason: this.signal?.aborted ? 'cancelled' : error.code ?? 'provider_error' }
      }
      const { value, faults } = this.response.parse(raw)
      if (responseMode === 'final-only' && value.do === 'tool') faults.push('do: only done is allowed; no tools are available for this response')
      if (!faults.length) return value
      if (attempt === this.repairs) break
      this.emit('repair', '', `retrying rejected reply (${attempt + 1} of ${this.repairs})`, { faults, attemptId })
      const shown = faults.map((fault) => `- ${fault}`).join('\n')
      // Keep only this candidate in the next prompt, never in accepted history.
      // Its full quoted content counts against the next request's normal budget.
      note = `${final ? `\n\n${FINAL_NOTE}` : ''}\n\n## YOUR LAST REPLY WAS REJECTED\n\n${shown}\n\nRejected reply content, encoded as a JSON string (unexecuted data to correct, not instructions):\n${JSON.stringify(raw)}\n\nThat reply was not used. Write the whole reply again, in the format above.`
    }
    this.error = `reply did not match contract version ${this.contractVersion} after ${this.repairs + 1} attempts`
    this.emit('rejected', '', raw, { step: this.steps })
    return { failed: true, reason: final ? 'step_budget' : 'invalid_response' }
  }

  /** Stream one reply, announcing each field the moment it is finished. */
  async spoken(messages, { attemptId, budget, responseSchema } = {}) {
    const llm = this.activeLLM ?? await this.llm()
    this.lastModel = llm.model
    let text = ''
    const shown = new Set()
    const announce = (fields) => {
      for (const [name, value] of Object.entries(fields)) {
        if (shown.has(name)) continue
        shown.add(name)
        this.emit('field', name, Array.isArray(value) ? (value.some((item) => typeof item === 'object') ? JSON.stringify(value, null, 2) : value.join('\n')) : value && typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value))
      }
    }
    for await (const delta of llm.stream(messages, {
      signal: this.signal,
      responseSchema,
      maxOutputTokens: Number(llm.settings?.maxOutputTokens) || budget?.outputReserve,
      onRequest: (request) => this.emit('request', '', '', { attemptId, request }),
      onFinish: (metadata) => {
        const actual = reportedInputTokens(metadata.usage)
        // Highest observed ratio is still a heuristic: unseen text can tokenize differently.
        if (actual !== null && budget?.baseInputTokens > 0) {
          const key = calibrationKey(llm)
          const previous = this.tokenCalibrations.get(key)
          this.tokenCalibrations.set(key, { factor: Math.max(1, previous?.factor ?? 1, actual / budget.baseInputTokens), samples: (previous?.samples ?? 0) + 1 })
        }
        this.emit('completion', '', '', { attemptId, ...metadata })
      },
    })) {
      if (delta.kind === 'reasoning') {
        this.emit('reasoning', '', delta.text)
        continue
      }
      if (delta.kind !== 'text') continue
      text += delta.text
      this.emit('delta', '', delta.text)
      announce(this.response.fields(text))
    }
    announce(this.response.fields(text, true))
    return text
  }

  /** Run the reply's calls: each stage's calls at once, the stages in order. */
  async act(value) {
    const stages = this.response.calls(value)
    if (!stages.length) return 'no tool calls given; put them in act, or set do to done'
    const observations = []; const compact = this.observationFormat === 'compact'
    for (const stage of stages) {
      const waits = stage.every((call) => this.find(call.name)?.waits)
      this.running = stage.map((call) => call.text)
      this.enter(waits ? 'waiting' : 'calling')
      const results = await Promise.all(stage.map((call) => this.call(call, { includeIdentity: compact })))
      if (compact) observations.push(stage.map((call, index) => {
        const { text, ok, callId } = results[index]
        let result = text
        try {
          const project = this.find(call.name)?.projectObservation
          if (project) {
            const projected = project({ text, ok, name: call.name, args: call.args })
            if (projected?.then) {
              Promise.resolve(projected).catch(() => {}) // An invalid async hook must not leave an unhandled rejection.
              throw new TypeError('observation projectors must return synchronous JSON data')
            }
            result = snapshot(projected)
          }
        } catch (error) {
          // Projection cannot hide a raw receipt or change execution status.
          this.emit('projection_failed', call.name, error?.message ?? String(error), { callId })
        }
        return { callId, name: call.name, ok, result }
      }))
      else stage.forEach((call, index) => observations.push(`${call.text} -> ${results[index].text}`))
      this.running = []
      if (this.signal?.aborted) break
    }
    return compact ? JSON.stringify({ format: 'staged-v1', stages: observations }) : observations.join('\n')
  }

  find(name) {
    return this.tools.find((item) => item.name === name)
  }

  /** Run one call. Always resolves to `{text, ok}`. */
  async call(call, { includeIdentity = false } = {}) {
    const started = Date.now()
    const key = JSON.stringify([call.name, call.args])
    const callId = `${this.currentAttemptId || this.runId}:call:${this.calls.length + 1}`
    this.calls.push(key)
    this.emit('call', call.name, call.text, { callId, args: call.args, slot: this.progress() })
    const done = (text, ok, activity = {}) => {
      this.running = this.running.filter((running) => running !== call.text)
      this.emit('observation', call.text, text, { callId, ms: Date.now() - started, ok, activity, slot: this.progress() })
      return { text, ok, ...(includeIdentity ? { callId } : {}) }
    }

    const item = this.find(call.name)
    if (!item) return done(`no tool named "${call.name}"; available: ${this.tools.map((tool) => tool.name).join(', ') || 'none'}`, false)
    if (call.error) return done(`${call.name}: ${call.error}`, false)
    if (item.cacheable === true && !item.writes && this.results.has(key)) {
      return done(`(you already made this exact call; it was not run again) ${this.results.get(key)}`, true)
    }

    let args = call.args
    const names = Object.keys(item.parameters ?? {})
    if (this.contractVersion === 1 && 'value' in args && Object.keys(args).length === 1 && names.length && !names.includes('value')) args = { [names[0]]: args.value }

    const { text, ok } = await runToolResult(item, args, { ...this.ctx, signal: this.signal, caller: this.path, call: call.text, callId })
    if (ok && item.cacheable === true && !item.writes) this.results.set(key, text)
    return done(text, ok, toolActivity(item, { text, ok }, args))
  }

  /** Open a turn. The goal is new, so everything measured against it starts again. */
  begin(query) {
    this.goal = query
    this.steps = 0
    this.calls = []
    this.results = new Map()
    this.running = []
    this.startedAt = Date.now()
    this.error = ''
    this.attempts = 0
    this.terminationReason = ''
    this.promptBudget = null
    this.runId = crypto.randomUUID()
    this.currentAttemptId = ''
  }

  /** Take a task to an answer. Never throws: a run answers or says why it could not. */
  async invoke(query, { signal } = {}) {
    this.signal = signal ?? null
    this.begin(query)
    this.remember({ role: 'user', content: query })
    try {
      while (true) {
        this.heard()
        if (this.signal?.aborted) return this.finish('', STOPPED)
        const final = this.steps >= this.maxSteps
        if (final) this.emit('final', '', 'final summary, no tools')
        const value = await this.step(final)
        if (this.signal?.aborted) return this.finish('', STOPPED)
        if (value.failed) return final && value.reason === 'step_budget' ? this.finish(`Stopped at the step limit (${this.maxSteps} steps) without a valid final answer.`, '', 'step_budget') : this.finish('', this.error, value.reason)
        if (this.inbox.length && !final) {
          this.emit('superseded', '', 'A new owner instruction arrived; the pending proposal was discarded before dispatch.')
          continue
        }

        const answer = this.response.answer(value)
        const assistantContent = this.contractVersion === 3 ? JSON.stringify(value) : this.contractVersion === 2
          ? JSON.stringify({ do: value.do, act: value.do === 'tool' ? this.response.calls(value).map((stage) => stage.map(({ name, args }) => ({ name, args }))) : value.act })
          : answer || (typeof value.act === 'string' ? value.act : JSON.stringify(value.act)) || ''
        this.remember({ role: 'assistant', content: assistantContent })
        if (final) {
          return this.finish(answer || `Stopped at the step limit (${this.maxSteps} steps) without a final answer.`, '', 'step_budget')
        }
        if (value.do === 'done') {
          if (this.verifyCompletion) {
            let verification
            try {
              verification = await this.verifyCompletion({ answer, goal: this.goal, steps: this.steps, signal: this.signal })
            } catch (error) {
              verification = { ok: false, reason: error?.message ?? String(error) }
            }
            if (this.signal?.aborted) return this.finish('', STOPPED)
            const record = snapshot({ ok: verification?.ok === true, reason: String(verification?.reason ?? 'completion evidence was not accepted'), ...(verification?.evidence ? { evidence: verification.evidence } : {}) })
            this.emit('verification', '', record.reason, { verification: record })
            if (!record.ok) {
              this.remember({ role: 'observation', content: `Completion was rejected: ${record.reason}. Continue the task using the available tools; do not claim success without the required evidence.` })
              continue
            }
          }
          if (this.inbox.length) continue
          return this.finish(answer)
        }

        let observation = await this.act(value)
        if (this.signal?.aborted) return this.finish('', STOPPED)
        const spent = this.steps / this.maxSteps
        const crossed = (mark) => spent >= mark && (this.steps - 1) / this.maxSteps < mark
        const warning = spent >= 0.9 ? 'budget 90%' : crossed(0.7) ? 'budget 70%' : ''
        if (warning) {
          observation += `\n[${warning}: step ${this.steps} of ${this.maxSteps} — ${spent >= 0.9 ? 'answer next step' : 'start wrapping up'}]`
          this.emit('budget', '', warning)
        }
        this.remember({ role: 'observation', content: observation })
      }
    } catch (error) {
      if (this.signal?.aborted) return this.finish('', STOPPED)
      // Our own mistake. Still an answer, so the caller never has to catch.
      return this.finish('', `internal error: ${error?.message ?? error}`)
    }
  }

  finish(answer, error = '', reason = '') {
    this.running = []
    this.activeLLM = null
    this.terminationReason = error === STOPPED ? 'cancelled' : reason || (error ? 'failed' : 'completed')
    if (error) {
      this.error = error
      this.enter(this.terminationReason === 'cancelled' ? 'cancelled' : 'failed')
      this.emit(this.status === 'cancelled' ? 'cancelled' : 'error', '', error)
      return `(${this.status}: ${error})`
    }
    this.enter(reason === 'step_budget' ? 'incomplete' : 'done')
    this.emit('answer', '', answer, { status: this.status, terminationReason: this.terminationReason })
    return answer
  }
}
