/**
 * The driver. It knows how to talk to the endpoint and how to record a run; it
 * knows nothing about any scaffold.
 *
 * Everything that differs between the two harnesses under test — the system
 * prompt, the tool contract, how a reply is parsed into an action, how an
 * observation is folded back into the next request — is supplied by the
 * scaffold object. Adding a third scaffold is adding a file in `scaffolds/` and
 * a line in `run.js`. Nothing here changes.
 *
 * THE HTTP CALL IS NOT HERE. It is `bench/transport.js`, which is the tree's own
 * `src/core/inference/OpenAICompatible.js` with two documented overrides. This
 * file used to carry a private `callModel` — a fetch and a `message.content ??
 * ''` — and that made the comparison invalid: the arm labelled "ours" ran
 * without the classifier that is the whole of what our transport contributes.
 * `transport.js` has the measurement and the argument.
 *
 * THE LOOP IS NOT HERE EITHER, for an arm that has one. That is the second time
 * the same lesson was paid for one layer up. After the transport was made
 * genuine, `scaffolds/ours.js` still reimplemented our loop piecewise —
 * `engine.plan`, `responseModel.parse`, `engine.observe`, its own scratchpad
 * push, its own `stopped()` — and this file ended every run on `!reply.ok`.
 * Then `ReActEngine.run` learned to send `Reason.OVERRUN` back as a turn, and
 * the rig, which never called `run`, kept ending on it: 10 of 10 recoveries on
 * the real model in the engine, 0 of 8 in the comparison the bar is scored on
 * (`docs/LEDGER.md` row S62). A paraphrase of a loop drifts from the loop the
 * next time the loop changes, and it drifts silently, because the tests that
 * cover the loop cover the loop and not the paraphrase.
 *
 * So there are two ways through `drive`, and which one a scaffold takes is the
 * scaffold's to say:
 *
 *   `run` present   THE SCAFFOLD OWNS ITS RUN. The driver builds a recording
 *                   port around the shared transport, hands it in, and records
 *                   what the scaffold's loop reports. Our arm: `run` is
 *                   `ReActEngine.run`, and nothing in the rig decides a turn.
 *   `run` absent    THE DRIVER OWNS THE RUN, turn by turn, through the
 *                   piecewise contract below. The reference arm: its loop is
 *                   a JS paraphrase of a Python loop whatever file it lives in,
 *                   so it lives here where the paraphrase is one loop for any
 *                   arm that needs one, and `README.md` names it as that arm's
 *                   declared cost.
 *
 * WHY THE DRIVER ASKS, rather than every scaffold owning its run. The
 * alternative was to give the reference arm a `run` too — a `while` over the
 * same `request`/`parse`/`act`/`observe` it already has — and delete the loop
 * from this file. That moves the paraphrase; it does not remove it, and it
 * puts the loop and the recording in one file per arm, which is two places for
 * the event shape to drift apart. The event stream is what `blind.js` projects
 * and it has to be one shape for both arms, so the recording stays here in one
 * place, and the only thing a scaffold with its own loop is asked for is what
 * the recording cannot see from outside: what each pass decided.
 *
 * ── the scaffold contract ────────────────────────────────────────────────
 *
 *   id            string, filesystem-safe
 *   label         human name, for the results table only (NEVER put in a transcript)
 *   cuts          what the scaffold changed from what it would really send;
 *                 stamped into every transcript by `run.js`
 *
 * A scaffold with its own loop:
 *
 *   run({ task, tools, inference, signal, record }) -> { answer, ended }
 *       inference   the recording port. `invoke(prompt)` returns the
 *                   transport's own Outcome; `maxTokens` is the transport's.
 *       signal      pulled when the rig's turn cap is reached
 *       record      `action(action)` and `observation(text, ran)` — the two
 *                   events the port cannot see, in the shapes below
 *       answer      the final reply, or '' when there was none
 *       ended       '' when the loop answered or was stopped by the rig; the
 *                   loop's own reason, verbatim, when it ended its own run
 *
 * A scaffold driven by this file:
 *
 *   init({ task, tools })            -> state    opaque; the driver only carries it
 *   request(state)                   -> { messages: [{role, content}] }
 *   parse(replyText, state)          -> action
 *   act(action, state, tools)        -> { observation: string, ran: [...] }
 *   observe(state, { action, observation, turn, usage })  -> void   (mutates state)
 *   stopped?(state)                  -> string  non-empty ends the run, with that reason
 *   onCap?(state)                    -> void    the turn cap was reached
 *
 * An `action` is `{ kind, ... }` where kind is one of:
 *   'answer'     the run is over; `text` is the final reply
 *   'tool'       call a tool; the scaffold's `act` decides how
 *   'malformed'  the reply did not fit the contract; `reason` says how, `note`
 *                what the loop said about it
 *
 * `parse` never throws and never fails the run: a reply that does not fit the
 * contract is a fact ABOUT the contract, which is exactly what is being
 * measured, so it becomes an event and the loop continues.
 *
 * ── how a run can end ──────────────────────────────────────────────────────
 *
 *   answered           the loop produced its final answer
 *   tool               (never a stop) the loop continues
 *   scaffold-stop      the loop ended its own run; the reason is recorded
 *   cap                MAX_TURNS reached, recorded as an event
 *   transport-refused  the endpoint served a 200 and the tree's transport
 *                      REFUSED the reply, and the loop ended on it. For the
 *                      reference arm that is every refusal. For a loop that is
 *                      `ReActEngine.run` it is a refusal that is not
 *                      `Reason.OVERRUN` — an overrun is sent back as a turn,
 *                      recorded as a `malformed` action and the loop's own
 *                      observation, and a second one in a row ends the run
 *                      through the loop's own ceiling, as `scaffold-stop`.
 *   endpoint-error     no reply was served at all. Not the scaffold's fault and
 *                      not scored as one.
 *
 * `transport-refused` is applied to BOTH arms by the same code on the same
 * inputs, which is what makes it a constant of the experiment rather than a
 * thumb on the scale — and it is a departure the reference arm does not have
 * upstream, so `README.md` states it above the results and `scaffolds/
 * agent-zero.js` `CUTS` carries it as a row. What each arm's LOOP does with a
 * refusal is that loop's own behaviour, and that difference is a finding.
 */

