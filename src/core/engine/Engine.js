import { Role } from '../Message.js'
import { Outcome, Reason } from '../Outcome.js'
import { PromptBlock, PromptTemplate, Volatility } from '../prompt/PromptTemplate.js'

const DEFAULT_CUE = '[ASSISTANT]:'

/**
 * Abstract agent kernel. Subclasses implement one control loop.
 *
 * What lives here is everything a loop of any shape needs: the parameters, how
 * a prompt is rendered from them, and what one exchange with the model is.
 * `run` is the only thing a loop actually changes — which is the point of the
 * split, because the next loops (a phase graph, a single-shot pass) differ in
 * nothing else.
 *
 * Holds no transport and no storage: it is given an `Inference` and a list of
 * prior messages, and returns a parsed response. That is what lets it run in a
 * worker without knowing it is in one.
 */
export class Engine {
  /**
   * Stable name for messages and registries. NOT `constructor.name`: the
   * production bundle renames classes.
   */
  static LABEL = 'engine'

  /** The response contract this loop is written against. Subclasses set it. */
  static DEFAULT_RESPONSE = null

  constructor({
    name = 'agent',
    system = '',
    inference,
    responseModel,
    responseCue = DEFAULT_CUE,
    toolbox = null,
    // One tool call, written by the agent's author, run once before a run is
    // allowed to end. Empty for every agent that declares none, which is most
    // of them — see `ReActEngine.run` for what it does with the result and for
    // the argument about who judges it.
    check = '',
    // Facts about right now, as ordered [label, value] pairs. Rendered as one
    // block, last before the response contract — see `PromptTemplate` for why
    // the volatile blocks go at the end.
    context = [],
    // How the prompt is arranged. A template, not a hardcoded order, because
    // the best arrangement depends on what an agent actually carries — see
    // `PromptTemplate` for the two findings that decide the default.
    template = new PromptTemplate(),
  } = {}) {
    // No guard against a missing inference and none against constructing the
    // base directly. Both are mistakes in code rather than states the running
    // flow can reach, and `run` reports them as ordinary failures — visible in
    // the UI, on the same path as every other failure, instead of as a crash.
    this.name = name
    this.system = system
    this.inference = inference
    // A loop's own contract is the default, but an explicitly passed model wins
    // — including `null`, which means plain text with no contract at all.
    this.responseModel = responseModel === undefined ? new.target.DEFAULT_RESPONSE : responseModel
    this.responseCue = responseCue
    this.toolbox = toolbox
    this.check = check
    this.context = context
    this.template = template
  }

  /**
   * The prompt, as blocks.
   *
   * Every part of a prompt is one of these, each declaring how often its bytes
   * change. What order they go in is the template's business, not this method's
   * — which is what lets an agent file reorder the prompt without any code
   * knowing it did.
   *
   * @returns {PromptBlock[]}
   */
  blocks(history, scratchpad = [], budget = null) {
    const transcript = history
      .map((m) => `[${m.role === Role.ASSISTANT ? 'ASSISTANT' : 'USER'}]: ${m.text}`)
      .join('\n\n')

    return [
      // No heading. This block is the agent file's own body — the document
      // itself, headings and all — and labelling a document with a heading that
      // says it is a document adds a level without adding a distinction.
      new PromptBlock({
        id: 'instructions',
        body: this.system,
        volatility: Volatility.STATIC,
      }),
      // No heading: the toolbox renders its own, because what a tool listing
      // needs to say about itself is the toolbox's business.
      new PromptBlock({
        id: 'tools',
        body: this.toolbox?.render() ?? '',
        volatility: Volatility.STATIC,
      }),
      new PromptBlock({
        id: 'contract',
        body: this.responseModel?.instructions() ?? '',
        volatility: Volatility.STATIC,
      }),
      new PromptBlock({
        id: 'conversation',
        heading: 'CONVERSATION',
        body: transcript,
        // Grows only at its end, so each turn's transcript is a prefix of the
        // next one's. That is what makes it safe to put ahead of anything.
        volatility: Volatility.APPEND,
      }),
      // The agent's own working on THIS turn: what it did and what came back.
      // Separate from the conversation because it is not one — nobody said any
      // of it to anybody. Kept ahead of the context block for the same reason
      // the conversation is: it only ever grows at its end.
      new PromptBlock({
        id: 'scratchpad',
        heading: 'WORK SO FAR',
        body: scratchpad
          .map(({ action, observation }) => `action: ${action}\nobservation: ${observation}`)
          .join('\n\n'),
        volatility: Volatility.APPEND,
      }),
      new PromptBlock({
        id: 'context',
        heading: 'CONTEXT',
        body: this.renderContext(),
        // Carries a clock. Nothing after this can ever be reused.
        volatility: Volatility.VOLATILE,
      }),
      // Empty on almost every turn, and dropped from the prompt when it is.
      // The one thing it carries is the hand-over: the turn on which the budget
      // has no room left is told so, in words, before it is sent — see `Budget`
      // for the measurement that cut everything else this block used to say.
      new PromptBlock({
        id: 'budget',
        heading: 'BUDGET',
        body: budget?.render() ?? '',
        volatility: Volatility.VOLATILE,
      }),
      new PromptBlock({
        id: 'reminder',
        body: this.responseModel?.reminder() ?? '',
        volatility: Volatility.STATIC,
        // Static, and last on purpose — see `PromptBlock.tail`.
        tail: true,
      }),
      new PromptBlock({
        id: 'cue',
        body: this.responseCue,
        volatility: Volatility.STATIC,
        tail: true,
      }),
    ]
  }

