import { Outcome, Reason } from '../Outcome.js'
import { Inference } from './Inference.js'
import { Modality, Multimodality } from './Multimodality.js'

/**
 * The OpenAI wire protocol — /v1/chat/completions.
 *
 * There is no provider table here on purpose. omlx, LM Studio, vLLM, Ollama and
 * api.openai.com are all this one class and differ only in `baseUrl`, so a new
 * server is a new setting rather than a new subclass.
 *
 * WHAT THIS FILE LEARNED, AND IT COST AN OBSERVED WRONG ACTION TO LEARN IT.
 *
 * A thinking model's reply has four states on this protocol, and this class
 * used to read only `message.content` and so could not tell them apart:
 *
 *   finish_reason  reasoning_content  what `content` is
 *   -------------  -----------------  ---------------------------------------
 *   stop           present            the answer, complete
 *   length         present            the answer, cut off mid-sentence
 *   length         ABSENT             THE RAW REASONING. Not an answer at all.
 *   length         present            ABSENT, or a bare newline. No answer was
 *                                     ever started.
 *
 * The third row is the one that ran a command. When the token limit bites while
 * the model is still inside its think block, the server has no finished
 * scratchpad to route, so it puts the whole scratchpad on the answer channel and
 * says nothing about having done so. There is never a `<think>` tag to look for.
 *
 * Returning that text as the model's answer is not a display bug. The reasoning
 * is a model REHEARSING the response format, so it contains lines like
 * `act: shell({"command": "uname -a"})` written as an example of what it might
 * do — and the response layer reads that as a decision and the toolbox runs it.
 * The agent then executes a command the model was only thinking about. That has
 * happened in this tree. `test/core/tools/Toolbox.test.js` drives a real
 * captured dump the whole way to the call that would have run.
 *
 * THE FOURTH ROW IS HERE BECAUSE THE THIRD ONE'S FIX SHIPPED CLAIMING IT DID
 * NOT EXIST. This file said "measured over ~60 calls, with no fourth state
 * seen", and a review then produced one 3/3 on the same endpoint inside an hour:
 * `gemma-4-12B-it-qat-mxfp8`, `max_tokens: 120`, `finish_reason: length`,
 * `reasoning_content` PRESENT — and `Object.keys(message)` is
 * `['role', 'reasoning_content']`, with no `content` key at all. Re-measured
 * here, 3/3 again, non-streaming and streamed; the captures are
 * `test/support/fixtures/spent-in-think.*`. What it cost while unclassified:
 * `invoke` fell through to the shape guard and told the user to check a base URL
 * that was correct, and `stream` — where the same state arrives as ONE content
 * delta containing a newline — returned `ok` with a one-character answer, which
 * is the exact "empty string that looks like a silent model" the shape guard
 * exists to prevent. A negative claim ("no fourth state") is a claim, and this
 * one was worth what every unmeasured claim in this tree is worth.
 *
 * The fix belongs HERE and nowhere downstream, because `finish_reason` and
 * `reasoning_content` exist only here. Every layer below this one is reasoning
 * about a string it has been told is an answer; a guard there would be a guess
 * about English, made by code that was handed a lie by this file.
 */

/** The four states above, named. `_state` is the only thing that assigns one. */
export const Reply = Object.freeze({
  WHOLE: 'whole',
  CUT: 'cut',
  THINKING: 'thinking',
  SPENT: 'spent',
})

/**
 * Above this ceiling, "raise max tokens" is not advice, it is noise.
 *
 * The refusals below used to name that lever unconditionally. In the running app
 * they were naming it at 131,072 — `AGENT_DEFAULTS.maxTokens`, which an agent
 * file takes by saying nothing — so the one number a reader was sent to change
 * was the one number that was not the cause. 8,192 is a line with measurements
 * behind it rather than a taste: scratchpads captured off this endpoint run
 * 423–2,131 characters on the prompts this tree sends, and 6,105 on the longest
 * task a review put through it — call it 1,500 tokens at the top. A ceiling
 * several times that is not the reason a reply stopped.
 */