import { Outcome, Reason } from '../src/core/Outcome.js'
import { RigTransport } from './transport.js'

/** No scaffold may exceed this. Recorded as an event, not thrown. */
export const MAX_TURNS = 12

export const DEFAULTS = Object.freeze({
  baseUrl: 'http://127.0.0.1:8873/v1',
  model: 'Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp',
  // Same for every scaffold. The endpoint is the constant in this experiment.
  temperature: 0,
  seed: 7,
  maxTokens: 1200,
  // On, and NOT a rig setting: `agents/main/agent.md` declares no `thinking:`
  // line and `DEFAULT_SETTINGS.thinking` is true, so this is what the app runs.
  // It is spelled here so a reader of the results can see it was not quietly
  // turned off — with thinking off, `OpenAICompatible._state`'s last line calls
  // the same replies CUT instead of THINKING and most of the refusals below
  // disappear without a single one of them having been measured.
  thinking: true,
  // One call to a 27B on this host runs ~15 tok/s, so a full-length reply is
  // well over a minute. The ceiling is generous on purpose: a call cut short by
  // the rig would be scored as the scaffold's failure.
  requestTimeoutMs: 300_000,
})

/** The transport, built from a run's config. One per run, both arms alike. */
function transportFor(cfg) {
  return new RigTransport({
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
    timeout: cfg.requestTimeoutMs,
    thinking: cfg.thinking,
    seed: cfg.seed,
  })
}

/**
 * What one run accumulates, and the one place a reply is written down.
 *
 * Both ways through `drive` record a reply through `reply` below, so the
 * event's shape, the token sum and the model list cannot differ by arm — and
 * the `endpoint-error` / `transport-refusal` events likewise. The reference
 * arm's loop and the recording port are two callers of one recorder.
 */
