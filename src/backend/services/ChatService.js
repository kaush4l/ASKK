import { describeEnvironment } from '../../core/agent/Environment.js'
import { buildAgent } from '../../core/agent/loadAgent.js'
import { createInference } from '../../core/inference/index.js'
import { Role } from '../../core/Message.js'
import { discoverMcpTools } from '../../core/mcp/index.js'
import { Outcome } from '../../core/Outcome.js'
import { EventName } from '../../protocol/Envelope.js'

/**
 * What a parsed response means, asked in one place.
 *
 * Each of these three questions was written twice — once for the STEP event the
 * page draws and once for the record that goes to storage — and the two
 * spellings had already drifted. `answer` was `?? ''` on the wire and a bare
 * `.answer` on the way to storage; `isAnswer` called a `null` parse answered on
 * the wire and unanswered on the way to storage, and only reached the second of
 * those, so the disagreement was latent rather than visible. Two spellings of
 * one rule is how `thinking` became a field only one writer had heard of; the
 * same argument is at the top of `Message`.
 */
const answerOf = (parsed) => (typeof parsed === 'string' ? parsed : (parsed?.answer ?? ''))
/** `!= null` rather than `!== null`: nothing here throws, including on `undefined`. */
const isAnswered = (parsed) =>
  parsed != null && (typeof parsed === 'string' || parsed.isAnswer !== false)
/** `think` is a list on the ReAct contract and a string on the simpler ones. */
const reasoningOf = (parsed) => [parsed?.think, parsed?.thinking].flat().filter(Boolean).join('\n')

/**
 * How many file names one prompt will carry.
 *
 * MEASURED against the alternative it replaces, which is a `list_files` tool,
 * and both halves are re-derivable because the strings are named here. The
 * workspace priced is `notes.md src/main.c plan-2.txt README.md src/util.c
 * data.json …` — ordinary agent-written paths, a mix of bare names and one
 * folder deep — through this tree's own `estimateTokens`. The line
 * `your files: <names>` costs 5 tokens at one file, 16 at five, 34 at twelve
 * and 104 at forty.
 *
 * The tool costs its rendering on every turn whether or not it is called. A
 * `list_files` written as tersely as it could honestly be —
 * `- list_files({})` and `List the names of your own files, as read_file wants
 * them.` — renders at 22 tokens through `Tool.render`, and then a whole round
 * trip, a ~900-token prompt and a reply, the first time a run needs to know
 * what exists.
 *
 * So the line is the better buy up to roughly forty files and the tool is
 * better past it, and forty is the cap for exactly that reason rather than
 * because a round number was wanted. Past it the listing SAYS it was cut: a
 * workspace that big has outgrown a fact in the prompt and wants the tool, and
 * the one thing that must not happen meanwhile is an agent certain it has seen
 * all of them. `WorkspaceThroughTheLoop.test.js` asserts that sentence against
 * the prompt the transport is handed, because a truncation nobody is told about
 * is the whole of what this cap could get wrong.
 */
const MAX_LISTED = 40

/**
 * The chat use case: take what the user typed, run the agent, keep the result.
 *
 * This is the only class that knows both the domain and the model. The Engine
 * has no storage and the repositories have no opinions about agents; joining
 * them is a use case, and it lives here.
 *
 * It is also where a run is narrated. The Engine reports what it is doing
 * through plain callbacks and knows nothing of the wire; turning those into
 * events on the call happens here, at the edge, where the request id is known.
 */
export class ChatService {
  // Named, not positional. Four of these six are shapeless objects and this
  // tree has no type checker, so a transposed pair of arguments is accepted
  // everywhere and fails three files away as `settings.get is not a function`.
  //
  // `conversations` is the `ConversationService`, not the repository it holds.
  // This class used to take the repository and write message rows onto it by
  // hand, which made it a second author of a schema it did not own: it wrote a
  // `thinking` field the domain model had never heard of and dropped it on the
  // next round trip, and none of `Message`'s repairs ran on the live chat path
  // at all. A use case that needs a conversation changed asks the use case that
  // owns conversations.
  constructor({
    conversations,
    settings,
    catalogue,
    pool,
    sandbox = null,
    http = null,
    files = null,
  } = {}) {
    this.conversations = conversations
    this.settings = settings
    this.catalogue = catalogue
    this.pool = pool
    // What a tool needs to reach the world. Handed to the agent builder, which
    // gives each tool only what that tool asked for.
    this.services = { sandbox, http, files }
    this._inference = null
    this._signature = ''
  }

