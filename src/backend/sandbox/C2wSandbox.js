import { Outcome, Reason } from '../../core/Outcome.js'
import { Sandbox } from '../../core/sandbox/Sandbox.js'

/** Long enough for a slow command, short enough that a wedged run ends a turn. */
const DEFAULT_TIMEOUT = 120_000

/**
 * What the guest will accept on a command line, in the units it counts.
 *
 * NOT BYTES, which is why this constant and `cost` below are a pair, and it is
 * a FLOOR rather than a boundary, which is why it is 1000 and not the largest
 * number measured. Everything here was swept against the real image in a
 * browser rather than bisected to, because a bisection over one padding
 * character is what hid the space for two waves.
 *
 * WHAT A CHARACTER COSTS. Twelve classes, each bisected in `sh -c <line>`: `a`,
 * `'`, `"`, `$`, `\`, TAB, CR, VT, FF, `;` and `*` all cost exactly one. SPACE
 * and NEWLINE cost two. It is not "whitespace" — tab, CR, VT and FF are all
 * whitespace and all cost one — so `cost` counts those two characters by name.
 * The newline was pinned twice over, once by its own sweep and once by holding
 * a line's length fixed and adding newlines to it: 1, 2, 5 and 20 newlines cost
 * 2, 4, 10 and 40.
 *
 * WHERE THE LINE IS. Two padded shapes refuse at 1,001, swept one length at a
 * time with the `echo` at the END of the line so a silently truncated tail
 * could not pass as a run:
 *
 *     padding   bytes  spaces  cost  the guest
 *     978 x a     996       4  1000  ran
 *     979 x a     997       4  1001  too many write (1025 > 1024)
 *     489 x ' '   507     493  1000  ran
 *     490 x ' '   508     494  1002  too many write (1025 > 1024)
 *
 * The shape that actually ships — this wrapper around `ShellTool`'s frame
 * around a padded command, with two files staged onto it — runs at 1,008 and
 * refuses at 1,009. So the ceiling is NOT one number: it moves by up to eight
 * with the shape, and both figures are multiples of eight, which reads like an
 * alignment somewhere inside c2w rather than a limit anybody wrote down. 1000
 * is therefore the lowest ceiling measured, and this guard is conservative by
 * up to eight on a real line. Deliberately: over-spending is not a polite
 * failure — the guest refuses to boot and answers about an entrypoint the
 * caller never wrote, and `C2wSandbox` used to hand that to the agent as its
 * own command's output.
 *
 * There is NO TRUNCATION BAND. Across 39 swept lengths the guest either ran the
 * whole line or refused before running anything, so a line this guard accepts
 * is the line that ran. The one thing that LOOKED like truncation was ours: see
 * the newline in `wrap`.
 *
 * NOT MEASURED, and a hazard rather than a price: NON-ASCII bytes. A command
 * line with one or ten `é` in it runs normally; twenty wedged the guest so hard
 * that the browser stopped answering the debugger, and a hundred to three
 * hundred came back in ~12 ms with no output and no boot. UTF-8 length is the
 * conservative reading of a region where the guest does not behave, and the
 * region belongs to `public/sandbox/` and the c2w image, which this slice does
 * not own. The trace is in the report.
 *
 * This is the SECOND correction to this number and the first one is why the
 * shape of the measurement is written down here and not just its answer. It was
 * 1024, read out of the guest's own refusal message — a counter that also
 * covers the argv separators, the `arg0` the worker prepends and a time block.
 * Then it was 1,003, bisected with one padding character, and under that byte
 * reading 800 bytes of ordinary shell — about 13% spaces — passed this guard
 * and the guest refused it.
 *
 * There is no chunking: the filesystem does not survive a boot, so a command
 * too long for one call cannot be split across two.
 *
 * The environment is a SECOND channel of the same size and is not used here:
 * 906 bytes of `env` reached the guest beside a command, and 4,000 bytes
 * answered `failed to prepare env info`. It is `public/sandbox/vm-worker.js`
 * that passes `[]` for it.
 */
const MAX_COMMAND_COST = 1000

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
 * measured rather than estimated. 32 of the guest's 1,000, counted the way the
 * guest counts — `sh -c ` and this wrapper together spend 40 and leave a
 * command 960. And no time: bare and wrapped, interleaved against the
 * real image in the same browser, `uname -a` 957 / 965 ms, `ls /nope`
 * 760 / 801 ms, `exit 7` 725 / 741 ms, `false` 723 / 732 ms — the guest boot is
 * the whole cost and 25 bytes do not move it.
 */
const STATUS = '__askk_rc'

