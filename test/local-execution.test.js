import { expect, test } from 'bun:test'
import { LocalExecution } from '../src/execution/local.js'

test('command cleanup errors reject the job even if a zero exit follows', async () => {
  const local = new LocalExecution()
  const requests = []
  local.request = async (path, body) => {
    requests.push(path)
    if (path === '/jobs/cancel') return Response.json({ ok: false })
    return new Response([
      { type: 'error', jobId: body.id, error: 'Original process group cleanup unconfirmed', code: 'PROCESS_CLEANUP_UNCONFIRMED', cleanup: { ok: false } },
      { type: 'exit', jobId: body.id, code: 0 },
    ].map(row => JSON.stringify(row)).join('\n'))
  }
  await expect(local.startJob({ id: 'cleanup', program: 'fixture' })).rejects.toMatchObject({ code: 'PROCESS_CLEANUP_UNCONFIRMED', cleanup: { ok: false } })
  expect(requests).toEqual(['/jobs/run', '/jobs/cancel'])
  expect(local.jobs.size).toBe(0)
})

function fixture() {
  const sockets = [], requests = []
  const local = new LocalExecution({ createSocket() {
    const socket = { readyState: 0, sent: [], send(value) { this.sent.push(JSON.parse(value)) }, close() { this.readyState = 3; this.onclose?.() }, receive(message) { this.onmessage?.({ data: JSON.stringify(message) }) } }
    sockets.push(socket)
    queueMicrotask(() => { socket.readyState = 1; socket.onopen?.() })
    return socket
  } })
  local.request = async (path, body) => { requests.push({ path, body }); return { json: async () => ({ id: 'terminal', ticket: 'fixture-only' }) } }
  return { local, sockets, requests }
}

test('terminal disconnect retains output, reports unknown exit once, and rejects silently dropped input or resize', async () => {
  const { local, sockets } = fixture()
  const { id } = await local.openTerminal()
  const socket = sockets[0], events = []
  local.subscribeTerminal(id, event => events.push(event))
  socket.receive({ type: 'output', data: 'retained output' })
  local.terminalInput(id, '\u0003'); local.resizeTerminal(id, 100, 35)
  expect(socket.sent).toEqual([{ type: 'input', data: '\u0003' }, { type: 'resize', cols: 100, rows: 35 }])
  socket.readyState = 3; socket.onerror(); socket.onclose()
  expect(events).toHaveLength(2)
  expect(events[0].data).toBe('retained output')
  expect(events[1]).toMatchObject({ type: 'error', code: 'TERMINAL_DISCONNECTED' })
  expect(events[1].error).toContain('exit is unknown')
  expect(() => local.terminalInput(id, 'must not vanish')).toThrow('not connected')
  expect(() => local.resizeTerminal(id, 80, 24)).toThrow('not connected')
  expect(() => local.terminalInput('missing', 'input')).toThrow('not connected')
  const replay = []; local.subscribeTerminal(id, event => replay.push(event))
  expect(replay).toEqual(events)
  await local.closeTerminal(id)
  expect(local.terminals.size).toBe(0)
})

test('an actual terminal exit is retained without inventing a connection failure or accepting more input', async () => {
  const { local, sockets } = fixture()
  const { id } = await local.openTerminal(), events = []
  local.subscribeTerminal(id, event => events.push(event))
  sockets[0].receive({ type: 'exit', code: 4 }); sockets[0].close()
  expect(events).toEqual([{ type: 'exit', code: 4 }])
  expect(() => local.terminalInput(id, 'ignored')).toThrow('not connected')
  await local.closeTerminal(id)
})

test('terminal close is single-flight and keeps a failed close available for explicit retry', async () => {
  const { local, sockets, requests } = fixture()
  const { id } = await local.openTerminal(), events = []
  local.subscribeTerminal(id, event => events.push(event))
  let rejectClose
  local.request = async (path, body) => { requests.push({ path, body }); return new Promise((_, reject) => { rejectClose = reject }) }
  const first = local.closeTerminal(id), second = local.closeTerminal(id)
  expect(requests.filter(row => row.path === '/terminals/close')).toHaveLength(1)
  expect(() => local.terminalInput(id, 'during close')).toThrow('not connected')
  rejectClose(new Error('Bridge unavailable'))
  expect((await Promise.allSettled([first, second])).every(result => result.status === 'rejected')).toBe(true)
  expect(local.terminals.has(id)).toBe(true)
  local.terminalInput(id, 'still open')
  local.request = async () => ({})
  await local.closeTerminal(id)
  expect(sockets[0].readyState).toBe(3)
  expect(events).toEqual([])
  expect(local.terminals.size).toBe(0)
})

test('malformed terminal exit is a lost channel, never a successful process exit', async () => {
  const { local, sockets } = fixture()
  const { id } = await local.openTerminal(), events = []
  local.subscribeTerminal(id, event => events.push(event))
  sockets[0].receive({ type: 'exit' })
  expect(events.map(event => event.type)).toEqual(['error'])
  expect(() => local.terminalInput(id, 'input')).toThrow('not connected')
  await local.closeTerminal(id)
})

test('a lost socket during a failed close is reported after rejection, with no invented exit', async () => {
  const { local, sockets } = fixture()
  const { id } = await local.openTerminal(), events = []
  local.subscribeTerminal(id, event => events.push(event))
  let rejectClose
  local.request = async () => new Promise((_, reject) => { rejectClose = reject })
  const closing = local.closeTerminal(id)
  sockets[0].close()
  expect(events).toEqual([])
  rejectClose(new Error('Close acknowledgement lost'))
  await expect(closing).rejects.toThrow('acknowledgement lost')
  expect(events.map(event => event.type)).toEqual(['error'])
  expect(events[0].error).toContain('exit is unknown')
  expect(local.terminals.has(id)).toBe(true)
  expect(() => local.terminalInput(id, 'input')).toThrow('not connected')
  sockets[0].onclose()
  expect(events).toHaveLength(1)
  local.request = async () => ({})
  await local.closeTerminal(id)
})

test('disposal reports failed native shutdown receipts while still attempting every owned resource', async () => {
  const { local } = fixture()
  const { id } = await local.openTerminal()
  const abort = new AbortController(); local.jobs.set('job', abort)
  const attempted = []
  local.request = async (path, body) => { attempted.push({ path, body }); throw new Error('Companion disconnected') }
  await expect(local.dispose()).rejects.toMatchObject({ code: 'EXECUTION_SHUTDOWN_UNCONFIRMED' })
  expect(abort.signal.aborted).toBe(true)
  expect(attempted.map(row => row.path).sort()).toEqual(['/jobs/cancel', '/terminals/close'])
  expect(local.terminals.has(id)).toBe(true)
  local.request = async () => ({ json: async () => ({ ok: true }) })
  await local.dispose()
  expect(local.terminals.size).toBe(0)
})
