import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { C2wSandbox } from '../../../src/backend/sandbox/C2wSandbox.js'
import { Reason } from '../../../src/core/Outcome.js'

/**
 * `C2wSandbox` had no test file at all, and the browser step that proves it
 * cannot see most of what it does: the boot-failure hint, the byte cap, the
 * timeout, the worker's `error` event and the id routing all sit on paths a
 * healthy 107 MB guest never takes. Deleting the hint entirely left the whole
 * gate green.
 *
 * A fake worker rather than a real one. What is under test is this module's
 * half of the protocol — what it sends, what it does with what comes back —
 * and that half is decided before a single byte of wasm is fetched. The other
 * half, what the real guest's shell actually prints, is proved in
 * `scripts/smoke.js` against the real image and can be proved nowhere else.
 */
/**
 * What the fake worker replies with. A module-level binding rather than a
 * constructor argument because `new Worker(...)` happens INSIDE the module
 * under test, so there is no call site to hand it in at — and a subclass per
 * test would be a hierarchy whose whole body is one assignment.
 */
let answer = () => undefined

class FakeWorker {
  constructor(url) {
    this.url = url
    this.sent = []
    this.terminated = false
    this._listeners = { message: [], error: [] }
    FakeWorker.last = this
  }

  addEventListener(type, fn) {
    this._listeners[type].push(fn)
  }

  postMessage(message) {
    this.sent.push(message)
    const reply = answer(message)
    if (reply !== undefined) queueMicrotask(() => this.say(reply))
  }

  /** What the real worker does when it posts back. */
  say(data) {
    for (const fn of this._listeners.message) fn({ data })
  }

  /** What the browser does when the worker itself dies. */
  break(message) {
    for (const fn of this._listeners.error) fn({ message })
  }

  terminate() {
    this.terminated = true
  }
}

/** A worker that boots, then answers each run from a queue of results. */
const boots = (results, bytes = 107054914) => {
  answer = (message) => {
    if (message.type === 'boot') return { type: 'booted', bytes }
    const next = results.shift()
    return next === undefined ? undefined : { type: 'result', id: message.id, ok: true, ...next }
  }
}

const box = () =>
  new C2wSandbox({
    imageUrl: '/ASKK/sandbox/sandbox.wasm',
    workerUrl: '/ASKK/sandbox/vm-worker.js',
  })

const realWorker = globalThis.Worker
beforeEach(() => {
  globalThis.Worker = FakeWorker
})
afterEach(() => {
  globalThis.Worker = realWorker
})

