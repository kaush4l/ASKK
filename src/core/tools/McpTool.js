import { Outcome } from '../Outcome.js'
import { Tool } from './Tool.js'

/** Where a model stops reading and starts drowning. */
const MAX_OUTPUT = 4000

/**
 * One tool belonging to an MCP server, offered to the agent as its own.
 *
 * The name is prefixed with the server's, because two servers may both offer
 * `search` and the model has to be able to say which it means. Everything else
 * — the description, the argument table — is the server's own words: an MCP
 * server already publishes exactly what a tool needs to appear in a prompt, so
 * nothing here is invented.
 */
export class McpTool extends Tool {
  /**
   * @param {{server: string, client: object, descriptor: object}} options
   *   `descriptor` is one entry of an MCP `tools/list` reply.
   */
  constructor({ server, client, descriptor }) {
    super({
      name: `${server}_${descriptor.name}`,
      description: descriptor.description ?? '',
      parameters: McpTool.parameters(descriptor.inputSchema),
    })
    this.client = client
    this.remoteName = descriptor.name
  }

  /**
   * A JSON Schema, as the argument table the prompt renders.
   *
   * Only the top level is read. A model writes a flat call and reads a flat
   * signature; rendering a nested schema in full would fill the prompt with a
   * type definition the model then has to reverse-engineer into an argument.
   * The server validates the real shape anyway, and says so when it is wrong.
   */
  static parameters(schema) {
    const properties = schema?.properties ?? {}
    const required = new Set(schema?.required ?? [])
    const table = {}
    for (const [name, spec] of Object.entries(properties)) {
      table[name] = {
        type: Array.isArray(spec?.type) ? spec.type.join('|') : (spec?.type ?? 'string'),
        required: required.has(name),
        description: spec?.description ?? '',
      }
    }
    return table
  }

  async call(args = {}) {
    const called = await this.client.callTool(this.remoteName, args)
    if (!called.ok) {
      // A failed call is an observation: the agent can fix its arguments or try
      // something else, and it can only do that if it is told what went wrong.
      return Outcome.ok(`${this.name} failed: ${called.failure.message}`, called.notes)
    }

    const text = called.value.trim()
    const clipped =
      text.length > MAX_OUTPUT
        ? `${text.slice(0, MAX_OUTPUT)}\n[... ${text.length - MAX_OUTPUT} more characters, not shown]`
        : text
    return Outcome.ok(clipped || '(the tool returned nothing)', called.notes)
  }
}
