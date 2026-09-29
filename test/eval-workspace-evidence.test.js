import { expect, test } from 'bun:test'
import { createEvaluationWorkspace, ranDeclaredTests, evaluationTimeoutSeconds } from '../scripts/evals/workspace-evidence.js'
const owner = { id: 'run', trace: 'task' }
function fixture() {
  let revision = 'a', runtimeId = 'runtime'
  const execution = {
    describeCapabilities: () => ({ runtimeId, root: '/project' }),
    snapshot: async () => ({ revision }),
    write: async () => { revision = 'b'; return { ok: true } },
    startJob: async () => ({ code: 0, runtimeId: 'runtime' }),
  }
  return { execution, workspace: createEvaluationWorkspace(execution), change: value => { revision = value }, rebind: () => { runtimeId = 'other' } }
}
test('completion belongs to a task and records exact checked source', async () => {
  const f = fixture()
  await f.workspace.run('bun run test', owner)
  const result = await f.workspace.check({}, owner)
  expect(result).toMatchObject({ ok: true, sourceRevision: 'a', evidence: { command: 'bun run test', runId: 'run', trace: 'task', inputRevision: 'a', completedRevision: 'a', sourceUnchanged: true, matchesAtCompletion: true } })
  expect((await f.workspace.check({}, { id: 'other', trace: 'foreign' })).ok).toBe(false)
  expect((await f.workspace.check({}, { id: 'child', trace: 'task' })).ok).toBe(true)
  expect(ranDeclaredTests(f.workspace.commands, owner, 'a')).toBe(true)
  expect(ranDeclaredTests(f.workspace.commands, owner, 'b')).toBe(false)
})
test('agent command timeout is forwarded in LocalExecution seconds', async () => {
  const f = fixture()
  let timeout
  f.execution.startJob = async options => { timeout = options.timeout; return { code: 0, runtimeId: 'runtime' } }
  await f.workspace.run('check', owner)
  expect(timeout).toBe(30)
  const bounded = createEvaluationWorkspace(f.execution, { commandTimeoutSeconds: 2 })
  await bounded.run('check', owner)
  expect(timeout).toBe(2)
  for (const value of [0, -1, Infinity, NaN, '2', null, 1801]) expect(() => evaluationTimeoutSeconds(value)).toThrow('timeout')
})
test('later source mutation or write-and-revert invalidates successful commands', async () => {
  const f = fixture(); await f.workspace.run('check', owner)
  f.change('b'); expect((await f.workspace.check({}, owner)).ok).toBe(false)
  f.change('a'); await f.workspace.write({}); f.change('a')
  expect((await f.workspace.check({}, owner)).ok).toBe(false)
  await f.workspace.run('check again', owner)
  expect((await f.workspace.check({}, owner)).ok).toBe(true)
})
test('a source-changing command is not verification of its resulting files', async () => {
  const f = fixture()
  f.execution.startJob = async () => { f.change('b'); return { code: 0, runtimeId: 'runtime' } }
  const receipt = await f.workspace.run('write and check', owner)
  expect(receipt.sourceUnchanged).toBe(false)
  expect((await f.workspace.check({}, owner)).ok).toBe(false)
})
test('latest failed, cancelled, timed out or throwing job cannot reuse earlier success', async () => {
  for (const result of [{ code: 1 }, { code: 0, cancelled: true }, { code: 0, timedOut: true }, new Error('disconnected')]) {
    const f = fixture(); await f.workspace.run('first', owner)
    f.execution.startJob = async () => { if (result instanceof Error) throw result; return { ...result, runtimeId: 'runtime' } }
    await f.workspace.run('latest', owner).catch(() => {})
    expect((await f.workspace.check({}, owner)).ok).toBe(false)
    expect(f.workspace.commands.at(-1).command).toBe('latest')
  }
})
test('pending operations and snapshot/runtime failures cannot certify completion', async () => {
  const f = fixture(); await f.workspace.run('first', owner)
  let release
  f.execution.startJob = () => new Promise(resolve => { release = resolve })
  const pending = f.workspace.run('next', owner)
  expect((await f.workspace.check({}, owner)).ok).toBe(false)
  await new Promise(resolve => setTimeout(resolve, 0))
  release({ code: 0, runtimeId: 'runtime' }); await pending
  f.execution.snapshot = async () => { throw Error('snapshot conflict') }
  await expect(f.workspace.check({}, owner)).rejects.toThrow('snapshot conflict')
  f.rebind(); await expect(f.workspace.check({}, owner)).rejects.toThrow('binding changed')
})
test('echoed pass text and shell-wrapped commands do not prove declared test execution', async () => {
  for (const command of ['echo pass', 'echo bun run test', 'bun run test || true', 'bun test', 'bun run test; echo pass']) {
    const f = fixture(); await f.workspace.run(command, owner)
    expect(ranDeclaredTests(f.workspace.commands, owner, 'a')).toBe(false)
  }
})