describe('C2wSandbox', () => {
  test('an image that will not load answers with the two controls that exist', async () => {
    // The one failure a real deploy hits: the image is gitignored and larger
    // than GitHub will host, so the project's own target serves a 404 here.
    // This sentence is the only thing anyone is told about it.
    answer = () => ({ type: 'boot-failed', message: 'HTTP 404 for /ASKK/sandbox/sandbox.wasm' })

    const ran = await box().run('uname -a')

    expect(ran.ok).toBe(false)
    expect(ran.failure.code).toBe(Reason.UNAVAILABLE)
    expect(ran.failure.message).toBe(
      'the sandbox image did not load: HTTP 404 for /ASKK/sandbox/sandbox.wasm',
    )
    expect(ran.failure.hint).toBe(
      'Build the guest with scripts/wasm/build.sh into public/sandbox/, or point the build at a hosted copy with SANDBOX_IMAGE=<url>.',
    )
  })

  test('the command that crosses the channel is wrapped so the shell reports its own status', async () => {
    boots([{ stdout: '', code: 0 }])
    const sandbox = box()

    await sandbox.run('uname -a')

    expect(FakeWorker.last.sent.at(-1).argv).toEqual([
      'sh',
      '-c',
      '( uname -a\n) ; echo "__askk_rc$?"',
    ])
  })

  test('a command that ends in a comment does not swallow the wrapper', async () => {
    // A `#` comments to the END OF THE LINE and this whole wrapper is one line,
    // so without the newline the closing paren and the status echo are inside
    // the comment. Found by `scripts/smoke.js` against the real guest, which
    // answered `sh: syntax error: unexpected end of file (expecting ")")` — a
    // command that ran nothing, reported as the command's own output. Two of
    // the budget, and a model writing `ls -la # what is here` is not exotic.
    boots([{ stdout: '__askk_rc0\r\n', code: 0 }])

    await box().run('ls -la # what is here')

    const line = FakeWorker.last.sent.at(-1).argv[2]
    expect(line).toBe('( ls -la # what is here\n) ; echo "__askk_rc$?"')
    expect(line.slice(line.indexOf('#')).includes('\n')).toBe(true)
  })

  test('the status is taken off the end and the marker never reaches the caller', async () => {
    // CRLF because the guest's console is a terminal, which is also why the
    // stripping has to happen before the match.
    boots([{ stdout: 'ls: /nope: No such file or directory\r\n__askk_rc1\r\n', code: 0 }])

    const ran = await box().run('ls /nope')

    expect(ran.value).toEqual({ stdout: 'ls: /nope: No such file or directory\n', code: 1 })
  })

  test('output with no trailing newline runs into the marker, and is still separated', async () => {
    // Measured against the real guest: `printf abc` comes back `abc__askk_rc0`.
    boots([{ stdout: 'abc__askk_rc0\r\n', code: 0 }])

    expect((await box().run('printf abc')).value).toEqual({ stdout: 'abc', code: 0 })
  })

  test('a command that prints the marker itself is read by the last one, not the first', async () => {
    boots([{ stdout: '__askk_rc9\r\n__askk_rc0\r\n', code: 0 }])

    expect((await box().run('echo "__askk_rc9"')).value).toEqual({
      stdout: '__askk_rc9\n',
      code: 0,
    })
  })

  test('no marker at all leaves the output whole and falls back to the emulator', async () => {
    // The shell never reached the echo — a trap, or a quote of the caller's own
    // that swallowed it. Measured: `echo "unbalanced` takes this path.
    boots([{ stdout: 'sh: syntax error\r\n', code: 0, trap: 'unreachable' }])

    const ran = await box().run('echo "unbalanced')

    expect(ran.value).toEqual({ stdout: 'sh: syntax error\n', code: 0 })
    expect(ran.notes).toContain('the guest stopped abnormally: unreachable')
  })

  test('the cap is measured against the wrapper, not the bare command', async () => {
    // 1,000 is the guest's own hard limit on `sh -c <line>` — past it nothing
    // runs at all — and `sh -c ` plus the wrapper spend 38 of it.
    //
    // The numbers here were 1024/993, then 1003/972, and every one of them was
    // wrong. 1024 is the figure inside the guest's own refusal, and that counter
    // also covers the argv separators, the `arg0` the worker prepends and a time
    // block. 1,003 was a bisection over one padding character, which cannot see
    // that the guest charges a space twice. The sweep that found it is in
    // `C2wSandbox`.
    boots([{ stdout: '__askk_rc0\r\n', code: 0 }])
    const fits = await box().run('a'.repeat(962))
    expect(fits.ok).toBe(true)

    boots([])
    const over = await box().run('a'.repeat(963))
    expect(over.ok).toBe(false)
    expect(over.failure.code).toBe(Reason.BAD_REQUEST)
    expect(over.failure.message).toBe(
      'the command costs 963 and the sandbox accepts 962 — the guest charges one for every byte and one more for every space or newline',
    )
  })

  test('a command of spaces is refused at half the length one of letters is', async () => {
    // THE defect, in the one place a unit test can see it: the arithmetic. c2w
    // escapes the argv it is handed, so a space crosses as two characters, and
    // a guard that counted bytes passed 800 bytes of ordinary shell — about 130
    // spaces — which the real guest then refused with `too many write (1025 >
    // 1024)`. What the agent read back was the emulator complaining about an
    // entrypoint it never wrote, returned as the command's own output.
    //
    // 800 bytes here, well inside the 962 a byte count would allow, and 1,200
    // in the units the guest actually counts. `scripts/smoke.js` runs the same
    // shape through the real guest, because only a guest can prove which of the
    // two rules is the guest's.
    const sandbox = box()
    boots([])

    const spaced = await sandbox.run('a '.repeat(400))

    expect(spaced.ok).toBe(false)
    expect(spaced.failure.message).toBe(
      'the command costs 1200 and the sandbox accepts 962 — the guest charges one for every byte and one more for every space or newline',
    )
  })

  test('the budget it declares is the budget it enforces', async () => {
    // `ShellTool` prices the files it stages onto this line against this number
    // and this method, and a second copy of either in that file could not see
    // this one. Asserted as an IDENTITY between the getter and the guard rather
    // than as a constant: anything added to `wrap` has to shrink both together
    // or fail here.
    const sandbox = box()

    boots([{ stdout: '__askk_rc0\r\n', code: 0 }])
    expect((await sandbox.run('a'.repeat(sandbox.commandBudget))).ok).toBe(true)

    boots([])
    expect((await sandbox.run('a'.repeat(sandbox.commandBudget + 1))).ok).toBe(false)
    // And the same budget spent on whitespace, which is where the two readings
    // of it part company.
    expect((await sandbox.run(' '.repeat(sandbox.commandBudget))).ok).toBe(false)
  })

  test('what the image is and what it cannot do are said once for the boot, not on every result', async () => {
    // `vm-worker.js` computes both and, until they were read here, nothing read
    // either. Said once because both describe the IMAGE: a constant line on
    // every observation is paid again on every turn of every run.
    boots([
      { stdout: '__askk_rc0\r\n', code: 0, stubbed: ['sock_accept'] },
      { stdout: '__askk_rc0\r\n', code: 0, stubbed: ['sock_accept'] },
    ])
    const sandbox = box()

    const first = await sandbox.run('true')
    const second = await sandbox.run('true')

    expect(first.notes).toEqual([
      'the sandbox image is 107054914 bytes, fetched once for this tab',
      'not implemented in this sandbox, answering ENOTSUP: sock_accept',
    ])
    expect(second.notes).toEqual([])
  })

  test('a command that never answers is given up on, and the worker with it', async () => {
    boots([])
    const sandbox = box()

    const ran = await sandbox.run('sleep 9999', { timeout: 10 })

    expect(ran.ok).toBe(false)
    expect(ran.failure.message).toBe('the command did not finish within 10ms')
    expect(FakeWorker.last.terminated).toBe(true)
    // And the next command boots a fresh one rather than posting into a corpse.
    boots([{ stdout: '__askk_rc0\r\n', code: 0 }])
    expect((await sandbox.run('true')).ok).toBe(true)
  })

  test('a worker that dies takes every waiting caller with it, not just the first', async () => {
    boots([])
    const sandbox = box()
    const both = Promise.all([sandbox.run('one'), sandbox.run('two')])
    await Bun.sleep(0)

    FakeWorker.last.break('the sandbox worker stopped')

    for (const ran of await both) {
      expect(ran.ok).toBe(false)
      expect(ran.failure.code).toBe(Reason.UNAVAILABLE)
    }
  })

  test('two commands in flight are told apart by id', async () => {
    boots([])
    const sandbox = box()
    const both = Promise.all([sandbox.run('one'), sandbox.run('two')])
    await Bun.sleep(0)

    // Answered out of order on purpose: the map is what routes them, and a
    // module that used a single settle would hand both callers the same reply.
    const worker = FakeWorker.last
    const ids = worker.sent.filter((message) => message.type === 'run').map((message) => message.id)
    worker.say({ type: 'result', id: ids[1], ok: true, stdout: 'two__askk_rc2\r\n', code: 0 })
    worker.say({ type: 'result', id: ids[0], ok: true, stdout: 'one__askk_rc1\r\n', code: 0 })

    const [one, two] = await both
    expect(one.value).toEqual({ stdout: 'one', code: 1 })
    expect(two.value).toEqual({ stdout: 'two', code: 2 })
  })
})
