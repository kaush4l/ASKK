import { Outcome, Reason } from '../Outcome.js'

/** The version of the protocol this client speaks. */
export const PROTOCOL_VERSION = '2025-06-18'

/**
 * A Model Context Protocol client.
 *
 * MCP is JSON-RPC 2.0 with three calls that matter here: `initialize` to agree
 * a version, `tools/list` to find out what a server offers, and `tools/call` to
 * use one. That is the whole of what an agent needs, and it is deliberately all
 * that is implemented — resources, prompts and sampling are real parts of the
 * protocol with no caller in this app yet, and an unused implementation is an
 * untested one.
 *
 * WHY THIS EXISTS AT ALL. MCP was designed around stdio: a server is a process,
 * and the client writes JSON-RPC to its stdin. A browser has no processes and no
 * stdin, which is the usual reason "MCP does not run in the browser". It is not
 * a protocol problem — the protocol is transport-agnostic — so the fix is a
 * transport rather than a shim. Two are provided: one that runs the server
 * inside the sandbox, and one that talks to a server over HTTP.
 *
 * The client holds no transport of its own and does no I/O. It formats requests
 * and reads replies, which is what lets the same client work over a network, an
 * emulator, or anything else that can carry a message.
 */
export class McpClient {
  /**
   * @param {{name: string, transport: object}} options `transport` must provide
   *   `send(request) -> Promise<Outcome>` whose value is the parsed reply.
   */
  constructor({ name, transport }) {
    this.name = name
    this.transport = transport
    this._id = 0
    this._ready = null
  }

  _request(method, params) {
    return { jsonrpc: '2.0', id: ++this._id, method, params }
  }

  /**
   * Agree a protocol version. Done once, lazily, and shared by concurrent
   * callers — a server that is initialized twice is entitled to object.
   */
  async initialize() {
    if (this._ready) return this._ready
    this._ready = this.transport
      .send(
        this._request('initialize', {
          protocolVersion: PROTOCOL_VERSION,
          // No capabilities are claimed, because none are implemented. A client
          // that advertises sampling and then refuses it is worse than one that
          // never offered.
          capabilities: {},
          clientInfo: { name: 'askk', version: '1' },
        }),
      )
      .then(async (replied) => {
        if (!replied.ok) return replied
        // The handshake is two messages, not one. A server is entitled to
        // refuse every request until it has been told the client is ready, and
        // the ones that do are indistinguishable from a server that is broken.
        await this.transport.notify?.({ jsonrpc: '2.0', method: 'notifications/initialized' })
        const version = replied.value?.result?.protocolVersion
        const notes = []
        // A different version is not a refusal. The server names what it speaks
        // and the calls used here have been stable across every version of them;
        // proceeding with a note beats failing on a string comparison.
        if (version && version !== PROTOCOL_VERSION) {
          notes.push(`${this.name} speaks MCP ${version}, this client speaks ${PROTOCOL_VERSION}`)
        }
        return Outcome.ok(replied.value?.result ?? {}, notes)
      })
    return this._ready
  }

  /** What this server offers. */
  async listTools() {
    const started = await this.initialize()
    if (!started.ok) return started

    const replied = await this.transport.send(this._request('tools/list', {}))
    if (!replied.ok) return replied

    const tools = replied.value?.result?.tools
    if (!Array.isArray(tools)) {
      return Outcome.failed(Reason.UNAVAILABLE, `${this.name} listed no tools`, {
        hint: 'The server answered, but not in the MCP tools/list shape.',
      })
    }
    return Outcome.ok(tools, started.notes)
  }

  /**
   * Use one.
   *
   * MCP reports a tool's own failure with `isError` on a normal result, not as
   * a JSON-RPC error — the distinction is between "the tool ran and failed" and
   * "the call could not be made", and it is kept here: the first comes back as
   * text the agent can read, the second as a failure.
   */
  async callTool(name, args = {}) {
    const started = await this.initialize()
    if (!started.ok) return started

    const replied = await this.transport.send(
      this._request('tools/call', { name, arguments: args }),
    )
    if (!replied.ok) return replied

    const result = replied.value?.result
    if (!result) {
      const problem = replied.value?.error
      return Outcome.failed(
        Reason.UNAVAILABLE,
        `${this.name}: ${problem?.message ?? 'no result'}`,
        { hint: problem?.code ? `JSON-RPC error ${problem.code}` : '' },
      )
    }

    const text = McpClient.textOf(result.content)
    return Outcome.ok(result.isError ? `the tool reported an error: ${text}` : text, started.notes)
  }

  /**
   * MCP content blocks, flattened to what a model can read.
   *
   * Images and embedded resources are named rather than dropped silently: an
   * agent told "[image]" knows something came back it cannot see, which is more
   * useful than a gap it cannot account for.
   */
  static textOf(content) {
    if (!Array.isArray(content)) return typeof content === 'string' ? content : ''
    return content
      .map((block) => {
        if (block?.type === 'text') return block.text ?? ''
        if (block?.type === 'image') return '[an image, which this agent cannot see]'
        if (block?.type === 'resource') return block.resource?.text ?? '[an attached resource]'
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
}
