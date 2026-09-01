/**
 * An MCP server, as an agent file declares it.
 *
 * The whole configuration lives in `agents/<name>/agent.md`, beside the
 * instructions, because a server is part of what an agent *is*. An agent that
 * can drive a database and one that cannot are two different agents, and
 * splitting that fact into a second file means reading two files to know what
 * either of them can do.
 *
 *     mcp:
 *       - name: host
 *         command: mcp-disk
 *         args: [--verbose]
 *         env:
 *           TZ: UTC
 *         include_tools: [disk]
 *
 * The field names are the ones every other MCP client uses — `command`, `args`,
 * `env`, `cwd` — so a server someone already has working elsewhere transfers by
 * copying the same values. `include_tools` is the one addition, and it is
 * copied from the Python harness this app is a port of.
 *
 * The server runs INSIDE the browser's Linux guest. That is the whole design:
 * a page that needs no machine behind it, so the process that serves the tools
 * has to be one the page can host itself.
 */
export class McpServerConfig {
  constructor({
    name = '',
    command = '',
    args = [],
    env = {},
    cwd = '',
    url = '',
    headers = {},
    includeTools = [],
    description = '',
  } = {}) {
    this.name = name
    this.command = command
    this.args = args
    this.env = env
    this.cwd = cwd
    this.url = url
    this.headers = headers
    this.includeTools = includeTools
    this.description = description
  }

  /** A server reached over the network rather than run in the guest. */
  get remote() {
    return Boolean(this.url)
  }
}

/** Both spellings, because these values get copied from other config files. */
function pick(raw, ...keys) {
  for (const key of keys) {
    if (raw?.[key] !== undefined && raw[key] !== null) return raw[key]
  }
  return undefined
}

function asList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean)
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

function asMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const table = {}
  for (const [key, item] of Object.entries(value)) table[key] = String(item)
  return table
}

/**
 * Read an agent file's `mcp:` list.
 *
 * A server that cannot be read costs that server. The rest of the list still
 * configures the rest of them, because the alternative — one typo disabling
 * every tool the agent has — is the failure mode this whole codebase is written
 * against.
 *
 * @returns {{servers: McpServerConfig[], notes: string[]}}
 */
export function parseMcpServers(entries = [], source = '<agent file>') {
  const notes = []
  const servers = []

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      notes.push(`${source}: an mcp entry is not a server description; ignored`)
      continue
    }

    const name = String(pick(entry, 'name') ?? '').trim()
    const command = String(pick(entry, 'command') ?? '').trim()
    const url = String(pick(entry, 'url') ?? '').trim()

    if (!name) {
      notes.push(`${source}: an mcp entry has no name; ignored`)
      continue
    }
    if (!command && !url) {
      notes.push(`${source}: mcp server ${name} names neither a command nor a url; ignored`)
      continue
    }

    servers.push(
      new McpServerConfig({
        name,
        command,
        args: asList(pick(entry, 'args')),
        env: asMap(pick(entry, 'env')),
        cwd: String(pick(entry, 'cwd') ?? ''),
        url,
        headers: asMap(pick(entry, 'headers')),
        includeTools: asList(pick(entry, 'include_tools', 'includeTools')),
        description: String(pick(entry, 'description') ?? ''),
      }),
    )
  }

  return { servers, notes }
}

/**
 * Keep only the tools an allowlist names.
 *
 * Not a nicety. Every tool a server offers is rendered into every prompt of
 * every turn, so a server with thirty tools is a standing cost on a
 * conversation that may never call one of them. Empty means everything.
 *
 * A name that matches nothing is reported rather than dropped: a filter that
 * silently keeps nothing looks exactly like a server that offers nothing, and
 * those need very different fixes.
 */
export function filterTools(tools = [], includeTools = []) {
  if (!includeTools.length) return { kept: [...tools], notes: [] }

  const allowed = new Set(includeTools)
  const kept = tools.filter((tool) => allowed.has(tool?.name))
  const missing = includeTools.filter((name) => !tools.some((tool) => tool?.name === name))
  const notes = missing.length
    ? [`the allowlist names ${missing.join(', ')}, which this server does not offer`]
    : []
  return { kept, notes }
}
