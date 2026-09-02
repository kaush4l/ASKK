import { Outcome } from '../Outcome.js'
import { McpTool } from '../tools/McpTool.js'
import { HttpTransport } from './HttpTransport.js'
import { McpClient } from './McpClient.js'
import { filterTools } from './McpConfig.js'
import { SandboxTransport } from './SandboxTransport.js'

/**
 * Start an agent's MCP servers and ask each what it offers.
 *
 * This runs once per turn, before the prompt is rendered, because a tool the
 * model is not told about is a tool it will never call. A server that cannot be
 * started costs its own tools and nothing else — the agent still runs, with a
 * note saying what is missing, because a broken MCP server must not be able to
 * take the assistant down with it.
 *
 * @param {import('./McpConfig.js').McpServerConfig[]} servers
 * @param {{sandbox?: object}} services what the running app can supply
 * @returns {Outcome} value is an array of McpTool
 */
export async function discoverMcpTools(servers = [], services = {}) {
  const notes = []
  const tools = []

  for (const server of servers) {
    // A server that lives in the guest is not started until the guest is
    // ALREADY RUNNING, and this is the most expensive line in the file.
    //
    // Measured: one `chat.send` on an agent declaring one guest server costs
    // TWO `sandbox.run` calls before the model is called — `initialize` and
    // `tools/list` — because the transport has no session and replays the
    // handshake. On turn one of a session that is the whole 50.2 MiB image,
    // fetched and inflated, on a question that may only have said hello; on
    // every turn after it, it is two Alpine boots at roughly a second each.
    // Nothing asked for that. `composition.js` says an agent that never runs a
    // command must never download the guest, and this line was the reason that
    // sentence was false for every agent with an `mcp:` block.
    //
    // So the guest's servers arrive when the guest does. The tools appear in
    // the prompt from the turn after the first `shell` call, and the note says
    // so rather than leaving a reader to wonder where a declared server went.
    // `!warm`, not `warm === false`: a port that does not answer the question is
    // cold, because the cost of guessing wrong is a download the user did not
    // ask for. `Sandbox` answers false by default for the same reason.
    if (!server.remote && !services.sandbox?.warm) {
      notes.push(
        `mcp server ${server.name} is in the guest, which is not running yet; it will start with the first command`,
      )
      continue
    }

    // The guest is the default and the point. A `url` is the exception, for a
    // server somebody else is already running — it needs CORS on their side,
    // and it is the only case where a tool call leaves this machine.
    const transport = server.remote
      ? new HttpTransport({ url: server.url, headers: server.headers })
      : new SandboxTransport({
          sandbox: services.sandbox,
          command: server.command,
          args: server.args,
          env: server.env,
          cwd: server.cwd,
        })

    const client = new McpClient({ name: server.name, transport })
    const listed = await client.listTools()
    notes.push(...listed.notes)
    if (!listed.ok) {
      notes.push(`mcp server ${server.name} was not available: ${listed.failure.message}`)
      continue
    }

    const { kept, notes: filtered } = filterTools(listed.value, server.includeTools)
    notes.push(...filtered)

    for (const descriptor of kept) {
      if (!descriptor?.name) continue
      tools.push(new McpTool({ server: server.name, client, descriptor }))
    }
    notes.push(
      server.includeTools.length
        ? `mcp server ${server.name} offered ${listed.value.length} tool(s); ${kept.length} allowed`
        : `mcp server ${server.name} offered ${kept.length} tool(s)`,
    )
  }

  return Outcome.ok(tools, notes)
}
