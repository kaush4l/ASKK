import { Outcome, Reason } from '../../core/Outcome.js'
import { Sandbox } from '../../core/sandbox/Sandbox.js'

/** Long enough for a slow command, short enough that a wedged run ends a turn. */
const DEFAULT_TIMEOUT = 120_000

/**
 * The guest's hard limit on the command it is handed.
 *
 * MEASURED, not guessed: at 1025 bytes the guest prints
 * `too many write (1025 > 1024) failed to prepare entrypoint info` and exits 1
 * before running anything. c2w passes the entrypoint through a fixed-size
 * channel, and a command longer than this cannot be delivered at all.
 *
 * Checked here so the caller is told what the limit is, rather than being given
 * an exit code and a sentence about an entrypoint it never wrote.
 */
const MAX_COMMAND_BYTES = 1024

/**
 * An Alpine userland inside an x86 emulator, running in this tab.
 *
 * The artifact is built by `scripts/wasm/build.sh` with container2wasm. Two
 * measured facts shape everything here:
 *
 *   It needs NO SharedArrayBuffer. It runs with `crossOriginIsolated = false`,
 *   which is what makes it deployable to a static host that cannot set COOP and
 *   COEP headers. That is the whole reason this substrate was chosen.
 *
 *   With no blocking stdin there is no interactive shell, so ONE BOOT RUNS ONE
 *   COMMAND — measured at 814 ms to first output. The filesystem does not
 *   survive between calls.
 *
 * The second is a real limitation and it is stated to the model in the tool's
 * description rather than hidden behind a shell that pretends to be persistent.
 * A long-lived pty was the alternative and it costs more than it looks: it needs
 * blocking stdin, hence SharedArrayBuffer, hence headers this app cannot set —
 * and one malformed command wedges the shell for every later caller.
 *
 * The module is fetched and compiled once and instantiated per command. The
 * download is ~100 MB and compiling is milliseconds, so the module is what is
 * worth keeping; a fresh instance per command is also what makes each command's
 * filesystem clean.
 */
export class C2wSandbox extends Sandbox {
  static LABEL = 'linux sandbox'

  /**
   * @param {{imageUrl: string, workerUrl: string}} options where the guest
   *   image and its host worker are served from. Both are runtime URLs, not
   *   imports: the image is far too large to live in a repository, so the app
   *   is told where it is rather than carrying it.
   */
  constructor({ imageUrl = '', workerUrl = '' } = {}) {
    super()
    this.imageUrl = imageUrl
    this.workerUrl = workerUrl
    this._worker = null
    this._booted = null
    this._pending = new Map()
    this._seq = 0
  }

  get available() {
    return Boolean(this.imageUrl && this.workerUrl)
  }

  /**
   * Boot once, on the first command.
   *
   * Not at construction: the image is ~100 MB, and an agent that never runs a
   * command must not have downloaded it. Concurrent first calls share the one
   * boot rather than starting two.
   */
  async _boot() {
    if (this._booted) return this._booted
    if (!this.available) {
      return Outcome.failed(Reason.UNAVAILABLE, 'no sandbox image is configured', {
        hint: 'Set the sandbox image URL in settings, or build one with scripts/wasm/build.sh.',
      })
    }

    this._booted = new Promise((resolve) => {
      let worker
      try {
        // Classic, not a module: the vendored WASI shim is UMD and loads with
        // importScripts. It is served from public/ rather than bundled because
        // it is paired with an artifact no bundler should ever see.
        worker = new Worker(this.workerUrl, { name: 'sandbox' })
      } catch (err) {
        resolve(
          Outcome.failed(Reason.UNAVAILABLE, `the sandbox worker did not start: ${err?.message}`, {
            hint: `Check that ${this.workerUrl} is being served.`,
          }),
        )
        return
      }

      worker.addEventListener('message', (event) => this._receive(event.data, resolve))
      worker.addEventListener('error', (event) => {
        const message = event.message || 'the sandbox worker stopped'
        for (const [, settle] of this._pending) {
          settle(Outcome.failed(Reason.UNAVAILABLE, message))
        }
        this._pending.clear()
        resolve(Outcome.failed(Reason.UNAVAILABLE, message))
      })

      this._worker = worker
      worker.postMessage({ type: 'boot', wasmUrl: this.imageUrl })
    })
    return this._booted
  }