  /**
   * The assembled prompt and the accounting that produced it.
   *
   * Returned together on purpose. A prompt you can only read as one string is a
   * prompt whose cost and cache behaviour you have to guess at; this is the
   * same text plus where the reusable prefix ends and what each block costs.
   */
  plan(history, scratchpad = [], budget = null) {
    return this.template.assemble(this.blocks(history, scratchpad, budget))
  }

  /**
   * The facts block's body.
   *
   * One line per fact, in the same shape as everything else the model is asked
   * to read and write here. Empty when nothing was supplied — an agent given no
   * context gets no heading promising some.
   */
  renderContext() {
    const lines = this.context
      .filter(([, value]) => value !== '' && value !== null && value !== undefined)
      .map(([label, value]) => `${label}: ${value}`)
    if (!lines.length) return ''
    // The lines and nothing else. There was a sentence introducing them, and it
    // was longer than the facts it introduced — a heading that already says
    // CONTEXT does not need a paragraph explaining that context follows.
    return lines.join('\n')
  }

  /**
   * One exchange: assemble, infer, parse. The whole of a turn with the model.
   *
   * `onPrompt` and `onDelta` are how a caller in another realm watches this
   * happen. They are optional and carry no result — everything that matters is
   * in the returned Outcome — so a caller that ignores them loses nothing but
   * the view.
   *
   * `signal` is the one argument here that is not about watching. It is the
   * user's stop, and it goes to the transport rather than being checked between
   * steps: a loop that only looks at a flag on its way round still leaves a
   * request open on the network for as long as the endpoint takes, which is
   * precisely the wait the user pressed the button to end.
   *
   * @returns {Promise<Outcome>} value is a parsed response, or raw text when
   *   this engine has no response contract.
   */
  async step(
    history,
    multimodal = [],
    { scratchpad = [], budget = null, signal = null, onPrompt, onDelta, onUsage } = {},
  ) {
    if (!this.inference) {
      return Outcome.failed(
        Reason.INTERNAL,
        `${this.constructor.LABEL}: no inference is configured`,
        {
          hint: 'Choose a model in settings.',
        },
      )
    }

    const assembled = this.plan(history, scratchpad, budget)
    const prompt = assembled.text
    // The pass is opened here and nowhere else, because here is the only place
    // the assembled cost is known. A provider that reports real usage replaces
    // the estimate a moment later; one that reports none leaves it standing,
    // and the block says which of the two happened.
    //
    // After `plan`, so the block the agent reads counts the calls that have
    // FINISHED — "2 of 24 used" while the third is being written is what a
    // spend report means, and counting the unsent one would bill for a prompt
    // the endpoint has not seen.
    budget?.open(assembled.total)
    // Announced before the call, not after: the point of showing the prompt is
    // to see what is about to be sent, including when the call then fails. The
    // whole plan goes out, not just the text — the block breakdown is the part
    // that explains the number.
    onPrompt?.(assembled)

    // `stream` and `invoke` return the same Outcome, so the only difference
    // here is whether anyone is listening. An inference that cannot stream
    // still answers through this branch — its base class emits one chunk.
    // `cacheAt` is the template's boundary, handed to the transport. A provider
    // that matches prefixes automatically ignores it; one that takes an explicit
    // breakpoint is told exactly where the repeating part ends, rather than
    // guessing at it or being given no breakpoint at all.
    const options = { onUsage, cacheAt: assembled.boundary, signal }
    const replied = onDelta
      ? await this.inference.stream(prompt, multimodal, { ...options, onDelta })
      : await this.inference.invoke(prompt, multimodal, options)
    if (!replied.ok) return replied

    // Parsing never fails: an unreadable reply becomes the answer field rather
    // than an error, so a badly formatted turn still says what the model said.
    const text = replied.value
    if (!this.responseModel) return Outcome.ok(text, replied.notes)
    return Outcome.ok(this.responseModel.parse(text), replied.notes)
  }

  /**
   * Drive the loop until it produces an answer.
   *
   * @param {Array<{role: string, text: string}>} _history
   * @param {{multimodal?: object[], budget?: object, signal?: AbortSignal,
   *   onPrompt?: (prompt: string) => void,
   *   onDelta?: (chunk: string, kind: string) => void,
   *   onStep?: (event: object) => void}} [_options]
   * @returns {Promise<Outcome>}
   */
  async run(_history, _options = {}) {
    return Outcome.failed(
      Reason.NOT_IMPLEMENTED,
      `${this.constructor.LABEL} does not implement run()`,
      { hint: 'This engine has no control loop; pick another in settings.' },
    )
  }
}
