/**
 * A Model Context Protocol client over Streamable HTTP — the transport a browser can speak.
 *
 *     const server = mcp({url, headers}, {fetch})
 *     await server.tools()                 // [{name, description, inputSchema, annotations}]
 *     await server.call('search', {q})     // text of the result
 *
 * Every message is a JSON-RPC POST; the server answers with JSON or with a short SSE stream
 * carrying the response. `initialize` runs once and its `Mcp-Session-Id` goes with every later
 * request. A stdio server is reached the same way through the host bridge, which runs it and
 * speaks this transport for it (bridge `--mcp name=command`).
 */

export const PROTOCOL = '2025-06-18'

export class McpError extends Error {}

export function mcp({ url, headers = {} }, { fetch: fetcher = globalThis.fetch?.bind(globalThis) } = {}) {
  let session = ''
  let ready = null
  let next = 1

  async function rpc(method, params, { notify = false } = {}) {
    const body = { jsonrpc: '2.0', method, ...(params ? { params } : {}), ...(notify ? {} : { id: next++ }) }
    const response = await fetcher(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': PROTOCOL,
        ...(session ? { 'mcp-session-id': session } : {}),
        ...headers,
      },
      body: JSON.stringify(body),
    })
    if (!response.ok && response.status !== 202) {
      let detail = ''
      try {
        detail = (await response.text()).slice(0, 200)
      } catch {}
      throw new McpError(`${method}: HTTP ${response.status}${detail ? ` ${detail}` : ''}`)
    }
    const id = response.headers.get('mcp-session-id')
    if (id) session = id
    if (notify || response.status === 202) return null
    const type = response.headers.get('content-type') ?? ''
    const message = type.includes('text/event-stream') ? await fromStream(response.body, body.id) : await response.json()
    if (message?.error) throw new McpError(`${method}: ${message.error.message ?? JSON.stringify(message.error)}`)
    return message?.result
  }

  function start() {
    ready ??= (async () => {
      const result = await rpc('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'harness', version: '1.0.0' } })
      await rpc('notifications/initialized', null, { notify: true })
      return result
    })().catch((error) => {
      ready = null
      throw error
    })
    return ready
  }

  return {
    info: () => start(),
    async tools() {
      await start()
      const tools = []
      let cursor
      do {
        const page = await rpc('tools/list', cursor ? { cursor } : {})
        tools.push(...(page?.tools ?? []))
        cursor = page?.nextCursor
      } while (cursor)
      return tools
    },
    async call(name, args = {}) {
      await start()
      const result = await rpc('tools/call', { name, arguments: args })
      const text = (result?.content ?? [])
        .map((part) => (part.type === 'text' ? part.text : part.type === 'resource' ? (part.resource?.text ?? `[resource ${part.resource?.uri}]`) : `[${part.type}${part.mimeType ? ` ${part.mimeType}` : ''}]`))
        .join('\n')
      const shown = text || (result?.structuredContent ? JSON.stringify(result.structuredContent) : '')
      return result?.isError ? `error from ${name}: ${shown}` : shown
    },
    reset() {
      session = ''
      ready = null
    },
  }
}

/** An MCP tool as a harness tool descriptor: `<server>__<tool>`, risk from its annotations. */
export function describeTool(server, tool) {
  const schema = tool.inputSchema ?? {}
  const required = new Set(schema.required ?? [])
  const parameters = Object.fromEntries(
    Object.entries(schema.properties ?? {}).map(([key, prop]) => [key, `${prop.type ?? 'any'}${prop.description ? ` — ${prop.description}` : ''}${required.has(key) ? '' : ' (optional)'}`]),
  )
  const hints = tool.annotations ?? {}
  return {
    name: `${server}__${tool.name}`.replace(/[^A-Za-z0-9_]/g, '_'),
    description: `[mcp ${server}] ${tool.description ?? tool.name}`.slice(0, 600),
    parameters,
    // Only a tool that says it changes nothing runs without asking.
    risk: hints.readOnlyHint ? 'read' : 'write',
    server,
    tool: tool.name,
  }
}

async function fromStream(body, id) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (value) buffer += value
      let cut = buffer.search(/\r?\n\r?\n/)
      while (cut !== -1) {
        const data = buffer
          .slice(0, cut)
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        buffer = buffer.slice(cut).replace(/^\r?\n\r?\n/, '')
        if (data) {
          const message = JSON.parse(data)
          if (message.id === id && ('result' in message || 'error' in message)) return message
        }
        cut = buffer.search(/\r?\n\r?\n/)
      }
      if (done) break
    }
  } finally {
    reader.cancel().catch(() => {})
  }
  throw new McpError('the stream ended without a response')
}