class Record {
  constructor() {
    this.events = []
    this.tokens = { prompt: 0, completion: 0, total: 0 }
    // Every distinct model that answered, in first-seen order. The rig asks for
    // one and this endpoint serves four; a run that was silently answered by a
    // different one is a result about a different experiment.
    this.models = []
  }

  /**
   * One reply from the transport, at one turn. Returns the ending it forces,
   * or '' when the loop may go on: a dead endpoint and a refusal are both
   * recorded here, but whether a refusal ends the run is the LOOP's decision,
   * so the caller reads `reply.failure.code` before taking the word.
   */
  reply(reply, at) {
    if (reply.model && !this.models.includes(reply.model)) this.models.push(reply.model)

    if (!reply.answered) {
      // The endpoint broke. That is not the scaffold's fault and must not be
      // scored as one, so it ends the run with its own stop reason.
      this.events.push({
        type: 'endpoint-error',
        at,
        error: reply.failure?.message ?? 'the endpoint served nothing',
        hint: reply.failure?.hint ?? '',
        ms: reply.ms,
      })
      return 'endpoint-error'
    }

    // Counted before the refusal branch: a refused reply still cost tokens, and
    // a token total that omitted the expensive replies would flatter exactly the
    // arm that produced them.
    this.tokens.prompt += Number(reply.usage?.prompt_tokens ?? 0)
    this.tokens.completion += Number(reply.usage?.completion_tokens ?? 0)
    this.tokens.total += Number(reply.usage?.total_tokens ?? 0)

    this.events.push({
      type: 'reply',
      at,
      // What the transport passed on, which is '' when it refused. The raw text
      // is NOT smuggled back in here: showing it would put the exact string the
      // refusal exists to withhold into the transcript a judge reads.
      content: reply.content,
      // `reasoning_content` is recorded and never returned as the reply. This
      // model puts several hundred tokens of working there before a single
      // character of content, and a scaffold that had to parse its own reasoning
      // out of its answer would be judged on the endpoint's habits rather than
      // on its own design. Both scaffolds get the same treatment, because the
      // shipped transport gives it to both.
      reasoning: reply.reasoning,
      finish: reply.finish,
      // 'whole' | 'cut' | 'thinking' | 'spent' — `OpenAICompatible._state`.
      state: reply.state,
      notes: reply.notes,
      model: reply.model,
      ms: reply.ms,
      usage: reply.usage,
    })
    return ''
  }

  /**
   * A 200 the transport refused, and the loop ended on.
   *
   * "Refused" here means any failed Outcome over a body that parsed, which
   * includes `invoke`'s shape guard — a 200 whose choice carries no message
   * content at all. That is an endpoint-shape fault rather than a verdict on
   * the model's reply, and it would be filed under a stop reason whose own
   * documentation says the reasoning arrived on the answer channel. It is
   * not reachable on this endpoint and the event carries `state` so the
   * record can be told apart; if a second endpoint ever makes it reachable,
   * the branch needs to split rather than the reason to be reinterpreted.
   */
  refusal(reply, at) {
    this.events.push({
      type: 'transport-refusal',
      at,
      state: reply.state,
      message: reply.failure.message,
      hint: reply.failure.hint,
    })
    return 'transport-refused'
  }
}

/**
 * The transport, as an `Inference` a loop can hold, that writes down every
 * call it carries.
 *
 * A capability that needs the outside world arrives as a port passed to a
 * constructor — the tree's own pattern, and `buildAgent({ inference })` is the
 * seam it already has. This is that port for the rig: what the engine calls
 * `invoke` on, and what the engine reads `maxTokens` off to name the ceiling
 * to the model. It carries ONE call at a time, which is what `RigTransport`
 * requires and what a loop that awaits each step guarantees.
 *
 * It does two things the transport alone does not, and both are the rig's and
 * not the arm's. It records: the request as sent, the reply as classified,
 * through the same `Record` the reference arm's loop writes to. And it holds
 * the rig's turn cap: the call after `MAX_TURNS` is not made, the signal the
 * loop was given is pulled instead, and the loop ends the way it ends when
 * its user presses stop. The cap belongs here rather than in the loop because
 * our engine has no turn cap of its own — its bounds are `Budget` and its
 * unsaid ceiling — and the rig's 12 has to fall on both arms identically. It
 * is the rig's ceiling, imposed at the one seam the rig owns for this arm,
 * and `README.md` says so where it reports a `cap`.
 *
 * The Outcome handed back is the transport's own, rebuilt from the record
 * `RigTransport.call` returns: `ok` and the text, or the failure's code,
 * message and hint, notes either way. That is serialisation and not
 * classification — `Failure.toJSON` is the three fields and nothing was
 * decided on the way through — and it is what lets the engine read
 * `Reason.OVERRUN` off it and take another turn, exactly as it does in
 * production.
 */
