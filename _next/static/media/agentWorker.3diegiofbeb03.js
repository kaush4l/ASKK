/**
 * A sub-agent, running on its own named thread.
 *
 * One of these per agent that is called as a tool. The worker is created with
 * `{ name: <agent name> }`, so the agent's own identity is the thread's
 * identity — visible in devtools, and the reason two agents doing long work at
 * once are two threads rather than two turns.
 *
 * A sub-agent is given no sub-agent tools of its own. That is a depth limit,
 * not an oversight: agents that can call each other freely can call each other
 * in a cycle, and a cycle of threads that each spawn threads is a fork bomb on
 * the user's machine. One level down is enough to be useful and cannot recur.
 *
 * It runs on ITS OWN declared budget and it can be stopped. Both were missing:
 * `run` was called with no options at all, so a sub-agent file writing
 * `budget: {steps: 4}` got the 24-step default that the parent's spec parser had
 * already read and discarded, and nothing could interrupt it. The stop arrives
 * as a second message naming the task, because a signal does not survive
 * structured-clone — see `CANCEL` in the envelope for the whole of that
 * argument, which this file is one more instance of rather than a new idea.
 */
import { AgentCatalogue } from '../core/agent/AgentCatalogue.js'
import { delegableTools } from '../core/agent/delegable.js'
import { describeEnvironment } from '../core/agent/Environment.js'
import { buildAgent, resolveTools } from '../core/agent/loadAgent.js'
import { createInference } from '../core/inference/index.js'
import { Outcome, Reason } from '../core/Outcome.js'
import { Toolbox } from '../core/tools/Toolbox.js'
import { browserHttp } from './browserHttp.js'

/**
 * One catalogue per base path, built on the first message that names one.
 *
 * Not a module-scope constant off `process.env` any more: where the app is
 * served from is something the realm that started this thread already knows,
 * and it now arrives with the task. A worker that reads a build-time constant
 * for itself is a second place that has to be right about the deploy.
 *
 * Keyed rather than replaced so the fetched file stays cached across calls,
 * which is the whole reason `AgentCatalogue` holds one.
 */
const catalogues = new Map()

function catalogueFor(basePath = '') {
  const existing = catalogues.get(basePath)
  if (existing) return existing
  const made = new AgentCatalogue(basePath)
  catalogues.set(basePath, made)
  return made
}

/** Task id -> the stop for the run that is answering it. */
const running = new Map()

/**
 * A defect in here must not become a caller waiting eleven minutes.
 *
 * This handler is `async`, so anything it throws is an `unhandledrejection`
 * INSIDE the worker — which is not the `error` event a `Worker` object fires,
 * so the pool never hears it and nothing ever posts an answer for that id. The
 * caller then waits out the pool's whole backstop for a thread that died in
 * milliseconds. Nothing in this tree throws by design, and this is the seam
 * that makes a broken design assumption cost one failed call instead of a
 * hung turn.
 */
self.addEventListener('message', (event) => {
  answer(event).catch((err) => {
    const { id } = event.data ?? {}
    running.delete(id)
    self.postMessage({
      id,
      ...Outcome.failed(Reason.INTERNAL, `the ${self.name} thread failed: ${err?.message ?? err}`, {
        hint: 'This is a defect in the sub-agent thread, not in the agent file.',
      }).toJSON(),
    })
  })
})