const RAISABLE = 8192

export class OpenAICompatible extends Inference {
  static LABEL = 'openai-compatible'

  /**
   * `thinking` decides whether the model is allowed its scratchpad.
   *
   * The switch is real and it is the only one that works: `chat_template_kwargs:
   * {"enable_thinking": false}` turns thinking off, and `reasoning_effort` does
   * nothing at any value. What it is worth, measured here against this tree's own
   * step-1 prompt — the exact string `bun scripts/dryrun.js` prints — on the
   * testbed model, three samples each, `max_tokens: 2048` so a thinking reply has
   * room to FINISH rather than to measure its own cap:
   *
   *   thinking on   completion 450 / 673 / 636 tokens, wall 68.2 / 98.3 / 54.6 s
   *                 scratchpad 1,362 / 2,131 / 1,734 chars, answer 434–483 chars
   *   thinking off  completion 129 / 159 / 232 tokens, wall 10.6 /  9.1 /  8.3 s
   *                 no scratchpad, answer 527–1,024 chars
   *
   * Ranges, never averages: generation rate on this endpoint swings more than 3x
   * on identical input, so a mean of three would be a number about the machine's
   * mood. That is 1.9–5.2x the completion tokens and 5.2–11.8x the wall clock —
   * and the second row carries the finding nobody was looking for. WITH THINKING
   * OFF THE ANSWER GOT LONGER, every sample, 527–1,024 characters against
   * 434–483. The working does not disappear when the scratchpad does; it moves
   * into the field the user reads.
   *
   * Two other measurements of this same switch exist and neither reproduced
   * here, which is the useful part. An earlier version of this comment claimed
   * 2–4x from samples capped at 440 tokens, i.e. it measured its cap. A review
   * then measured 20–35x and saw one ON sample in three truncate at 2,048 tokens
   * into the dump state; against this tree's step-1 prompt none of three
   * truncated and the gap was a fifth of that. Same switch, same ceiling, same
   * endpoint, three answers — so the cost of thinking is a property of the TASK
   * and cannot be quoted as a constant. What survives all three is the sign.
   *
   * The default is nevertheless ON. Three reasons, in order:
   *
   *   1. Three samples of one task with no correctness oracle is not evidence
   *      that the shorter answers are as good — and the longer answers the OFF
   *      arm produced are a reason to think the saving is partly bookkeeping.
   *      This tree's rule is that a claim with no evidence is unverified.
   *   2. The goal is critiquing and improving code, which is the work thinking
   *      is for. Buying a 2–5x token saving by removing the model's working from
   *      a code-review agent is the wrong trade to make silently.
   *   3. The failure this file exists for is fixed by reading the fields, not by
   *      turning thinking off, and the truncation a review saw is a symptom of a
   *      LOW CEILING rather than of thinking: at 2,048 tokens a scratchpad that
   *      runs 1,500 leaves nothing for an answer. The agents here run at 131,072.
   *
   * So the honest shape of the trade is a condition and not a default: turn
   * thinking OFF where the ceiling is low enough that the scratchpad can eat the
   * whole of it, and leave it ON otherwise. That is a judgement per agent and per
   * endpoint, which is why it is now settable in three places instead of being a
   * constructor argument nothing could reach — `DEFAULT_SETTINGS.thinking`, an
   * agent file's `thinking:` line, and this argument. It shipped once as the
   * last of those alone, documented as the escape hatch from `_state`'s final
   * line, and `grep -rn thinking src/` found no caller that could set it.
   *
   * One measured thing argues the other way and is recorded rather than acted
   * on: with thinking ON the model sometimes leaves the contract's own `think`
   * field EMPTY (once in three) because it has already thought elsewhere, so
   * the run pays for reasoning twice and shows neither. That is worth settling
   * with an evaluation, not with a default.
   */
  constructor(settings = {}) {
    super(settings)
    this.thinking = settings.thinking !== false
  }