/**
 * The NEWLINE before the closing paren is not formatting.
 *
 * MEASURED against the real guest, and it is the defect `scripts/smoke.js`
 * found the first time it sent a command ending in a comment. Everything after
 * `#` is comment to the END OF THE LINE, and this whole wrapper is one line —
 * so `( ls -la # what is here ) ; echo "__askk_rc$?"` loses its own closing
 * paren and the status echo with it, and the guest answers
 * `sh: syntax error: unexpected end of file (expecting ")")`. A comment is
 * something a model writes; the newline costs two of the budget and ends it.
 *
 *     ( echo X #zzz ) ; echo "__askk_rc$?"      sh: syntax error …
 *     ( echo X #zzz \n) ; echo "__askk_rc$?"    X, then __askk_rc0
 */
const wrap = (command) => `( ${command}\n) ; echo "${STATUS}$?"`

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

  /**
   * Bytes of the guest arriving. Assigned by whoever is watching, never
   * subclassed — the same seam `TransformersInference` and `Transcriber` use,
   * and for the same reason: the reporting hook belongs to the caller, and a
   * class per listener would be a class per caller.
   *
   * It matters more here than for either of those. The guest is the single
   * largest thing this app fetches, it is fetched on the FIRST command an agent
   * runs rather than at boot, and until this existed that download reported
   * nothing at all — `CAPABILITIES.md` records a real one at 40,030,146 bytes,
   * and `docs/LEDGER.md` row S24 is that none of it reached a user surface.
   */
  onProgress(_event) {}

  get available() {
    return Boolean(this.imageUrl && this.workerUrl)
  }

  /**
   * The module has been fetched and the worker is up. Not "a command is
   * running" — one boot serves every later command — so this is exactly the
   * question "would using the guest right now cost a download".
   */
  get warm() {
    return Boolean(this._booted)
  }

  /**
   * What a piece of a command line costs this guest.
   *
   * Public, and additive over concatenation, because a caller that puts
   * anything ALONGSIDE the agent's command — `ShellTool` stages files onto the
   * same line — has to price its own text the way the guest will, a fragment at
   * a time. The alternative is a second copy of the rule in a file that cannot
   * see this one, and a second copy is exactly how the byte reading above
   * survived two waves.
   *
   * UTF-8 bytes, not characters, and the difference is not theoretical: a
   * staged file of 400 CJK characters is 1,200 bytes on the wire. Measured in
   * characters it would be waved through and then refused by the guest.
   */
  cost(text) {
    const line = String(text)
    // `split` rather than a counting loop: this is a one-line string on every
    // path but one, and the one exception is a staged file already capped at
    // 64 KiB. Two passes rather than one regex, because a regex here would be
    // the character class the measurement REFUSES — tab, CR, VT and FF are all
    // whitespace and all cost one, and `\s` would charge for them.
    const spaces = line.split(' ').length - 1
    const newlines = line.split('\n').length - 1
    return new TextEncoder().encode(line).length + spaces + newlines
  }

  /**
   * The most a `command` handed to `run` may cost.
   *
   * Declared because a caller that wants to put anything alongside that command
   * has to size it against the guest's real ceiling. Derived from `wrap` rather
   * than written down for the same reason `cost` is a method: the status marker
   * is part of what crosses, so anything added to `wrap` shrinks this without an
   * edit.
   *
   * A `Sandbox` that does not declare one is not refusing; it is saying it has
   * no fixed line length, which is true of every implementation but this one.
   */
  get commandBudget() {
    return MAX_COMMAND_COST - this.cost(`sh -c ${wrap('')}`)
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
    if (data?.type === 'boot-progress') {
      // The same four fields `core/progress.js` gives a weights download, so a
      // page draws one bar and not two. `percent` is 0 when the host sent no
      // `content-length`, which a reader must show as a byte count rather than
      // a bar stuck at nothing.
      const total = Number(data.total) || 0
      this.onProgress({
        status: 'progress',
        file: 'linux guest',
        loaded: Number(data.loaded) || 0,
        total,
        percent: total ? Math.round(((Number(data.loaded) || 0) / total) * 100) : 0,
      })
      return
    }
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
    const line = wrap(command)
    if (this.cost(`sh -c ${line}`) > MAX_COMMAND_COST) {
      // Said in the guest's units and with the rule beside it, because a caller
      // told only "too long" cannot tell whether to cut the command or the
      // whitespace in it — and for a line half made of spaces those are very
      // different edits.
      return Outcome.failed(
        Reason.BAD_REQUEST,
        `the command costs ${this.cost(command)} and the sandbox accepts ${this.commandBudget} — the guest charges one for every byte and one more for every space or newline`,
        {
          hint: 'Write a shorter command, or one with fewer spaces in it. A program that will not fit belongs in the image, not on the command line.',
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
