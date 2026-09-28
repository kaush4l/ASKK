/**
 * MCP: the Streamable HTTP client against a real HTTP server (JSON and SSE replies), and a
 * stdio server reached through the host bridge, which runs it and speaks HTTP for it.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describeTool, mcp } from '../src/core/mcp.js'

let server
let url
const sessions = []

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const message = await request.json()
      sessions.push(request.headers.get('mcp-session-id'))
      if (message.id == null) return new Response(null, { status: 202 })
      const result =
        message.method === 'initialize'
          ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'http', version: '1' } }
          : message.method === 'tools/list'
            ? message.params?.cursor
              ? { tools: [{ name: 'second', inputSchema: { type: 'object', properties: {} } }] }
              : { tools: [{ name: 'first', description: 'one', inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] }, annotations: { readOnlyHint: true } }], nextCursor: 'p2' }
            : { content: [{ type: 'text', text: `called ${message.params.name} with ${JSON.stringify(message.params.arguments)}` }], isError: message.params.name === 'second' }
      const reply = { jsonrpc: '2.0', id: message.id, result }
      // tools/call answers as an SSE stream, with a notification first; the rest as JSON.
      if (message.method === 'tools/call') {
        const body = `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: {} })}\n\ndata: ${JSON.stringify(reply)}\n\n`
        return new Response(body, { headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 's-1' } })
      }
      return Response.json(reply, { headers: { 'mcp-session-id': 's-1' } })
    },
  })
  url = `http://127.0.0.1:${server.port}/mcp`
})

afterAll(() => server?.stop(true))

describe('mcp client', () => {
  test('initialises once, pages through tools, keeps the session id, reads JSON and SSE replies', async () => {
    const client = mcp({ url })
    const tools = await client.tools()
    expect(tools.map((tool) => tool.name)).toEqual(['first', 'second'])
    expect(await client.call('first', { q: 'x' })).toBe('called first with {"q":"x"}')
    expect(await client.call('second')).toBe('error from second: called second with {}')
    expect(sessions[0]).toBeNull() // initialize carries no session
    expect(sessions.slice(1).every((id) => id === 's-1')).toBe(true)
  })

  test('a tool becomes a harness tool: prefixed name, parameters from the schema, risk from its hints', () => {
    const tool = describeTool('web', { name: 'search-now', description: 'find', inputSchema: { properties: { q: { type: 'string', description: 'words' }, n: { type: 'number' } }, required: ['q'] }, annotations: { readOnlyHint: true } })
    expect(tool).toMatchObject({ name: 'web__search_now', risk: 'read', server: 'web', tool: 'search-now', parameters: { q: 'string — words', n: 'number (optional)' } })
    expect(describeTool('web', { name: 'post' }).risk).toBe('write')
  })
})

describe('stdio MCP through the bridge', () => {
  let bridge
  let root
  const PORT = 17721
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'harness-mcp-'))
    bridge = spawn('node', [join(import.meta.dir, '../host/bridge.js'), '--root', root, '--port', String(PORT), '--token', 'm', '--mcp', `echo=node ${join(import.meta.dir, 'fixtures/stdio-mcp.js')}`], { stdio: 'pipe' })
    await new Promise((ready) => bridge.stdout.on('data', (chunk) => String(chunk).includes('token') && ready()))
  })
  afterAll(async () => {
    bridge?.kill()
    await rm(root, { recursive: true, force: true })
  })

  test('health names the servers; tools list and call; a reloaded page initialises again without error', async () => {
    const health = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json()
    expect(health.mcp).toEqual(['echo'])
    const headers = { authorization: 'Bearer m' }
    const first = mcp({ url: `http://127.0.0.1:${PORT}/mcp/echo`, headers })
    expect((await first.tools()).map((tool) => tool.name)).toEqual(['say', 'store'])
    expect(await first.call('say', { text: 'hi' })).toBe('echo: hi')
    const reloaded = mcp({ url: `http://127.0.0.1:${PORT}/mcp/echo`, headers })
    expect(await reloaded.call('store', { text: 'a' })).toBe('kept 1')
    const wrong = mcp({ url: `http://127.0.0.1:${PORT}/mcp/nope`, headers })
    await expect(wrong.tools()).rejects.toThrow(/404/)
    const unauthorised = mcp({ url: `http://127.0.0.1:${PORT}/mcp/echo` })
    await expect(unauthorised.tools()).rejects.toThrow(/401/)
  })
})