export class RecordingInference {
  constructor({ transport, record, cap = MAX_TURNS, stop }) {
    this.transport = transport
    this.record = record
    this.cap = cap
    this.stop = stop
    /** Calls made, which is turns taken. */
    this.sent = 0
    /** '' while the loop may go on; the rig's own stop reason once it may not. */
    this.ending = ''
    /**
     * The last reply as `RigTransport.call` classified it. The loop is handed
     * an Outcome and reads its code; the refusal's own words are here for the
     * scaffold to write into the action it records for that pass, so the
     * transcript says what the transport said and not a paraphrase of it.
     */
    this.lastReply = null
  }

  get maxTokens() {
    return this.transport.maxTokens
  }

  async invoke(prompt) {
    if (this.sent >= this.cap) {
      this.ending = 'cap'
      this.stop.abort()
      return Outcome.failed(Reason.UNAVAILABLE, `the rig's ${this.cap}-turn cap`)
    }
    this.sent += 1
    const at = this.sent
    // One user message carrying the whole prompt — the shape
    // `OpenAICompatible._body` builds in production, spelled here because the
    // rig's transport takes the array so the reference arm can send its two.
    const messages = [{ role: 'user', content: prompt }]
    this.record.events.push({ type: 'request', at, messages })

    const reply = await this.transport.call(messages)
    this.lastReply = reply
    const forced = this.record.reply(reply, at)
    if (forced) {
      this.ending = forced
    } else if (!reply.ok && reply.failure.code !== Reason.OVERRUN) {
      // A refusal the loop will end on. An overrun is NOT recorded here: the
      // loop takes it as a turn and reports that pass through `record.action`
      // and the observation it writes back, so it is a turn in the events and
      // not an ending. A loop that ends on the second overrun does so through
      // its own ceiling, and that is recorded as its own stop.
      this.ending = this.record.refusal(reply, at)
    }

    return reply.ok
      ? Outcome.ok(reply.content, reply.notes)
      : Outcome.failed(reply.failure.code, reply.failure.message, {
          hint: reply.failure.hint,
          notes: reply.notes,
        })
  }
}

/**
 * Run one scaffold over one task.
 *
 * Returns a transcript: an ordered list of events plus the totals. Nothing is
 * thrown for anything the model or a tool does — a crash would lose the record
 * of what went wrong, which is the only thing this rig produces.
 *
 * @returns {Promise<{events: object[], turns: number, tokens: object, ms: number,
 *   answer: string, stop: string, models: string[]}>}
 */
export async function drive({ scaffold, task, tools, config = {} }) {
  const cfg = { ...DEFAULTS, ...config }
  const transport = transportFor(cfg)
  const record = new Record()
  const started = Date.now()

  record.events.push({ type: 'task', at: 0, text: task.prompt })

  const finished = scaffold.run
    ? await recordOwnRun({ scaffold, task, tools, transport, record })
    : await driveTurns({ scaffold, task, tools, transport, record })

  return {
    events: record.events,
    turns: finished.turns,
    tokens: record.tokens,
    ms: Date.now() - started,
    answer: finished.answer,
    stop: finished.stop,
    models: record.models,
  }
}

/**
 * A scaffold that owns its loop, recorded.
 *
 * The scaffold is handed the port, the rig's stop and two ways to say what a
 * pass decided; it returns how its run ended. The rig's own endings win over
 * the loop's word for them — a dead endpoint, a refusal the loop ended on, or
 * the cap — because each of those is the rig's fact and the loop only sees
 * them as a failed call.
 */