  async invoke(prompt, multimodal = [], { onUsage, signal } = {}) {
    const posted = await this._postJson(
      `${this.baseUrl}/chat/completions`,
      // Local servers ignore the key; sending an empty bearer would be rejected
      // by a real one with a confusing 401, so the header is omitted instead.
      this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {},
      this._body(prompt, multimodal),
      signal,
    )
    if (!posted.ok) return posted

    const usage = OpenAICompatible._usage(posted.value?.usage)
    if (usage) onUsage?.(usage)

    const choice = posted.value?.choices?.[0]
    const text = choice?.message?.content
    const reasoning = choice?.message?.reasoning_content ?? choice?.message?.reasoning
    const state = OpenAICompatible._state(choice?.finish_reason, reasoning, text, this.thinking)

    // Classified BEFORE the shape guard below, and that order is the whole of
    // the fourth state's fix. A reply with no `content` key is a well-formed
    // reply from a working endpoint whenever `finish_reason` says why it stopped
    // — sending the reader to check their base URL for it is blaming the one
    // thing that was right.
    if (state === Reply.SPENT) return this._spent(reasoning?.length ?? 0)

    if (typeof text !== 'string') {
      // A well-formed JSON body in an unexpected shape usually means the URL
      // points at something that is not this API. Say that, rather than
      // returning an empty string that looks like a silent model.
      return Outcome.failed(
        Reason.UNAVAILABLE,
        'openai-compatible: no message content in the reply',
        {
          hint: 'The endpoint answered, but not in the OpenAI chat-completions shape. Check the base URL ends in /v1.',
        },
      )
    }

    if (state === Reply.THINKING) return this._dumped(text.length)
    return state === Reply.CUT ? Outcome.ok(text, [this._cutNote(text.length)]) : Outcome.ok(text)
  }

  async stream(prompt, multimodal = [], { onDelta, onUsage, signal } = {}) {
    // Kept across frames so the end of the stream can be classified. The
    // reasoning is held in full rather than counted, because the only airtight
    // test for the dump is that the answer channel repeats the scratchpad byte
    // for byte — measured, and 960 characters is not a memory concern.
    let finish = null
    let reasoning = ''
    let repeated = ''

    const read = await this._postStream(
      `${this.baseUrl}/chat/completions`,
      this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {},
      this._body(prompt, multimodal, true),
      (frame) => {
        // The usage frame arrives last and carries no choices.
        const usage = OpenAICompatible._usage(frame?.usage)
        if (usage?.prompt) onUsage?.(usage)

        const choice = frame?.choices?.[0]
        if (choice?.finish_reason) finish = choice.finish_reason
        const delta = choice?.delta

        // Reasoning models send their scratchpad on a separate field, and it
        // can run for a long time before a single character of the answer
        // appears. It is shown, because silence is indistinguishable from a
        // hung request — but it is NOT returned, so it never becomes part of
        // the text the response contract is parsed from.
        const thought = delta?.reasoning_content ?? delta?.reasoning
        if (typeof thought === 'string' && thought) {
          reasoning += thought
          onDelta?.(thought, 'reasoning')
        }

        const piece = delta?.content
        if (typeof piece !== 'string' || !piece) return ''

        // The dump, caught in the act. On truncation this endpoint re-sends the
        // ENTIRE scratchpad as one `content` delta after having streamed it as
        // `reasoning_content` — 38 reasoning deltas then 1 content delta, the
        // same 960 characters, in the capture this test suite replays. It is
        // dropped rather than relabelled: the page has already been shown every
        // character of it once, and showing it twice under a second heading is
        // no better than showing it under the wrong one.
        if (reasoning && piece === reasoning) {
          repeated += piece
          return ''
        }

        onDelta?.(piece, 'text')
        return piece
      },
      signal,
    )
    // A broken stream still carries whatever arrived, and it is returned with a
    // note about the break rather than discarded — a partial answer is worth
    // more than a blank turn. Only a break that carried nothing at all has
    // nothing to hand back and stays a failure.
    const text = read.value?.text ?? ''
    if (!read.ok) {
      return text
        ? Outcome.ok(text, [`${read.failure.message} — showing the part that arrived`])
        : read.asFailure(read.failure.code, read.failure.message, read.failure.hint)
    }

    // Before the empty check below, not after. When the dump was suppressed
    // above there is no text left, and "the stream carried no text" would be a
    // true sentence pointing at the wrong problem. The fourth state is the same
    // argument again: it arrives here as one content delta holding a newline,
    // which is not text a user can read and not a shape worth blaming a URL for.
    const state = OpenAICompatible._state(finish, reasoning, text || repeated, this.thinking)
    if (state === Reply.SPENT) return this._spent(reasoning.length)
    if (state === Reply.THINKING) return this._dumped((text || repeated).length)

    if (!text) {
      return Outcome.failed(Reason.UNAVAILABLE, 'openai-compatible: the stream carried no text', {
        hint: 'The endpoint streamed frames in an unexpected shape. Check the base URL ends in /v1.',
      })
    }
    return state === Reply.CUT ? Outcome.ok(text, [this._cutNote(text.length)]) : Outcome.ok(text)
  }

