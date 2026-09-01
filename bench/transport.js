/**
 * The rig's HTTP call, and it is the tree's own.
 *
 * ── why this file exists ────────────────────────────────────────────────────
 *
 * `bench/driver.js` used to carry its own `callModel`: a fetch, a `JSON.parse`,
 * and `message.content ?? ''`. A blind panel checked whether the rig used the
 * transport this project ships and found
 *
 *     grep -rn OpenAICompatible bench/   ->  3 hits, ALL PROSE IN COMMENTS
 *
 * so the arm labelled "ours" ran WITHOUT the one component of ours that decides
 * whether a reply is an answer at all. `src/core/inference/OpenAICompatible.js`
 * classifies every reply into four states and REFUSES two of them; the rig's own
 * fetch classified nothing and handed every string to the scaffold. Replayed
 * through `OpenAICompatible._state` over the 34 replies our arm recorded in
 * `transcripts/`:
 *
 *     whole 20 · thinking 12 · cut 2
 *
 * Twelve replies our production transport would have refused were parsed as
 * answers, across ten of fifteen runs, four of which the rig scored PASS. A
 * comparison whose own arm is a paraphrase of itself is not a comparison, which
 * is the argument `README.md`'s provenance table makes about every other
 * component and had not made about this one.
 *
 * So the rig imports the shipped class. Nothing here re-derives what it does:
 * `_state`, `_spent`, `_dumped`, `_cutNote`, the shape guard, the abort
 * handling, the HTTP-error messages and the JSON parse are all inherited and
 * none is repeated below.
 *
 * ── what is overridden, and why each override is not a reimplementation ─────
 *
 * NO BROWSER GLOBAL BLOCKS THE IMPORT. That was the suspected obstacle and it is
 * not real: `Inference._postJson` uses `fetch`, `AbortController`,
 * `AbortSignal` and `setTimeout`, all of which bun has. The obstacle is one
 * shape mismatch, stated here rather than worked around:
 *
 * 1. `OpenAICompatible._body` sends `messages: [{role:'user', content: prompt}]`
 *    — ONE user message carrying the whole assembled prompt. That is a real
 *    property of this app and `scaffolds/ours.js` preserves it deliberately. It
 *    is NOT a property of the reference arm: agent-zero builds its request as
 *    `[SystemMessage(content=system_text), *history_langchain]` —
 *    `vendor/agent-zero/agent.py:606-610`, vendored at the commit PROVENANCE.md
 *    pins so this line can be opened rather than taken on trust. (It read
 *    `agent.py:583` and could not be checked from this repository at all; 583 is
 *    the `remove_code_fences` join that BUILDS `system_text`, not the message
 *    array.) Collapsing the two into one would falsify the arm being compared
 *    against, and `scaffolds/agent-zero.js` `request` really does return that
 *    system message plus history. So `_body` is overridden to take
 *    the message ARRAY a scaffold built, and everything else in the body —
 *    model, temperature, max_tokens, the `chat_template_kwargs` that carry the
 *    thinking switch — comes from `super._body` and is not respelled here. A
 *    field added to the shipped body tomorrow arrives in this rig for free.
 *
 * 2. `seed`. The shipped body has none, because the app has no reason to pin
 *    one; this rig sends it because the brief asks for a seed where the endpoint
 *    honours one. It is added, identically for every scaffold, in the same
 *    override.
 *
 * 3. `_postJson` is wrapped to KEEP the endpoint's parsed reply. It changes
 *    nothing: it calls `super`, records, and returns what super returned. The
 *    transcript needs three things the `Outcome` interface does not carry —
 *    `finish_reason`, `reasoning_content` and the endpoint's own `usage` — and
 *    the alternative was a second fetch, which is the thing this file exists to
 *    delete. It also gets a fourth thing nobody was recording: `json.model`,
 *    WHICH MODEL ANSWERED. The rig sends the model it wants and this endpoint
 *    serves four of them (`curl /v1/models`: Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp,
 *    gemma-4-12B-it-qat-mxfp8, mlx-community--Qwen3.8-27B-8bit, MarkItDown), so
 *    "the same model for both arms" was an assumption about a server, made by
 *    code that was throwing away the server's answer to that exact question.
 *
 * Nothing else differs. `thinking` is left at the class default, which is `true`
 * — the same value production uses, because `agents/main/agent.md` declares no
 * `thinking:` line and `DEFAULT_SETTINGS.thinking` is `true`. Turning it off
 * here would silence most of the refusals this file exists to surface, by
 * changing the setting rather than by measuring it.
 */

