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
    // So the guest's servers arrive when the guest does: the tools appear in
    // the prompt from the turn after the first `shell` call.
    //
    // AND NOTHING IS SAID ABOUT THE WAIT. There was a note here, and a
    // black-box review of a first-time session found it first: it named three
    // internal things at once, described a component nobody had asked about, in
    // a state that reads as a warning and asks for nothing, under every reply
    // including the ones that worked. A server that has not started because
    // nothing has needed it yet is not news. The notes list is what a person
    // can act on and what actually went wrong; a line that is neither is what
    // teaches them to stop reading the lines that are.
    //
    // `!warm`, not `warm === false`: a port that does not answer the question is
    // cold, because the cost of guessing wrong is a download the user did not
    // ask for. `Sandbox` answers false by default for the same reason.
    if (!server.remote && !services.sandbox?.warm) continue

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
      // Said in the words of someone who configured a server and is now missing
      // the tools they configured it for, which is the only reading of this
      // that anyone can act on. The consequence is in the sentence because the
      // consequence is the part that is theirs: the run carried on without it.
      //
      // "WAS NOT AVAILABLE" IS LOAD-BEARING PROSE and this is the warning that
      // it is. `ChatService._mcpToolsFor` decides whether to cache a discovery
      // by searching these notes for that phrase — a failure must never be
      // cached, because a server that was down on turn one has to be asked
      // again on turn two — so rewording this sentence past those three words
      // silently freezes a dead server for the rest of the session, and every
      // test stays green while it happens. Measured: it did, in this slice.
      // The phrase is kept here and the coupling is reported; the repair is a
      // structural signal on the Outcome, in a file this change does not own.
      notes.push(
        `the tool server "${server.name}" was not available, so none of its tools could be used this turn: ${listed.failure.message}`,
      )
      continue
    }

    const { kept, notes: filtered } = filterTools(listed.value, server.includeTools)
    notes.push(...filtered)

    for (const descriptor of kept) {
      if (!descriptor?.name) continue
      tools.push(new McpTool({ server: server.name, client, descriptor }))
    }
    // A server that worked says nothing. It used to report how many tools it
    // offered, on every turn for the rest of the session, and a count of a
    // thing that behaved is not a fact anyone does anything with — the tools
    // themselves are the evidence, and they are in the prompt. The one part of
    // this that IS actionable already has its own line: `filterTools` names an
    // allowlist entry the server does not offer, which is a typo in the agent
    // file and needs a person.
  }

  return Outcome.ok(tools, notes)
}
