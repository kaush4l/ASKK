import { describeEnvironment } from '../../core/agent/Environment.js'
import { buildAgent } from '../../core/agent/loadAgent.js'
import { newId } from '../../core/ids.js'
import { createInference } from '../../core/inference/index.js'
import { Role } from '../../core/Message.js'
import { discoverMcpTools } from '../../core/mcp/index.js'
import { Outcome, Reason } from '../../core/Outcome.js'
import { EventName } from '../../protocol/Envelope.js'

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
  constructor(conversations, settings, catalogue, pool, { sandbox = null } = {}) {
    this.conversations = conversations
    this.settings = settings
    this.catalogue = catalogue
    this.pool = pool
    // What a tool needs to reach the world. Handed to the agent builder, which
    // gives each tool only what that tool asked for.
    this.services = { sandbox }
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
   * Send a message and get the reply.
   *
   * The user's message is persisted BEFORE the model is called. A failed or
   * slow call must not lose what the user typed — on failure the turn is still
   * in the transcript, and they can retry rather than retype.
   */
  async send({ id, text }, emit = null) {
    const typed = typeof text === 'string' ? text.trim() : ''
    if (!typed) {
      // Nothing to send is not a fault to report; it is a no-op with a reason.
      return Outcome.ok({ user: null, assistant: null }, [
        'nothing was sent: the message was empty',
      ])
    }

    const loaded = await this.conversations.get(id)
    if (!loaded.ok) return loaded
    if (!loaded.value) {
      return Outcome.failed(Reason.NOT_FOUND, `no conversation ${id}`, {
        hint: 'Start a new chat.',
      })
    }

    const record = loaded.value
    const notes = []
    const userMessage = { id: newId(), role: Role.USER, text: typed, createdAt: Date.now() }
    record.messages.push(userMessage)

    const savedUser = await this.conversations.put(record)
    if (!savedUser.ok) notes.push(`your message was not saved: ${savedUser.failure.message}`)

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
      dispatch: (name, task) => this.pool.ask(name, task, settings.value),
      context: describeEnvironment(),
      services: this.services,
      extraTools: mcp.value,
    })
    if (!agent.ok) return agent
    notes.push(...agent.notes)

    // The live view of the run. Everything here is a report on work that is
    // happening anyway — none of it changes the result, and a caller that
    // passed no emitter gets exactly the same reply.
    const answered = await agent.value.run(record.messages, {
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
              answer: typeof parsed === 'string' ? parsed : (parsed?.answer ?? ''),
              isAnswer: typeof parsed === 'string' ? true : parsed?.isAnswer !== false,
              thinking: [parsed?.think, parsed?.thinking].flat().filter(Boolean).join('\n'),
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
    const reply = typeof parsed === 'string' ? parsed : parsed.answer
    const assistantMessage = {
      id: newId(),
      role: Role.ASSISTANT,
      text: reply || '(the model returned nothing)',
      createdAt: Date.now(),
      // Kept for the transcript, never rendered as the reply. `think` is a list
      // on the ReAct contract and a string on simpler ones, so it is flattened.
      thinking: [parsed?.think, parsed?.thinking].flat().filter(Boolean).join('\n'),
    }
    record.messages.push(assistantMessage)

    const savedReply = await this.conversations.put(record)
    if (!savedReply.ok) notes.push(`the reply was not saved: ${savedReply.failure.message}`)

    return Outcome.ok({ user: userMessage, assistant: assistantMessage }, notes)
  }
}