  _receive(data, resolveBoot) {
    if (data?.type === 'booted') {
      resolveBoot(Outcome.ok({ bytes: data.bytes }))
      return
    }
    if (data?.type === 'boot-failed') {
      resolveBoot(
        Outcome.failed(Reason.UNAVAILABLE, `the sandbox image did not load: ${data.message}`, {
          hint: 'Check the image URL, and that the file is complete.',
        }),
      )
      return
    }
    if (data?.type === 'result') {
      const settle = this._pending.get(data.id)
      if (!settle) return
      this._pending.delete(data.id)
      settle(data)
    }
  }

  /**
   * Run one command line.
   *
   * `sh -c` rather than a parsed argv: the model writes a command the way it
   * would type one, pipes and redirection included, and splitting that here
   * would mean writing a shell parser to hand a shell something it can already
   * parse.
   */
  async run(command, { timeout = DEFAULT_TIMEOUT } = {}) {
    const booted = await this._boot()
    if (!booted.ok) return booted

    // `sh -c ` and the command, which is what actually crosses the channel.
    const size = new TextEncoder().encode(`sh -c ${command}`).length
    if (size > MAX_COMMAND_BYTES) {
      return Outcome.failed(
        Reason.BAD_REQUEST,
        `the command is ${size} bytes and the sandbox accepts at most ${MAX_COMMAND_BYTES}`,
        {
          hint: 'Write a shorter command. A program that will not fit belongs in the image, not on the command line.',
        },
      )
    }

    const id = `c${++this._seq}`
    const settled = new Promise((resolve) => this._pending.set(id, resolve))
    this._worker.postMessage({ type: 'run', id, argv: ['sh', '-c', command] })

    // The guest runs synchronously inside the worker, so a command that never
    // returns blocks that worker for ever and no later command can run. The
    // worker is terminated rather than waited on — there is nothing to
    // interrupt, and a fresh one boots in under a second.
    const expired = new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), timeout))
    const finished = await Promise.race([settled, expired])

    if (finished?.timedOut) {
      this._pending.delete(id)
      await this.close()
      return Outcome.failed(Reason.UNAVAILABLE, `the command did not finish within ${timeout}ms`, {
        hint: 'The sandbox was restarted. Try a smaller piece of work — this is an emulator, and it is about a hundred times slower than the machine it runs on.',
      })
    }

    if (finished instanceof Outcome) return finished
    if (!finished.ok) {
      return Outcome.failed(Reason.INTERNAL, `the sandbox failed: ${finished.message}`)
    }

    const notes = []
    // A trap is not an exit status. Reported as a note so a strange result has
    // an explanation attached rather than looking like the command's own output.
    if (finished.trap) notes.push(`the guest stopped abnormally: ${finished.trap}`)

    // The guest's console is a terminal, so every line ends CRLF. Measured, not
    // assumed: `stty -onlcr` does not stick across a boot, so the stripping has
    // to happen on this side. Left in, a stray \r rides into the transcript and
    // then into the next prompt.
    const stdout = String(finished.stdout ?? '').replaceAll('\r\n', '\n')
    return Outcome.ok({ stdout, code: finished.code ?? 0 }, notes)
  }

  async close() {
    this._worker?.terminate()
    this._worker = null
    this._booted = null
    for (const [, settle] of this._pending) {
      settle(Outcome.failed(Reason.UNAVAILABLE, 'the sandbox was shut down'))
    }
    this._pending.clear()
  }
}