test('real Local Bun receipts reject a command that writes source until a subsequent check', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createCompanion } = await import('../host/companion.js')
  const { LocalExecution } = await import('../src/execution/local.js')
  const root = await mkdtemp(join(tmpdir(), 'askk-eval-receipts-'))
  let companion, execution
  try {
    companion = await createCompanion({ root, port: 0, capabilities: ['fs', 'exec'] })
    execution = new LocalExecution({ url: companion.url, token: companion.token })
    await execution.prepare()
    const workspace = createEvaluationWorkspace(execution)
    await workspace.run('printf original > source.txt', owner)
    expect((await workspace.check({}, owner)).ok).toBe(false)
    await workspace.run('test -s source.txt', owner)
    expect((await workspace.check({}, owner)).ok).toBe(true)
    await workspace.write({ path: 'extra.txt', content: 'new file', expectedRevision: 0 })
    expect((await workspace.check({}, owner)).ok).toBe(false)
    await workspace.run('test -s extra.txt', owner)
    expect((await workspace.check({}, owner)).ok).toBe(true)
    expect(workspace.commands.every(row => row.stage === 'complete' && row.runtimeId && row.inputRevision && row.completedRevision)).toBe(true)
  } finally { await execution?.dispose(); await companion?.close(); await rm(root, { recursive: true, force: true }) }
})

test('real LocalExecution fractional-second timeout stops a shell and its delayed descendant', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createCompanion } = await import('../host/companion.js')
  const { LocalExecution } = await import('../src/execution/local.js')
  const root = await mkdtemp(join(tmpdir(), 'askk-eval-timeout-'))
  let companion, execution
  try {
    companion = await createCompanion({ root, port: 0, capabilities: ['fs', 'exec'] })
    execution = new LocalExecution({ url: companion.url, token: companion.token })
    await execution.prepare()
    const result = await execution.startJob({ program: '/bin/sh', args: ['-c', '(sleep 0.5; touch descendant-ran) & wait'], timeout: 0.1 })
    expect(result.timedOut).toBe(true)
    expect(result.code).not.toBe(0)
    // Wait past the child's scheduled mutation, before disposing the companion:
    // shutdown must not hide a descendant left alive by command timeout.
    await new Promise(resolve => setTimeout(resolve, 650))
    expect(await Bun.file(join(root, 'descendant-ran')).exists()).toBe(false)
  } finally { await execution?.dispose(); await companion?.close(); await rm(root, { recursive: true, force: true }) }
}, 5000)

test('a newer command completed during snapshot collection supersedes the old receipt', async () => {
  const f = fixture(); await f.workspace.run('first', owner)
  let release, first = true
  f.execution.snapshot = async () => {
    if (first) { first = false; return new Promise(resolve => { release = resolve }) }
    return { revision: 'a' }
  }
  const checking = f.workspace.check({}, owner)
  f.execution.startJob = async () => ({ code: 1, runtimeId: 'runtime' })
  await f.workspace.run('new failed command', owner)
  release({ revision: 'a' })
  expect((await checking).ok).toBe(false)
})