import { OpenAICompatible } from '../src/core/inference/OpenAICompatible.js'

export class RigTransport extends OpenAICompatible {
  /**
   * `seed` is the only setting this class adds. Everything else — model,
   * baseUrl, temperature, maxTokens, timeout, thinking — is `Inference`'s and
   * `OpenAICompatible`'s, spelled once, there.
   */
  constructor(settings = {}) {
    super(settings)
    this.seed = settings.seed ?? null
    /**
     * The endpoint's last parsed 200, or null. See override 3 above.
     *
     * ONE CALL AT A TIME, and `driver.js` is what guarantees it: `drive` awaits
     * every `call` before the next, and `run.js` runs one arm at a time. This
     * field is a side channel between `_postJson` and `call`, so two overlapping
     * calls on one instance would give the transcript the fields of whichever
     * resolved last. Nothing in the signature says so, which is why it is said
     * here — a `-j 2` added to `run.js` has to give each run its own transport.
     */
    this.lastReply = null
  }

  /**
   * The shipped body, with the scaffold's message array in place of the single
   * user message, plus `seed`.
   *
   * `super._body('')` is called for its side of the work rather than copied: it
   * owns which sampling fields exist, and it owns the `chat_template_kwargs`
   * line that carries the thinking switch. The empty prompt it is handed is
   * overwritten on the next line and never leaves this function.
   */
  _body(messages, multimodal, streaming = false) {
    const body = super._body('', multimodal, streaming)
    body.messages = messages
    if (this.seed !== null && this.seed !== undefined) body.seed = this.seed
    return body
  }

  /** Record the endpoint's own reply, change nothing about it. */
  async _postJson(url, headers, body, stop) {
    const posted = await super._postJson(url, headers, body, stop)
    this.lastReply = posted.ok ? posted.value : null
    return posted
  }

  /**
   * One call, as the rig needs to record it.
   *
   * The classification is NOT redone here — `invoke` already did it, and its
   * verdict is legible from the Outcome it returned:
   *
   *   ok, no cut note      WHOLE     an answer
   *   ok, with a cut note  CUT       an answer that stopped mid-sentence
   *   failed               THINKING  the scratchpad arrived on the answer channel
   *                        SPENT     the tokens ran out before an answer began
   *
   * The state NAME is nevertheless wanted in the transcript, so it is asked for
   * a second time from the same static the class used — `_state`, with the same
   * three inputs and the same `thinking` — rather than inferred from the shape
   * of the failure message. Asking the classifier is not reimplementing it;
   * reading English out of a message would be.
   */
  async call(messages) {
    const started = Date.now()
    this.lastReply = null
    let usage = null
    const outcome = await this.invoke(messages, [], { onUsage: (u) => (usage = u) })
    const ms = Date.now() - started

    const raw = this.lastReply
    const choice = raw?.choices?.[0]
    const reasoning = choice?.message?.reasoning_content ?? choice?.message?.reasoning ?? ''
    const finish = choice?.finish_reason ?? ''
    const state = raw
      ? OpenAICompatible._state(finish, reasoning, choice?.message?.content, this.thinking)
      : ''

    return {
      // `answered` separates the two ways `outcome.ok` can be false. A refusal
      // came back from a 200 the endpoint served and is a fact about the run; a
      // dead endpoint is a fact about the machine and must not be scored as
      // either scaffold's. Derived from whether a body was parsed, never from
      // reading the failure's message.
      answered: Boolean(raw),
      ok: outcome.ok,
      state,
      finish,
      reasoning: typeof reasoning === 'string' ? reasoning : '',
      content: outcome.ok ? String(outcome.value ?? '') : '',
      notes: outcome.notes ?? [],
      failure: outcome.ok ? null : outcome.failure.toJSON(),
      // The endpoint's own token counts, kept in its own spelling because
      // `results.json` has been reporting these keys since the first run.
      usage: raw?.usage ?? {},
      // Normalised by `Inference._usage` — the same object `Budget.measure`
      // eats in production, which is what `scaffolds/ours.js` feeds its budget.
      measured: usage,
      // What actually answered, which is not necessarily what was asked for.
      model: typeof raw?.model === 'string' ? raw.model : '',
      ms,
    }
  }
}