async function answer(event) {
  const { id, name, task, settings, basePath, cancel } = event.data ?? {}

  if (cancel) {
    running.get(id)?.abort()
    return
  }

  // The stop is registered BEFORE the first await, not just before the run.
  // Everything below here is asynchronous — a fetch for the agent file on first
  // use, then a build — and a cancel that arrived during it used to find
  // nothing in `running` and be dropped, after which the thread ran its whole
  // budget for a caller that had already given up.
  const controller = new AbortController()
  running.set(id, controller)

  const spec = await catalogueFor(basePath ?? '').spec(name)
  if (!spec.ok) {
    running.delete(id)
    self.postMessage({ id, ...Outcome.failed(Reason.NOT_FOUND, spec.failure.message).toJSON() })
    return
  }

  const inference = createInference({
    kind: settings.kind,
    model: spec.value.model || settings.model,
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    temperature: spec.value.temperature ?? settings.temperature,
    maxTokens: spec.value.maxTokens,
    thinking: spec.value.thinking ?? settings.thinking,
  })

  // The sub-agent's OWN tools, off its own file, minus the ones a second realm
  // may not hold — `delegable.js` argues each refusal. This used to be the
  // literal `tools: []`, which made every sub-agent a model with no way to find
  // anything out: `agents/researcher/agent.md` declares `search` and `fetch`
  // and would have been handed neither.
  //
  // `peers` and `dispatch` are still absent, and that is the depth limit this
  // file's header argues for rather than an omission: with no peers to resolve,
  // a sub-agent naming another agent gets a note and no tool.
  const allowed = delegableTools(spec.value.tools)
  const tools = resolveTools({ names: allowed.names, services: { http: browserHttp } })

  // Read once per session by the catalogue and cached there, so this is a
  // map lookup on every turn after the first.
  const soul = await catalogueFor(basePath ?? '').soul()

  const agent = buildAgent({
    spec: spec.value,
    inference: inference.value,
    soul: soul.value,
    tools: tools.value,
    // The clock and the machine, and deliberately NOT the caller's file
    // listing: the file store is one realm up and no delegable tool opens it,
    // so naming files this agent cannot read would be a fact it can only be
    // misled by.
    context: describeEnvironment(),
  })
  if (!agent.ok) {
    running.delete(id)
    self.postMessage({ id, ...agent.toJSON() })
    return
  }

  // A sub-agent has no memory of its own: it is asked one complete question and
  // answers it. Keeping a transcript per sub-agent would make the same call
  // return different things at different times, which is not what a tool is.
  // Already aborted, before a single token was spent: a stop that arrived while
  // the file was being fetched is honoured here rather than ignored.
  const answered = await agent.value.run([{ role: 'user', text: task }], {
    // The sub-agent's OWN terms, off its own file. The parent's budget is not
    // shared: two agents spending one allowance would make the second one's
    // limit depend on how much the first had already used.
    budget: spec.value.budget,
    signal: controller.signal,
    // Something to say before there is an answer.
    //
    // A delegated run was one message: the task went down and, minutes later,
    // an answer came back. Nothing in between existed, so a thread that was
    // reading its fourth page and a thread that was wedged looked identical
    // from the only realm anyone is watching. This is one message per finished
    // pass, carrying WHAT the pass decided rather than its text — the parent's
    // view is already full of the parent's own tokens, and a second stream of
    // someone else's prose would bury it.
    onStep: ({ step, parsed }) => {
      self.postMessage({
        id,
        progress: {
          agent: name,
          step,
          // The tool names it called, or nothing when it answered. `result`
          // holds the calls verbatim on this contract, so the names are read
          // off the front of each call rather than invented here.
          // The NAMES, not the calls: an argument can be a page of text and
          // this is a status line, not a second transcript. Read with the
          // toolbox's own parser rather than a regex of this file's own — a
          // second reader of one grammar is the duplication `Toolbox` argues
          // against, and the label would drift from the call that ran.
          doing:
            parsed?.isAnswer === false
              ? Toolbox.parse(parsed?.answer ?? '')
                  .flat()
                  .map((call) => call.name)
              : [],
          answered: parsed?.isAnswer !== false,
        },
      })
    },
  })
  running.delete(id)
  // Every note the build made travels back with the answer. A tool the file
  // asked for and did not get is something the CALLING agent has to know, and
  // this thread is the only place that fact exists.
  const answer = answered.ok
    ? Outcome.ok(
        typeof answered.value === 'string' ? answered.value : answered.value.answer,
        answered.notes,
      )
    : answered
  const reply = [...allowed.notes, ...tools.notes, ...agent.notes].reduce(
    (outcome, note) => outcome.withNote(note),
    answer,
  )
  self.postMessage({ id, ...reply.toJSON() })
}

self.postMessage({ type: 'ready', name: self.name })