async function recordOwnRun({ scaffold, task, tools, transport, record }) {
  const stop = new AbortController()
  const port = new RecordingInference({ transport, record, stop })
  const finished = await scaffold.run({
    task,
    tools,
    inference: port,
    signal: stop.signal,
    record: {
      action: (action) => record.events.push({ type: 'action', at: port.sent, action }),
      observation: (observation, ran = []) =>
        record.events.push({ type: 'observation', at: port.sent, observation, ran }),
    },
  })

  if (port.ending === 'cap') {
    // The cap is an EVENT, not a crash. A scaffold that spends twelve turns
    // going nowhere has told us something, and the transcript has to show it.
    record.events.push({ type: 'turn-cap', at: port.sent, limit: port.cap })
    return { turns: port.sent, answer: '', stop: 'cap' }
  }
  if (port.ending) return { turns: port.sent, answer: '', stop: port.ending }
  if (finished.ended) {
    record.events.push({ type: 'scaffold-stop', at: port.sent, reason: finished.ended })
    return { turns: port.sent, answer: '', stop: 'scaffold-stop' }
  }
  return { turns: port.sent, answer: String(finished.answer ?? ''), stop: 'answered' }
}

/**
 * The driver's own loop, for a scaffold that has none of its own.
 *
 * Kept for the reference arm, and it is the reference arm's declared cost:
 * agent-zero's loop is Python, and a JS loop that calls its prompt assembly,
 * its parser and its history in the order `agent.py` does is a paraphrase
 * wherever it lives. `README.md`, "Both arms carry a reconstruction", says so
 * before any result.
 */
async function driveTurns({ scaffold, task, tools, transport, record }) {
  const state = scaffold.init({ task, tools })
  let turns = 0
  let answer = ''
  let stop = 'cap'

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    turns = turn
    const built = scaffold.request(state)
    record.events.push({ type: 'request', at: turn, messages: built.messages })

    const reply = await transport.call(built.messages)
    const forced = record.reply(reply, turn)
    if (forced) {
      stop = forced
      break
    }
    if (!reply.ok) {
      // This loop has no turn to send a refusal back as; every refusal ends
      // it. That is a property of the paraphrase and not of agent-zero, whose
      // own loop has no transport that refuses — `CUTS` names it.
      stop = record.refusal(reply, turn)
      break
    }

    const action = scaffold.parse(reply.content, state)
    record.events.push({ type: 'action', at: turn, action })

    if (action.kind === 'answer') {
      answer = String(action.text ?? '')
      stop = 'answered'
      break
    }

    // 'tool' and 'malformed' both come back through the scaffold, because what
    // a malformed reply is TOLD is part of the scaffold under test — agent-zero
    // sends a system_warning.
    const acted = await scaffold.act(action, state, tools)
    record.events.push({
      type: 'observation',
      at: turn,
      observation: acted.observation,
      ran: acted.ran ?? [],
    })
    // `usage` is `Inference._usage`'s own object — the same shape
    // `Budget.measure` is fed in production, by the same static that feeds it.
    // A scaffold with nothing to spend ignores the field.
    scaffold.observe(state, {
      action,
      observation: acted.observation,
      turn,
      usage: reply.measured ?? { prompt: 0, completion: 0 },
    })

    // A scaffold may end its own run. agent-zero has a circuit breaker that
    // stops after five consecutive unusable model replies
    // (_90_stop_unusable_response_loop.py). Which loop knows how to give up is
    // part of what is being measured, so the hook is optional and the reason
    // it gives is recorded verbatim.
    const own = scaffold.stopped?.(state)
    if (own) {
      record.events.push({ type: 'scaffold-stop', at: turn, reason: own })
      stop = 'scaffold-stop'
      break
    }
  }

  if (stop === 'cap') {
    record.events.push({ type: 'turn-cap', at: turns, limit: MAX_TURNS })
    scaffold.onCap?.(state)
  }

  return { turns, answer, stop }
}