  /**
   * Which of the four states a reply is in, from the only three things that
   * can distinguish them.
   *
   * The order of the tests is the argument:
   *
   *   - Anything that did not stop on `length` is whole. `stop`, a tool-call
   *     finish, or a server that reports nothing at all are all the ordinary
   *     case, and the ordinary case must not pay for this.
   *   - An answer channel with nothing readable on it, from a reply that ran out
   *     of tokens, is a reply whose answer never started. Blank rather than
   *     absent, because the streamed form of it is a single newline and a
   *     newline is not a short answer.
   *   - An answer channel that repeats the scratchpad verbatim is the dump,
   *     positively identified. Nothing else produces that.
   *   - Reasoning that arrived separately means the routing worked, so whatever
   *     is on the answer channel is an answer — a short one.
   *   - Otherwise there is no reasoning anywhere and the reply was cut off. If
   *     thinking was asked for, that reasoning went somewhere, and `content` is
   *     the only place left. If thinking was turned off there was none to
   *     misroute, so the reply is simply short.
   *
   * The last line is the one that can be wrong: a server with no reasoning
   * channel at all, asked to think, truncated mid-answer, is called a dump. The
   * cost of that mistake is real and worth stating plainly — `_dumped` REFUSES,
   * so the partial answer is discarded and the step ends; it is not shown with a
   * note. Against that, the cost of the opposite mistake is running a command
   * the model was rehearsing. The trade is deliberate, and `thinking: false` in
   * settings or in an agent file is what opts such a server out of it.
   */
  static _state(finishReason, reasoning, content, thinking = true) {
    if (finishReason !== 'length') return Reply.WHOLE
    if (!String(content ?? '').trim()) return Reply.SPENT
    if (content === reasoning) return Reply.THINKING
    if (reasoning) return Reply.CUT
    return thinking ? Reply.THINKING : Reply.CUT
  }

  /**
   * The refusal, and it is a refusal rather than a shrug on purpose.
   *
   * There is no honest partial answer to hand back here: what arrived is the
   * model's private working, and every downstream layer would treat it as
   * speech. Failing names the cause, names the lever, and — through
   * `ReActEngine` — ends the step instead of acting on it.
   */
  _dumped(chars) {
    return Outcome.failed(
      Reason.UNAVAILABLE,
      `openai-compatible: the reply ran out of tokens while the model was still thinking, so ${chars.toLocaleString('en-US')} characters of its private reasoning arrived on the answer channel`,
      {
        hint: `That text is not an answer and was not passed on — read as one it would have run tool calls the model was only rehearsing. ${this._remedies()}`,
      },
    )
  }

