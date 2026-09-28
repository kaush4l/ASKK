// A minimal stdio MCP server for tests: one read-only tool `say`, one writing tool `store`.
// It refuses a second initialize, the way real stdio servers do.
let buffer = ''
let initialized = false
const kept = []
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let cut = buffer.indexOf('\n')
  while (cut !== -1) {
    const message = JSON.parse(buffer.slice(0, cut))
    buffer = buffer.slice(cut + 1)
    cut = buffer.indexOf('\n')
    if (message.id == null) continue
    if (message.method === 'initialize') {
      if (initialized) send({ jsonrpc: '2.0', id: message.id, error: { code: -32600, message: 'already initialized' } })
      else send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'echo', version: '1' } } })
      initialized = true
    } else if (message.method === 'tools/list') {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          tools: [
            { name: 'say', description: 'Say the text back.', inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'what to say' } }, required: ['text'] }, annotations: { readOnlyHint: true } },
            { name: 'store', description: 'Keep the text.', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
          ],
        },
      })
    } else if (message.method === 'tools/call') {
      const { name, arguments: args } = message.params
      if (name === 'store') kept.push(args.text)
      send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: name === 'say' ? `echo: ${args.text}` : `kept ${kept.length}` }] } })
    } else send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `no method ${message.method}` } })
  }
})
