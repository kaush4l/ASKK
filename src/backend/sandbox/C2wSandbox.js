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
 * The guest's exit status, asked for on stdout because the channel does not
 * carry it.
 *
 * MEASURED through the real image, in a browser, through this module: c2w's
 * `proc_exit` is the EMULATOR's, and it is 0 whatever ran inside. `ls /nope`,
 * `false`, `exit 7` and `sh -c "exit 3"` all came back 0, while
 * `ls /nope; echo $?` printed 1 INSIDE the guest — the shell knows and the
 * module does not pass it out. So the shell is asked to print what it knows.
 *
 * It is paid for in the two currencies that were argued about, and both were
 * measured rather than estimated. 25 bytes of the 1024-byte budget, which
 * leaves a command 993. And no time: bare and wrapped, interleaved against the
 * real image in the same browser, `uname -a` 957 / 965 ms, `ls /nope`
 * 760 / 801 ms, `exit 7` 725 / 741 ms, `false` 723 / 732 ms — the guest boot is
 * the whole cost and 25 bytes do not move it.
 */
const STATUS = '__askk_rc'
const wrap = (command) => `( ${command} ) ; echo "${STATUS}$?"`

/**
 * Anchored at the END, and both reasons are measured rather than guessed. fd 2
 * shares this buffer with fd 1, so the marker is not necessarily on a line of
 * its own; and a command whose own output has no trailing newline runs straight
 * into it — `printf abc` comes back `abc__askk_rc0`. A command that prints the
 * marker itself is answered correctly for the same reason: the last one wins.
 */
const STATUS_LINE = new RegExp(`${STATUS}(\\d+)\\n?$`)

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
 * download is 40,029,960 gzipped bytes that inflate to a 107,054,914-byte
 * module, and compiling is milliseconds, so the module is what is worth
 * keeping; a fresh instance per command is also what makes each command's
 * filesystem clean.
 */
export class C2wSandbox extends Sandbox {
  static LABEL = 'linux sandbox'

  /**
   * @param {{imageUrl: string, workerUrl: string}} options where the guest
   *   image and its host worker are served from. Both are runtime URLs, not
   *   imports, because both live in `public/`: a bundler must never walk into a
   *   107 MB module or a vendored UMD shim, so the pair is fetched by address.
   *   `composition.js` derives both from the base path — they ship side by side
   *   in the export — and nothing here needs to know what that address is.
   */
  constructor({ imageUrl = '', workerUrl = '' } = {}) {
    super()
    this.imageUrl = imageUrl
    this.workerUrl = workerUrl
    this._worker = null
    this._booted = null
    this._pending = new Map()
    this._seq = 0
    this._announced = false
  }

  get available() {
    return Boolean(this.imageUrl && this.workerUrl)
  }

  /**
   * Boot once, on the first command.
   *
   * Not at construction: the image is 38 MiB on the wire and 102 MiB in memory,
   * and an agent that never runs a command must not have downloaded it.
   * Concurrent first calls share the one boot rather than starting two.
   */
  async _boot() {
    if (this._booted) return this._booted

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
      resolveBoot(Outcome.ok({ bytes: data.bytes, transferred: data.transferred }))
      return
    }
    if (data?.type === 'boot-failed') {
      resolveBoot(
        Outcome.failed(Reason.UNAVAILABLE, `the sandbox image did not load: ${data.message}`, {
          // The one failure a real deploy can hit, so the hint names the two
          // controls that exist and no others. What ships is the gzipped image;
          // a clone that has never run the build has neither it nor the raw
          // module, and a host that will not serve 38 MiB has to be pointed
          // elsewhere at build time. There is no setting for this and there
          // should not be: see `composition.js`.
          hint: 'Build the guest with scripts/wasm/build.sh into public/sandbox/, or point the build at a hosted copy with SANDBOX_IMAGE=<url>.',
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

    // The WRAPPER is what crosses the channel, so the wrapper is what the cap
    // is measured against. Checked bare, a command that only just fitted would
    // arrive truncated and the guest would answer about an entrypoint the
    // caller never wrote.
    const encoder = new TextEncoder()
    const line = wrap(command)
    const sent = encoder.encode(`sh -c ${line}`).length
    if (sent > MAX_COMMAND_BYTES) {
      const own = encoder.encode(command).length
      return Outcome.failed(
        Reason.BAD_REQUEST,
        `the command is ${own} bytes and the sandbox accepts at most ${MAX_COMMAND_BYTES - (sent - own)}`,
        {
          hint: 'Write a shorter command. A program that will not fit belongs in the image, not on the command line.',
        },
      )
    }

    const id = `c${++this._seq}`
    const settled = new Promise((resolve) => this._pending.set(id, resolve))
    this._worker.postMessage({ type: 'run', id, argv: ['sh', '-c', line] })

    // The guest runs synchronously inside the worker, so a command that never
    // returns blocks that worker for ever and no later command can run. The
    // worker is terminated rather than waited on: there is nothing to interrupt.
    // The compiled module dies with it, so the next command pays for the whole
    // image again — under a second over loopback, and a 38 MiB download plus an
    // inflate on a deploy. That is the price of the only interruption there is.
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

    // Said ONCE for this boot rather than on every result: both are properties
    // of the IMAGE, not of the command, and a constant line on every
    // observation is paid again on every turn of every run. Said at all because
    // `vm-worker.js` computes both and nothing read either — its own comment
    // promises the stubbed calls are reported, and a socket that fails silently
    // is the worst of the available answers.
    if (!this._announced) {
      this._announced = true
      // Both numbers, because they differ on the deploy and only one of them is
      // what the visitor paid. The image ships gzipped — 40,029,960 bytes on the
      // wire for a 107,054,914-byte module — since a file over 100 MiB cannot be
      // in the repository this project is served from at all.
      const { bytes, transferred } = booted.value ?? {}
      if (bytes) {
        notes.push(
          transferred < bytes
            ? `the sandbox image is ${bytes} bytes, fetched once for this tab as ${transferred} compressed`
            : `the sandbox image is ${bytes} bytes, fetched once for this tab`,
        )
      }
      if (finished.stubbed?.length) {
        notes.push(
          `not implemented in this sandbox, answering ENOTSUP: ${finished.stubbed.join(', ')}`,
        )
      }
    }

    // The guest's console is a terminal, so every line ends CRLF. Measured, not
    // assumed: `stty -onlcr` does not stick across a boot, so the stripping has
    // to happen on this side. Left in, a stray \r rides into the transcript and
    // then into the next prompt. Done before the status is matched, because the
    // marker arrives with the same line ending as everything else.
    const raw = String(finished.stdout ?? '').replaceAll('\r\n', '\n')
    const status = raw.match(STATUS_LINE)
    // No marker means the shell never reached the echo: a trap, a guest that
    // died mid-command, or a command whose own quoting swallowed it. The
    // emulator's code stands in that case, which is the old always-zero answer
    // — wrong, but it is the only number there is, and the trap note above is
    // usually beside it.
    if (!status) return Outcome.ok({ stdout: raw, code: finished.code ?? 0 }, notes)
    return Outcome.ok({ stdout: raw.slice(0, status.index), code: Number(status[1]) }, notes)
  }

  async close() {
    this._worker?.terminate()
    this._worker = null
    this._booted = null
    this._announced = false
    for (const [, settle] of this._pending) {
      settle(Outcome.failed(Reason.UNAVAILABLE, 'the sandbox was shut down'))
    }
    this._pending.clear()
  }
}