  /**
   * The same ending with none of the evidence: the tokens ran out before the
   * answer began.
   *
   * Separate from `_dumped` because the two are opposite accidents and a reader
   * needs to know which one happened. In the dump the routing FAILED and the
   * scratchpad is in front of you wearing an answer's clothes; here the routing
   * WORKED, the scratchpad is on its own channel where it belongs, and there is
   * simply no answer — the model spent its whole budget thinking.
   */
  _spent(reasoningChars) {
    const thought = reasoningChars
      ? `, after ${reasoningChars.toLocaleString('en-US')} characters of reasoning on its own channel`
      : ''
    return Outcome.failed(
      Reason.UNAVAILABLE,
      `openai-compatible: the reply ran out of tokens before the model wrote any answer${thought}`,
      {
        hint: `The endpoint answered correctly and there is nothing to show — the whole budget went on thinking. ${this._remedies()}`,
      },
    )
  }

  /**
   * What to actually do about a reply that ran out of tokens.
   *
   * The ceiling is named only where naming it is advice. Both refusals used to
   * say "raise max tokens (currently N)" whatever N was, which at 131,072 sends
   * a reader to change the one setting that cannot be the cause — and, until the
   * `thinking` switch was wired to settings and agent files, the other half of
   * the sentence pointed at a lever nothing in the app could pull either. A
   * remedy that cannot be carried out is worse than no remedy: it costs the
   * reader the time to try it.
   */
  _remedies() {
    return this.maxTokens <= RAISABLE
      ? `Raise max tokens (currently ${this.maxTokens.toLocaleString('en-US')}), ask for something narrower, or set thinking to false for this model.`
      : `The limit is already ${this.maxTokens.toLocaleString('en-US')} tokens, so raising it is not the answer: ask for something narrower, or set thinking to false for this model.`
  }

  _cutNote(chars) {
    return `the reply was cut off at the ${this.maxTokens.toLocaleString('en-US')}-token limit after ${chars.toLocaleString('en-US')} characters, so it may stop mid-sentence`
  }

  /**
   * The request body. One builder for both calls, because the two used to carry
   * separate copies of the same five fields and a switch added to one of them
   * would silently apply to half the app's turns.
   */
  _body(prompt, multimodal, streaming = false) {
    const body = {
      model: this.model,
      messages: [{ role: 'user', content: this._content(prompt, multimodal) }],
      temperature: this.temperature,
      max_tokens: this.maxTokens,
    }
    // Sent only to turn thinking OFF. A server that has never heard of the key
    // is not asked to ignore one, and the default stays exactly what it was.
    if (!this.thinking) body.chat_template_kwargs = { enable_thinking: false }
    if (streaming) {
      body.stream = true
      // A streamed reply carries no usage unless this is asked for, and
      // without it the token count would have to be guessed for exactly the
      // calls this app makes. Measured: without it, ZERO frames carry usage.
      body.stream_options = { include_usage: true }
    }
    return body
  }

  /** A bare string when nothing is attached, else the multipart content array. */
  _content(prompt, multimodal) {
    if (!multimodal?.length) return prompt

    const parts = [{ type: 'text', text: prompt }]
    for (const item of multimodal) {
      for (const url of item.urls) {
        if (item.type === Modality.IMAGE) {
          parts.push({ type: 'image_url', image_url: { url } })
        } else if (item.type === Modality.AUDIO) {
          const [mime, payload] = Multimodality.split(url)
          parts.push({
            type: 'input_audio',
            input_audio: { data: payload, format: mime.split('/').pop() },
          })
        } else {
          // Some OpenAI-compatible servers accept video, most ignore it.
          parts.push({ type: 'video_url', video_url: { url } })
        }
      }
    }
    return parts
  }
}
