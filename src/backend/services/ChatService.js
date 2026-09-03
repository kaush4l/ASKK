import { describeEnvironment } from '../../core/agent/Environment.js'
import { buildAgent } from '../../core/agent/loadAgent.js'
import { createInference } from '../../core/inference/index.js'
import { Multimodality } from '../../core/inference/Multimodality.js'
import { Marker, Role } from '../../core/Message.js'
import { discoverMcpTools } from '../../core/mcp/index.js'
import { Outcome } from '../../core/Outcome.js'
import { describeProgress } from '../../core/progress.js'
import { describeTask } from '../../core/tools/index.js'
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
    // The pool is the thing that holds a running task, and `tasks` is the
    // narrow view of it `core/` is allowed: list and get, never start. Starting
    // is `SubAgentTool` with `wait: false`, so an agent can only hand work to
    // the peers its own file names.
    this.services = {
      sandbox,
      http,
      files,
      // Built only from a pool that can actually answer both questions. A
      // dispatcher that can send a question and cannot hold a running one is a
      // legitimate thing to be handed — `SubAgentTool` says so to the model
      // when `wait: false` has nowhere to go — and a port that existed but
      // threw would turn that into a broken turn instead of a sentence.
      // Scoped to ONE conversation, and `_tasksFor` below is where the scope
      // is applied. Unscoped, a question handed over in one conversation was
      // announced in every other conversation's prompt and could be read
      // there — one person's research answering a different question.
      tasks: undefined,
    }
    this._inference = null
    this._signature = ''
    /**
     * An agent's MCP tools, once discovered. Same argument as the inference
     * above, one seam over: rebuilding per turn is free for an HTTP server and
     * two Alpine boots for one in the guest.
     */
    this._mcp = new Map()
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
  /**
   * An agent's MCP tools, discovered once rather than once a turn.
   *
   * Discovery is two guest commands per server — `initialize` and `tools/list`,
   * because the transport has no session — and it ran on every single turn.
   * Measured at two `sandbox.run` calls before the model was called on a turn
   * that said hello, which is two Alpine boots at roughly a second each for a
   * list that cannot change while the page is open: an agent file is fetched
   * once by `AgentCatalogue` and kept.
   *
   * Keyed by the agent AND by whether the guest was running, because those are
   * two different answers: cold, a guest server is deliberately skipped with a
   * note, and that answer must not be remembered after the guest starts.
   */
  async _mcpToolsFor(spec) {
    const key = `${spec.name}:${this.services.sandbox?.warm ? 'warm' : 'cold'}`
    const known = this._mcp.get(key)
    if (known) return known

    const found = await discoverMcpTools(spec.mcp, this.services)
    // A FAILURE is never cached. The list of tools a server offers cannot
    // change while the page is open, which is what makes caching sound; a
    // server being DOWN can change at any moment, and remembering that for the
    // session means a server that comes up a minute later stays invisible
    // until someone reloads the page.
    //
    // Read off the VALUE. This used to search the notes for the words "was not
    // available", which made a sentence written for a person into the condition
    // of a cache — and rewording that sentence, which somebody did to stop it
    // saying "mcp" at a user, silently froze a dead server for the whole
    // session with every test still green.
    const failed = found.value?.unavailable?.length > 0
    if (!failed) this._mcp.set(key, found)
    return found
  }

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
   * Work this agent handed to another and did not wait for.
   *
   * THE NOTIFICATION, and it is a line in the prompt rather than a message
   * because there is nowhere else for it to arrive: an agent is not running
   * between turns, so "tell the parent when the child finishes" can only mean
   * "the next turn is told". A finished task is therefore something the agent
   * reads in the same breath as the clock and its own file listing.
   *
   * The ANSWER is not here, on the rule the whole tools table is built on: that
   * a task exists and is done is a fact, and a fact belongs in the context
   * block; what it actually said is a paragraph of someone else's research, and
   * rendering that into every remaining turn of the conversation would cost
   * more than never having delegated. `check_task` spends the call to read it.
   */
  _backgroundContext(context, tasks) {
    // Still running, or finished and not yet read. A finished task that has
    // been read is history: leaving it here put a line in every prompt for the
    // life of the tab, each turn inviting the agent to read it again — a line
    // and a whole extra step, per task, forever.
    const news = (tasks?.list?.() ?? []).filter((task) => task.state === 'running' || !task.read)
    if (!news.length) return context
    context.push(['handed over', news.map((task) => describeTask(task)).join('\n')])
    return context
  }

  /**
   * The task port for ONE conversation.
   *
   * The pool is one per tab and holds every task in it; a conversation may only
   * see its own. Built per turn because the scope is the turn's, and handed to
   * the tools rather than to the pool, so `core/` never learns what a
   * conversation is.
   */
  _tasksFor(conversationId) {
    const pool = this.pool
    if (typeof pool?.tasks !== 'function' || typeof pool?.task !== 'function') return undefined
    const mine = (task) => task && task.owner === conversationId
    return {
      list: () => pool.tasks().filter(mine),
      get: (id) => {
        const found = pool.task(id)
        if (!mine(found)) return null
        // Reading it is what ends the notification. `check_task` is the only
        // reader, so acknowledging here rather than in the tool keeps `core/`
        // free of the idea that a notification can be dismissed.
        pool.acknowledge?.(id)
        return found
      },
    }
  }

  /**
   * How a turn ended, appended to the conversation it ended in.
   *
   * A turn that produced no reply used to leave the question and nothing else,
   * and everything a person could have read about why lived in a note the next
   * question dismissed — so a failed turn stopped explaining itself the moment
   * a later one succeeded, and a stopped turn explained itself until the page
   * was reloaded. The fact belongs beside the words, and the only way to put
   * something beside words already written is to write something after them:
   * `Message` is frozen on construction because a record that can be edited in
   * place is not evidence, so this is an APPEND and not an amendment.
   *
   * Assistant-shaped and wordless. It stands in the slot the missing reply
   * would have stood in, which is where a reader is already looking for it, and
   * the sentence a person actually reads is `Transcript`'s to choose.
   *
   * A store that is refusing writes is exactly the state a failed turn is most
   * likely to be in, so the failure to record has its own note — the channel
   * this whole method is moving OFF, kept as the fallback for when there is
   * nowhere else to put the fact.
   */
  async _mark(id, marker, notes) {
    const wrote = await this.conversations.appendMessage({ id, role: Role.ASSISTANT, marker })
    notes.push(...wrote.notes)
    if (wrote.ok) return wrote.value
    notes.push(`what happened to this turn could not be written down: ${wrote.failure.message}`)
    return null
  }

  /**
   * Send a message and get the reply.
   *
   * The user's message is persisted BEFORE the model is called. A failed or
   * slow call must not lose what the user typed — on failure the turn is still
   * in the transcript, and they can retry rather than retype.
   *
   * `scheduled` says the question was asked by this app on the user's behalf
   * because a schedule came due, and it is a BOOLEAN rather than a marker the
   * caller names. Where the question came from is the page's fact and how the
   * turn ended is this method's, and a caller free to write any marker it liked
   * would be a second author of one field — which is how `thinking` came to be
   * spelled two ways and dropped by whichever writer went last.
   *
   * `signal` is the third argument every handler may declare — the Kernel makes
   * one per call — and this is the only handler that has any use for one. It
   * goes straight through to the loop, which decides how far it reaches; see
   * `ReActEngine` for what a stop does and does not interrupt.
   */
  async send({ id, text, attachments = [], scheduled = false }, emit = null, signal = null) {
    const typed = typeof text === 'string' ? text.trim() : ''
    const notes = []

    /**
     * What was attached, in the modality the data URL itself declares.
     *
     * `Multimodality.of` returns null for anything that is not a data URL, and
     * that refusal is kept rather than worked around. A remote URL would be a
     * request this app makes on the user's behalf to a host they never named,
     * from a page whose whole claim is that nothing leaves the browser except
     * the model call they configured — and the modality would have to be
     * guessed from a path rather than read from a mime type.
     *
     * It returns null for a SECOND reason as well, and the two used to share
     * one sentence. `data:text/markdown;base64,…` is a data URL and is still
     * refused, because `image|audio|video` is the whole of what a model on this
     * wire can be shown — so the note read "an attachment has to be a data URL"
     * at a person whose attachment WAS one, which is a sentence they cannot act
     * on: the thing it tells them to do is the thing they did. The two
     * refusals are two mistakes with two different remedies, so they are two
     * notes, and the one about a type names the type it actually saw.
     */
    const carried = []
    const wrongShape = []
    const wrongType = []
    for (const one of Array.isArray(attachments) ? attachments : []) {
      const read = Multimodality.of(one)
      if (read) {
        carried.push(read)
      } else if (typeof one === 'string' && one.startsWith('data:')) {
        // Read off the URL's own header rather than guessed, which is the same
        // rule `Multimodality.of` applies one line up. A `data:,hello` carries
        // no type at all, and saying so is better than an empty gap in the
        // middle of a sentence.
        wrongType.push(Multimodality.split(one)[0] || 'a file with no type on it')
      } else {
        wrongShape.push(one)
      }
    }
    if (wrongType.length) {
      // The route that DOES work is named, because a refusal with no
      // alternative in it leaves the question unanswerable. A document put in
      // the files panel is listed to the agent by `_context` above and fetched
      // by `read_file` on the turn the agent decides it needs it — which is
      // also why it is the better route than pasting the same bytes into a
      // prompt that is re-rendered on every step.
      notes.push(
        `${wrongType.length} attachment(s) were not sent: a model here can be shown pictures, sound and video, and these were ${[...new Set(wrongType)].join(', ')} — put a document in your files instead, where the agent can read it`,
      )
    }
    if (wrongShape.length) {
      notes.push(
        `${wrongShape.length} attachment(s) were not sent: an attachment has to be a data URL, which is what this app makes when you choose a file`,
      )
    }

    // A picture with no words is a question — "what is this?" is implied by
    // attaching it — and the composer has always agreed: its send button is
    // live on `draft.trim() || attachments.length`. This method disagreed, and
    // returned here on empty text alone, so pressing that button gave a person
    // the whole shape of a turn and none of it: the optimistic bubble drawn,
    // the chips cleared, nothing persisted, nothing asked, and the bubble gone
    // on the next reload. Nothing to send is still not a fault to report — it
    // is a no-op with a reason — but the only turn with nothing in it is one
    // with no words AND nothing the model can be shown.
    //
    // Refused on `carried` and not on what was OFFERED, because an attachment
    // that was refused above is not something the model will see: a lone `.md`
    // and an empty field is a turn with nothing in it, and the person is owed
    // both halves of why.
    if (!typed && !carried.length) {
      return Outcome.ok({ user: null, assistant: null, ending: null }, [
        ...notes,
        'nothing was sent: there were no words and nothing attached',
      ])
    }

    const loaded = await this.conversations.get({ id })
    if (!loaded.ok) return loaded

    const appended = await this.conversations.appendMessage({
      id,
      role: Role.USER,
      // Empty when the question was a picture and nothing else, and left empty
      // on purpose. The record is evidence of what a person did, and they did
      // not type "what is this?"; the picture reaches the model on the call
      // itself, as `multimodal` below, rather than through this line.
      text: typed,
      // The ones that were SENT, not the ones that were offered. A transcript
      // showing an attachment the model never saw would be the record
      // disagreeing with the turn — which is not hypothetical: while the
      // picker offered `.md` and `.py`, a text file was drawn as a chip,
      // refused above, and would have been written down here as part of a
      // question the model was never shown.
      attachments: carried.flatMap((one) => one.urls),
      // Who asked, written down with the question rather than worked out later.
      // A schedule appends a plain `user` turn and there is nothing about the
      // words to distinguish it from a typed one, so a tab opened after a few
      // hours showed a history of questions attributed to somebody who never
      // asked them — and asking the same thing twice, once by hand and once on
      // a timer, is a transcript in which the two are the same message.
      marker: scheduled ? Marker.SCHEDULED : undefined,
    })
    if (!appended.ok) return appended
    notes.push(...appended.notes)
    const userMessage = appended.value
    // The transcript as it stands after that append, without a second read.
    // Re-loading would be a round trip to learn something this call just did.
    const history = [...loaded.value.messages, userMessage]

    /**
     * Every way this turn can end without a reply, answered in one shape.
     *
     * There are four of them below — the agent file could not be read, the
     * agent could not be built, the run failed, the run was stopped — and until
     * now the first two returned a bare failure carrying no `user` at all, so a
     * caller could not tell whether the question it had just sent had survived.
     * They are all the same event to the person looking at the transcript: a
     * question with nothing after it. One helper, so the record cannot say one
     * of them happened and stay silent about the next.
     *
     * A stop is not a failure — the run did what it was told — so it keeps its
     * `ok`, and the marker is what distinguishes the two on the record.
     */
    const unanswered = async (failure = null, extra = []) => {
      notes.push(...extra)
      const ending = await this._mark(id, failure ? Marker.FAILED : Marker.STOPPED, notes)
      return new Outcome(!failure, { user: userMessage, assistant: null, ending }, failure, notes)
    }

    const settings = await this.settings.get()
    notes.push(...settings.notes)

    // The agent file is read before the transport, because it may name the
    // model the transport must talk to.
    const spec = await this.catalogue.spec(settings.value.agent)
    if (!spec.ok) return unanswered(spec.failure, spec.notes)
    notes.push(...spec.notes)

    const inference = await this._inferenceFor(settings.value, spec.value)
    notes.push(...inference.notes)

    // A model that runs in this tab arrives before it answers, and the first
    // arrival is minutes of weights. `TransformersInference` has always had an
    // `onProgress` hook and nothing ever set it: the app went silent for the
    // whole download on the one setup recommended to a person who has no
    // server — while the speech panels, using the same library, drew a bar.
    // Set per turn because the emitter belongs to this call, and cleared below
    // for the same reason.
    if (typeof inference.value?.onProgress === 'function') {
      inference.value.onProgress = emit
        ? (event) => emit(EventName.PROGRESS, describeProgress(event))
        : () => {}
    }

    // And the guest, on the same channel and for the same reason. It is the
    // larger of the two by far — tens of megabytes, fetched on the FIRST shell
    // call rather than at boot — and it reported nothing at all, so a person
    // who asked a question that needed a command watched a step sit there for
    // however long their connection took. `docs/LEDGER.md` row S24.
    //
    // The sandbox already reports in `core/progress.js`'s four fields, so it is
    // NOT passed through `describeProgress`: that function reads a
    // transformers.js event, and running a report that is already in the right
    // shape through it would zero every field.
    const sandbox = this.services.sandbox
    if (typeof sandbox?.onProgress === 'function') {
      sandbox.onProgress = emit ? (event) => emit(EventName.PROGRESS, event) : () => {}
    }

    // Every other agent is a possible tool. Which of them this one actually
    // gets is decided by its own file's `tools:` list, not by what exists.
    const roster = await this.catalogue.all()
    notes.push(...roster.notes)
    const peers = (roster.value ?? []).filter((peer) => peer.name !== spec.value.name)

    // The agent's MCP servers are started in the guest and asked what they
    // offer, before the prompt is rendered: a tool the model is not told about
    // is a tool it will never call. A server that cannot be started costs its
    // own tools and leaves a note.
    const mcp = await this._mcpToolsFor(spec.value)
    notes.push(...mcp.notes)

    // The agent — its instructions, loop, contract and toolkit — comes from its
    // file. Nothing here supplies behaviour of its own.
    // This conversation's handed-over work, and nothing else's.
    const tasks = this._tasksFor(id)

    // Read once per session by the catalogue and cached there, so this is a
    // map lookup on every turn after the first.
    const soul = await this.catalogue.soul()

    const agent = buildAgent({
      spec: spec.value,
      inference: inference.value,
      soul: soul.value,
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
      // Handing work over without waiting. The pool answers with a receipt and
      // the run settles into a record; nothing here awaits it, which is the
      // whole point.
      start:
        typeof this.pool?.start === 'function'
          ? (name, task) => this.pool.start(name, task, settings.value, { owner: id })
          : null,
      dispatch: (name, task, stop) =>
        this.pool.ask(
          name,
          task,
          settings.value,
          stop ?? signal,
          emit ? (progress) => emit(EventName.DELEGATE, progress) : null,
        ),
      context: this._backgroundContext(await this._context(notes), tasks),
      services: { ...this.services, tasks },
      extraTools: mcp.value,
    })
    if (!agent.ok) return unanswered(agent.failure, agent.notes)
    notes.push(...agent.notes)

    // The live view of the run. Everything here is a report on work that is
    // happening anyway — none of it changes the result, and a caller that
    // passed no emitter gets exactly the same reply.
    const answered = await agent.value.run(history, {
      // The pictures, on the same call as the words. Every layer under this one
      // has taken them since it was written; this is the line that was missing.
      multimodal: carried,
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
      // The other half of a pass. Passed through with no reshaping: the engine
      // already names the step and the call, and a second vocabulary here is
      // the way the step schema drifted from the record it is drawn beside.
      onObservation: emit ? (event) => emit(EventName.OBSERVATION, event) : undefined,
    })
    // The emitter goes with the call it belonged to. Left in place, the next
    // turn's download would report itself to a request that has already been
    // answered, and the page would draw a bar for a turn that is over.
    if (typeof inference.value?.onProgress === 'function') inference.value.onProgress = () => {}
    if (typeof sandbox?.onProgress === 'function') sandbox.onProgress = () => {}

    if (!answered.ok) {
      // The user's turn is already saved, so the failure is reported against a
      // transcript that still holds what they typed — and now against one that
      // says what became of it. The failure itself still travels on the
      // outcome, because a caller that has just been told a turn failed should
      // not have to read the transcript back to find out.
      return unanswered(answered.failure, answered.notes)
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
      // above — so nothing is spread in a second time here. Doing that put
      // every note on screen twice and, because `page.jsx` keys each note by
      // its text, collided two React keys. `toContain` is true of a duplicate,
      // which is why 208 green tests never saw it.
      return unanswered()
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
    //
    // NOT marked, and that is the one deliberate hole in the marking. This turn
    // got an answer and the store refused to keep it; writing "this one did not
    // get an answer" into the same store that just refused a write would be the
    // record telling a person something untrue about their own turn, and it
    // would be doing it through the write that had just failed. `unanswered` is
    // therefore the wrong helper here even though the shape matches.
    if (!wrote.ok) {
      return new Outcome(
        false,
        { user: userMessage, assistant: null, ending: null },
        wrote.failure,
        [...notes, ...wrote.notes],
      )
    }
    notes.push(...wrote.notes)

    return Outcome.ok({ user: userMessage, assistant: wrote.value, ending: null }, notes)
  }
}