  /**
   * One inference object per distinct configuration, reused across turns.
   *
   * Rebuilding per turn would be free for an HTTP transport and ruinous for
   * transformers.js, where construction loads the weights — every message would
   * pay the first message's cost.
   */
  async _inferenceFor(settings, spec) {
    // The agent file wins over the app-wide setting where it says anything at
    // all, so one agent can name its own model or run cooler than the rest
    // without a second settings screen.
    const resolved = {
      kind: settings.kind,
      model: spec.model || settings.model,
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      temperature: spec.temperature ?? settings.temperature,
      maxTokens: spec.maxTokens ?? settings.maxTokens,
      thinking: spec.thinking ?? settings.thinking,
    }
    const signature = JSON.stringify(resolved)
    if (this._inference && this._signature === signature) return Outcome.ok(this._inference)

    await this._inference?.close()
    const built = createInference(resolved)
    this._inference = built.value
    this._signature = signature
    return built
  }

  /**
   * The facts this turn is told, which is the clock and what the agent owns.
   *
   * The file NAMES and nothing else — no sizes, no tree, no contents. That is a
   * deliberate refusal of what the reference arm does: it hands its model a
   * recursive listing on all 79 of its turns, which is most of why it knows
   * what exists and most of why its runs cost 211,531 prompt tokens against
   * 31,939 (`bench/README.md`). Names are what the agent needs to decide
   * whether to call `read_file`; everything else it can go and ask for.
   *
   * Capped, and the cap SAYS SO. A workspace bigger than this is a workspace
   * whose listing has become the prompt, and silently showing the first hundred
   * would leave the agent certain it had seen all of them.
   *
   * Cheap in the right place too: the block is `Volatility.VOLATILE` and sits
   * after the conversation, so a listing that changes mid-run costs its own
   * length and does not push the transcript out of the reusable prefix. On this
   * endpoint there is no prefix to lose anyway — measured, `cached_tokens` is 0
   * and there is no cache field at all — so what it costs is exactly its size.
   */
  async _context(notes) {
    const context = describeEnvironment()
    if (!this.services.files) return context

    const listed = await this.services.files.list()
    // A store that cannot be read is the user's problem, not the model's: the
    // note goes to the page, and the prompt simply says nothing about files.
    if (!listed.ok) {
      notes.push(`your files could not be listed: ${listed.failure.message}`)
      return context
    }
    notes.push(...listed.notes)
    if (!listed.value.length) return context

    const names = listed.value.map((file) => file.path)
    const shown = names.slice(0, MAX_LISTED)
    const rest = names.length - shown.length
    context.push(['your files', shown.join(' ') + (rest ? ` (and ${rest} more, not listed)` : '')])
    return context
  }

