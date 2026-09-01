/**
 * The driver. It knows how to talk to the endpoint and how to turn a crank; it
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
 * ── the scaffold contract ────────────────────────────────────────────────
 *
 *   id            string, filesystem-safe
 *   label         human name, for the results table only (NEVER put in a transcript)
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
 *   'malformed'  the reply did not fit the contract; `note` says how
 *
 * `parse` never throws and never fails the run: a reply that does not fit the
 * contract is a fact ABOUT the contract, which is exactly what is being
 * measured, so it becomes an event and the loop continues.
 *
 * ── how a run can end ──────────────────────────────────────────────────────
 *
 *   answered           a scaffold parsed a reply as its final answer
 *   tool               (never a stop) the loop continues
 *   scaffold-stop      the scaffold ended its own run; the reason is recorded
 *   cap                MAX_TURNS reached, recorded as an event
 *   transport-refused  the endpoint served a 200 and the tree's transport
 *                      REFUSED the reply — it was the model's private reasoning
 *                      on the answer channel, or no answer had begun. Ending the
 *                      run is what `ReActEngine.run` does with a transport
 *                      failure: "A transport failure ends the run and keeps its
 *                      message and hint."
 *   endpoint-error     no reply was served at all. Not the scaffold's fault and
 *                      not scored as one.
 *
 * `transport-refused` is applied to BOTH arms by the same code on the same
 * inputs, which is what makes it a constant of the experiment rather than a
 * thumb on the scale — and it is a departure the reference arm does not have
 * upstream, so `README.md` states it above the results and `scaffolds/
 * agent-zero.js` `CUTS` carries it as a row.
 *
 * THAT ROW IS NOT IN THE FIFTEEN TRANSCRIPTS THIS REPOSITORY SHIPS. It travels
 * into a transcript from the next run onward — `renderTranscript` writes every
 * `cuts` entry and `run.js` writes the array into each `<n>.json` — but the
 * fifteen in `transcripts/` were produced before the row existed and carry
 * twelve cuts, not thirteen (`jq '.cuts|length'`, measured). This sentence used
 * to say "every transcript carries the refusal verbatim", in the present tense,
 * about an artifact where a recursive grep for "the rig's transport" over every
 * agent-zero transcript matches none of the fifteen: the tenth instance of this
 * tree's signature defect, in the wave briefed to hunt it. Regenerating
 * `transcripts/` is what makes it present tense, and until that run happens the
 * count above is what a reader gets.
 *
 * Over the runs recorded in `transcripts/`, zero of agent-zero's 79 replies and
 * twelve of ours' 34 are refused.
 */

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
  const events = []
  const started = Date.now()
  const tokens = { prompt: 0, completion: 0, total: 0 }
  // Every distinct model that answered, in first-seen order. The rig asks for
  // one and this endpoint serves four; a run that was silently answered by a
  // different one is a result about a different experiment.
  const models = []

  const state = scaffold.init({ task, tools })
  let turns = 0
  let answer = ''
  let stop = 'cap'

  events.push({ type: 'task', at: 0, text: task.prompt })

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    turns = turn
    const built = scaffold.request(state)
    events.push({ type: 'request', at: turn, messages: built.messages })

    const reply = await transport.call(built.messages)
    if (reply.model && !models.includes(reply.model)) models.push(reply.model)

    if (!reply.answered) {
      // The endpoint broke. That is not the scaffold's fault and must not be
      // scored as one, so it ends the run with its own stop reason.
      events.push({
        type: 'endpoint-error',
        at: turn,
        error: reply.failure?.message ?? 'the endpoint served nothing',
        hint: reply.failure?.hint ?? '',
        ms: reply.ms,
      })
      stop = 'endpoint-error'
      break
    }

    // Counted before the refusal branch: a refused reply still cost tokens, and
    // a token total that omitted the expensive replies would flatter exactly the
    // arm that produced them.
    tokens.prompt += Number(reply.usage?.prompt_tokens ?? 0)
    tokens.completion += Number(reply.usage?.completion_tokens ?? 0)
    tokens.total += Number(reply.usage?.total_tokens ?? 0)

    events.push({
      type: 'reply',
      at: turn,
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

    if (!reply.ok) {
      // A 200 the transport refused. `ReActEngine.run` ends the run on a
      // transport failure and keeps its message and hint; so does this.
      //
      // "Refused" here means any failed Outcome over a body that parsed, which
      // includes `invoke`'s shape guard — a 200 whose choice carries no message
      // content at all. That is an endpoint-shape fault rather than a verdict on
      // the model's reply, and it would be filed under a stop reason whose own
      // documentation says the reasoning arrived on the answer channel. It is
      // not reachable on this endpoint and the event carries `state` so the
      // record can be told apart; if a second endpoint ever makes it reachable,
      // the branch needs to split rather than the reason to be reinterpreted.
      events.push({
        type: 'transport-refusal',
        at: turn,
        state: reply.state,
        message: reply.failure.message,
        hint: reply.failure.hint,
      })
      stop = 'transport-refused'
      break
    }

    const action = scaffold.parse(reply.content, state)
    events.push({ type: 'action', at: turn, action })

    if (action.kind === 'answer') {
      answer = String(action.text ?? '')
      stop = 'answered'
      break
    }

    // 'tool' and 'malformed' both come back through the scaffold, because what
    // a malformed reply is TOLD is part of the scaffold under test — agent-zero
    // sends a system_warning, ours sends a sentence about the missing call.
    const acted = await scaffold.act(action, state, tools)
    events.push({
      type: 'observation',
      at: turn,
      observation: acted.observation,
      ran: acted.ran ?? [],
    })
    // `usage` is `Inference._usage`'s own object — the same shape
    // `Budget.measure` is fed in production, by the same static that feeds it —
    // because one scaffold carries a real budget and a budget fed a rig-shaped
    // object would be a different budget from the one that ships. A scaffold
    // with nothing to spend ignores the field.
    scaffold.observe(state, {
      action,
      observation: acted.observation,
      turn,
      usage: reply.measured ?? { prompt: 0, completion: 0 },
    })

    // A scaffold may end its own run. agent-zero has a circuit breaker that
    // stops after five consecutive unusable model replies
    // (_90_stop_unusable_response_loop.py); ours has none. Which of them knows
    // how to give up is part of what is being measured, so the hook is
    // optional and the reason it gives is recorded verbatim.
    const own = scaffold.stopped?.(state)
    if (own) {
      events.push({ type: 'scaffold-stop', at: turn, reason: own })
      stop = 'scaffold-stop'
      break
    }
  }

  if (stop === 'cap') {
    // The cap is an EVENT, not a crash. A scaffold that spends twelve turns
    // going nowhere has told us something, and the transcript has to show it.
    events.push({ type: 'turn-cap', at: turns, limit: MAX_TURNS })
    scaffold.onCap?.(state)
  }

  return { events, turns, tokens, ms: Date.now() - started, answer, stop, models }
}