test('Bun report requires executed non-skipped tests, independently of exit code', async () => {
  const { bunTestReport } = await import('../scripts/evals/workspace-evidence.js')
  for (const xml of ['', '<testsuites tests="0" skipped="0" failures="0"></testsuites>', '<testsuites tests="1" skipped="1" failures="0"></testsuites>', '<testsuites tests="1" skipped="0" failures="1"></testsuites>']) expect(bunTestReport(xml).passed).toBe(false)
  expect(bunTestReport('<testsuites tests="2" skipped="1" failures="0"></testsuites>')).toMatchObject({ executed: 1, passed: true })
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path')
  const root = await mkdtemp(join(tmpdir(), 'askk-test-discovery-'))
  try {
    for (const [source, passed] of [['export const x = 1', false], ['import {test,expect} from "bun:test";test("works",()=>expect(1).toBe(1))', true]]) {
      await writeFile(join(root, 'example.test.js'), source)
      const process = Bun.spawn([Bun.which('bun'), 'test', '--reporter=junit', `--reporter-outfile=${join(root, 'tests.xml')}`], { cwd: root, stdout: 'ignore', stderr: 'ignore' })
      expect(await process.exited).toBe(0)
      expect(bunTestReport(await readFile(join(root, 'tests.xml'), 'utf8').catch(() => '')).passed).toBe(passed)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('stop gates writes and commands, including a command awaiting its input revision', async () => {
  const f = fixture(), snapshot = deferred()
  let launches = 0
  f.execution.snapshot = () => snapshot.promise
  f.execution.startJob = async () => { launches++; return { code: 0, runtimeId: 'runtime' } }
  const command = f.workspace.run('too late', owner)
  f.workspace.stop()
  const drain = f.workspace.drain()
  expect(f.workspace.drain()).toBe(drain)
  await expect(f.workspace.write({})).rejects.toThrow('stopped')
  await expect(f.workspace.run('also late', owner)).rejects.toThrow('stopped')
  snapshot.resolve({ revision: 'a' })
  await expect(command).rejects.toThrow('stopped')
  await drain
  expect(launches).toBe(0)
})

test('drain waits for admitted writes and exit receipts, retrying cancellation after a late started event', async () => {
  const f = fixture(), launched = deferred(), exit = deferred(), write = deferred()
  let cancellations = 0, drained = false, id
  f.execution.write = () => write.promise
  f.execution.startJob = options => { id = options.id; launched.resolve(); return exit.promise }
  f.execution.cancelJob = async () => { cancellations++; return { ok: cancellations > 1 } }
  const command = f.workspace.run('delayed launch', owner)
  await launched.promise
  const writing = f.workspace.write({})
  f.workspace.stop()
  const drain = f.workspace.drain().then(() => { drained = true })
  await Promise.resolve()
  expect(cancellations).toBe(1)
  f.workspace.onEvent({ type: 'started', jobId: id, runtimeId: 'runtime' })
  await Promise.resolve()
  expect(cancellations).toBe(2)
  expect(drained).toBe(false)
  exit.resolve({ code: -1, runtimeId: 'runtime', cancelled: true })
  await command
  expect(drained).toBe(false)
  write.resolve({ ok: true })
  await writing
  await drain
  expect(f.workspace.commands[0]).toMatchObject({ stage: 'complete', cancelled: true, code: -1 })
  await expect(f.workspace.check({}, owner)).resolves.toMatchObject({ ok: false })
})

test('drain fails closed when a launched command loses its exit receipt or cancellation fails', async () => {
  for (const loseReceipt of [true, false]) {
    const f = fixture(), launched = deferred(), exit = deferred()
    f.execution.startJob = () => { launched.resolve(); return exit.promise }
    f.execution.cancelJob = async () => { if (!loseReceipt) throw new Error('cancel disconnected'); return { ok: false } }
    const command = f.workspace.run('unknown shutdown', owner).catch(() => {})
    await launched.promise
    f.workspace.stop()
    if (loseReceipt) exit.reject(new Error('stream disconnected'))
    else exit.resolve({ code: 0, runtimeId: 'runtime' })
    await command
    await expect(f.workspace.drain()).rejects.toMatchObject({ code: 'EVALUATION_SHUTDOWN_UNCONFIRMED' })
  }
})