  /**
   * Send a message and get the reply.
   *
   * The user's message is persisted BEFORE the model is called. A failed or
   * slow call must not lose what the user typed — on failure the turn is still
   * in the transcript, and they can retry rather than retype.
   *
   * `signal` is the third argument every handler may declare — the Kernel makes
   * one per call — and this is the only handler that has any use for one. It
   * goes straight through to the loop, which decides how far it reaches; see
   * `ReActEngine` for what a stop does and does not interrupt.
   */
  async send({ id, text }, emit = null, signal = null) {
    const typed = typeof text === 'string' ? text.trim() : ''
    if (!typed) {
      // Nothing to send is not a fault to report; it is a no-op with a reason.
      return Outcome.ok({ user: null, assistant: null }, [
        'nothing was sent: the message was empty',
      ])
    }

    const loaded = await this.conversations.get({ id })
    if (!loaded.ok) return loaded

    const notes = []
    const appended = await this.conversations.appendMessage({ id, role: Role.USER, text: typed })
    if (!appended.ok) return appended
    notes.push(...appended.notes)
    const userMessage = appended.value
    // The transcript as it stands after that append, without a second read.
    // Re-loading would be a round trip to learn something this call just did.
    const history = [...loaded.value.messages, userMessage]

    const settings = await this.settings.get()
    notes.push(...settings.notes)

    // The agent file is read before the transport, because it may name the
    // model the transport must talk to.
    const spec = await this.catalogue.spec(settings.value.agent)
    if (!spec.ok) return spec
    notes.push(...spec.notes)

    const inference = await this._inferenceFor(settings.value, spec.value)
    notes.push(...inference.notes)

    // Every other agent is a possible tool. Which of them this one actually
    // gets is decided by its own file's `tools:` list, not by what exists.
    const roster = await this.catalogue.all()
    notes.push(...roster.notes)
    const peers = (roster.value ?? []).filter((peer) => peer.name !== spec.value.name)

    // The agent's MCP servers are started in the guest and asked what they
    // offer, before the prompt is rendered: a tool the model is not told about
    // is a tool it will never call. A server that cannot be started costs its
    // own tools and leaves a note.
    const mcp = await discoverMcpTools(spec.value.mcp, this.services)
    notes.push(...mcp.notes)

    // The agent — its instructions, loop, contract and toolkit — comes from its
    // file. Nothing here supplies behaviour of its own.
    const agent = buildAgent({
      spec: spec.value,
      inference: inference.value,
      peers,
      // The signal goes with the task. A delegated run is a second agent on a
      // second thread; without this, stopping the parent left the child running
      // its own budget to completion for nobody.
      //
      // And the progress channel comes back the same way. A delegated run is
      // minutes of a second agent working, and until this it was minutes of
      // nothing at all on a screen that streams the parent's every token — a
      // thread reading its fourth page and a thread that was wedged looked
      // identical. The event rides the PARENT's request id, because that is the
      // call the user is waiting on; `SubAgentTool` does not carry it, because
      // this closure already knows the name and the emitter and a fourth
      // argument threaded through `Toolbox` would buy nothing.
      dispatch: (name, task, stop) =>
        this.pool.ask(
          name,
          task,
          settings.value,
          stop ?? signal,
          emit ? (progress) => emit(EventName.DELEGATE, progress) : null,
        ),
      context: await this._context(notes),
      services: this.services,
      extraTools: mcp.value,
    })
    if (!agent.ok) return agent
    notes.push(...agent.notes)

    // The live view of the run. Everything here is a report on work that is
    // happening anyway — none of it changes the result, and a caller that
    // passed no emitter gets exactly the same reply.
    const answered = await agent.value.run(history, {
      // The terms this agent declared, or none — in which case `Budget` applies
      // its own, which is where they are argued for. Handed as a declaration
      // and not as a counter, so one turn's spending cannot leak into the next.
      budget: spec.value.budget,
      signal,
      onPrompt: emit
        ? (event) => {
            // An arrangement that wastes tokens says so on the same channel as
            // every other correction, rather than only in a panel someone has
            // to be looking at.
            for (const problem of event.problems ?? []) {
              if (!notes.includes(problem)) notes.push(problem)
            }
            emit(EventName.PROMPT, event)
          }
        : undefined,
      onDelta: emit ? (event) => emit(EventName.DELTA, event) : undefined,
      onUsage: emit ? (event) => emit(EventName.USAGE, event) : undefined,
      // The parsed response, not the raw text: by the time a step ends the
      // reply has a shape, and the page should show the answer rather than the
      // contract around it.
      onStep: emit
        ? ({ step, parsed }) =>
            emit(EventName.STEP, {
              step,
              answer: answerOf(parsed),
              isAnswer: isAnswered(parsed),
              thinking: reasoningOf(parsed),
            })
        : undefined,
    })
    if (!answered.ok) {
      // The user's turn is already saved, so the failure is reported against a
      // transcript that still holds what they typed.
      return new Outcome(false, { user: userMessage, assistant: null }, answered.failure, [
        ...notes,
        ...answered.notes,
      ])
    }
    notes.push(...answered.notes)

    const parsed = answered.value
    // Nothing to write down. Either the run was stopped before the model said
    // anything, or it was stopped while the model was mid tool call — the loop
    // returns an unanswered turn on that path and on no other. Putting
    // `shell({...})` into the transcript as the assistant's reply would be the
    // user's own stop corrupting the conversation they stopped, so the
    // transcript keeps what they typed and the notes say what happened.
    if (!isAnswered(parsed)) {
      // `notes` already holds the run's own notes — they were pushed one branch
      // above. Spreading them a second time here put every note on screen
      // twice and, because `page.jsx` keys each note by its text, collided two
      // React keys. `toContain` is true of a duplicate, which is why 208 green
      // tests never saw it.
      return Outcome.ok({ user: userMessage, assistant: null }, notes)
    }

    const reply = answerOf(parsed)
    // Appended rather than pushed onto the record loaded at the top of this
    // method. That record is as old as the model call — seconds, or minutes on
    // a local model — and writing it back would erase anything appended or
    // renamed while the model was thinking.
    const wrote = await this.conversations.appendMessage({
      id,
      role: Role.ASSISTANT,
      // A model that answers with an empty string still made a turn, and a
      // blank assistant bubble is a transcript that says nothing happened.
      text: reply || '(the model returned nothing)',
      // Stored beside the reply, never shown as it.
      //
      // It now survives a round trip, which it did not before. It still has no
      // reader: `page.jsx` renders `live.reasoning` while the turn is running
      // and `message.text` afterwards, and `grep -rn 'message.thinking' src/`
      // is empty. Kept rather than deleted because the erasure was the defect
      // being fixed and the record is the only place the reasoning can be read
      // back from at all — but it is a field with a writer and no reader, and
      // it is `docs/LEDGER.md` row S21 until the transcript renders it.
      thinking: reasoningOf(parsed),
    })
    // The same shape as the stopped-run branch above. The question is already
    // in the transcript either way, so a caller that failed here still learns
    // what was written down before the failure.
    if (!wrote.ok) {
      return new Outcome(false, { user: userMessage, assistant: null }, wrote.failure, [
        ...notes,
        ...wrote.notes,
      ])
    }
    notes.push(...wrote.notes)

    return Outcome.ok({ user: userMessage, assistant: wrote.value }, notes)
  }
}
