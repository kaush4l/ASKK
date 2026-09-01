import { Outcome } from '../Outcome.js'
import { filesOr, MAX_FILE_BYTES } from './FilesPort.js'
import { Tool } from './Tool.js'

/**
 * How much output a model can usefully read before it is all context and no
 * answer.
 *
 * `ReadFileTool` has a constant of the same size and they are NOT one knob
 * shared by two files. This one bounds what a COMMAND printed, which is
 * unbounded and often accidental — `find /` — and wants a cap for that reason.
 * That one bounds a file the agent wrote itself and would be moved by an
 * argument about how much of its own work it should see at once.
 */
const MAX_OUTPUT = 4000

/** Where the agent's files appear inside the guest, and where the command runs. */
const WORKDIR = '/w'

/**
 * The two markers the harvest frame writes on stdout.
 *
 * Read from the END of the stream — the last line equal to `__askk_fs` is this
 * frame's, because the frame runs after the command and a command cannot print
 * anything after it has exited. A command that prints the marker itself is
 * therefore answered correctly, for the same reason and by the same rule as the
 * exit-status marker in `C2wSandbox`.
 *
 * The bare `echo` before it in `frame` is why the marker is on a line at all.
 * MEASURED in the browser against the real guest, and it failed there first:
 * `cat` a file with no trailing newline and the output runs straight into the
 * marker — `written before the reload__askk_fs` — so nothing matched, the
 * whole harvest was handed to the model as output, and its own files were
 * quoted back at it in base64. It is the same defect `C2wSandbox` records for
 * the status marker, which is anchored rather than line-matched for exactly
 * this reason; five bytes of the command budget buy the guarantee here.
 */
const HARVEST = '__askk_fs'
const FILE = '__askk_f'

/**
 * What one call may bring back out of the guest.
 *
 * Not a storage limit — a blast radius. `cp -r /bin /w` is one plausible
 * command away from pushing twelve megabytes of BusyBox into a database the
 * user cannot easily empty, and the guest will do it in under a second because
 * the outward channel is nearly free (measured: 512 KiB of base64 crossed in
 * 1,311 ms against 968 ms for 16 KiB, so the cost is the boot and not the
 * bytes). Whatever is over the cap is NAMED in a note rather than dropped
 * quietly.
 */
const MAX_HARVEST_FILES = 32
const MAX_HARVEST_BYTES = 256 * 1024

/**
 * The command length the model is told about, in the guest's own units.
 *
 * Stated rather than derived, because the tool is constructed with no sandbox
 * in `scripts/dryrun.js` and a description that changed shape when a sandbox
 * was absent would make every prompt measurement taken there a measurement of a
 * different prompt. The real room is the guest's budget less this file's frame
 * — 962 less 159, so 803 — and 800 is that with three to spare.
 *
 * The number is unchanged and the SENTENCE around it is not, which is the whole
 * repair. It used to say "bytes", and 800 bytes of ordinary shell carries about
 * 130 spaces, so the limit the model was given was one the guest refused: the
 * measurement is in `C2wSandbox`, and `scripts/smoke.js` runs such a command
 * against the real guest because no fake can. Telling the model the pricing
 * rule costs five words — measured through `scripts/dryrun.js`, six tokens a
 * turn — and is the only version of this sentence that is true for a command
 * with spaces in it. It says space and not "space or newline", though a newline
 * costs the same two: this parameter is one command LINE, so the newline is a
 * case the guard has to price and the prompt does not have to teach.
 *
 * It cannot drift: `test/core/tools/ShellTool.test.js` asserts it against
 * `C2wSandbox`'s own budget minus `frame`, so shortening the frame or moving
 * the guest's ceiling fails there rather than here.
 */
const STATED_ROOM = 800

const count = (n) => n.toLocaleString('en-US')

/** A shell word that means exactly this string, whatever is in it. */
const quoted = (text) => `'${String(text).replaceAll("'", `'\\''`)}'`

/**
 * The command line that runs the agent's command with its files around it.
 *
 * Written as one function of its inputs so that its own cost can be MEASURED —
 * `sandbox.cost(frame('', ''))` is the overhead, and the staging budget below
 * is derived from it rather than from a number somebody counted once and left
 * to rot.
 *
 * `_r` and `exit $_r` are not decoration. `C2wSandbox` reads the exit status
 * from an `echo` it appends AFTER this whole line, so without them the status
 * the agent is told about would be `base64`'s and not its own command's.
 *
 * Nor is the NEWLINE after the command. Everything from a `#` runs to the end
 * of the line and this is all one line, so a command ending in a comment —
 * something a model writes — would swallow the closing paren, the status
 * capture and the whole harvest, and the guest would answer
 * `sh: syntax error: unexpected end of file (expecting ")")`. `C2wSandbox.wrap`
 * carries the same newline for the same reason and records the measurement.
 */
const frame = (command, staging) =>
  `mkdir -p ${WORKDIR};cd ${WORKDIR}||exit 1;${staging}( ${command}\n);_r=$?;echo;echo ${HARVEST};find . -type f|while IFS= read -r f;do echo ${FILE} "$f";base64 "$f";done;exit $_r`

/**
 * Run a shell command in the sandbox, with the agent's files in it.
 *
 * This is the first tool in this tree that does something the prompt cannot
 * contain — which is the bar a tool has to clear. Everything the agent could
 * be told, it is told; this is for the things it has to go and find out.
 *
 * THE ASYMMETRY THIS IS BUILT AROUND, measured through the real guest rather
 * than reasoned about. The channel INTO the guest is the command line and
 * nothing else: `argv` is the only thing crossing, and c2w refuses the whole
 * boot past a fixed budget, whereupon it prints `too many write (1025 > 1024)`
 * and never runs. That budget is NOT A BYTE COUNT — the guest charges a space
 * twice — so everything below is priced with `sandbox.cost` rather than
 * measured with a length, and `C2wSandbox` owns the rule and the sweep it came
 * from. A fresh boot is ~950 ms and its filesystem does not survive, so the
 * inward rate is about a kilobyte a second and cannot be chunked across calls.
 * The channel OUT is stdout, and it is effectively free: 512 KiB of base64 came
 * back in 1,311 ms against 968 ms for 16 KiB.
 *
 * So the bridge is deliberately lopsided, because the guest is:
 *
 *   IN    only the files the command NAMES, and only while they fit. A file
 *         that does not fit is said out loud with both numbers, because the
 *         alternative is a command that silently reads an empty directory.
 *   OUT   everything left in the working directory, always.
 *
 * The straight way to close that gap is a REAL filesystem rather than a
 * command line, and it is nearly there: the guest already mounts a WASI
 * preopen — `wasi0 on /share type 9p` appears in its own `mount` output when
 * one is passed — and the only reason files cannot be read through it is that
 * the vendored `browser_wasi_shim` leaves `fd_pread`/`fd_pwrite` unimplemented
 * and answers `path_filestat_get(".")` with -1. That is three methods in
 * `public/sandbox/`, which this slice does not own; the trace is in the report.
 */
export class ShellTool extends Tool {
  constructor({ sandbox, files = null, description = '' } = {}) {
    super({
      name: 'shell',
      description:
        description ||
        `Run a command in a private Linux sandbox and read its output. BusyBox and the Alpine base tools are available. Nothing is shared with the user’s machine and there is no network. It runs in ${WORKDIR}: any of your own files whose path the command mentions are put there first, and every file left there afterwards is saved back to your files. Nothing else in the guest survives the call. The command line cannot exceed ${STATED_ROOM} bytes, counting each space as two.`,
      parameters: {
        command: {
          type: 'string',
          required: true,
          description: 'The command line, run by /bin/sh. Quote it as you would in a terminal.',
        },
      },
    })
    this.sandbox = sandbox
    this.files = filesOr(files)
  }

  /**
   * How much of the command line this call may spend, or 0 to send it bare.
   *
   * Three things have to be true and none is assumed. There has to be a store
   * that can be LISTED — asked as a capability rather than as `!== NO_FILES`,
   * because the identity test was the only thing keeping a store with no `list`
   * from reaching `this.files.list()` and throwing. And the sandbox has to
   * declare both a budget and the rule for spending it, because staging that
   * guesses either wrong does not fail politely: it produces a boot that
   * refuses to run and reports an entrypoint the agent never wrote.
   */
  _budget() {
    const declared = this.sandbox?.commandBudget
    if (typeof this.files?.list !== 'function') return 0
    if (typeof this.sandbox?.cost !== 'function') return 0
    return typeof declared === 'number' ? declared : 0
  }

  /**
   * The staging prefix, and what it could not carry.
   *
   * Only files the command MENTIONS. A workspace is stated in the prompt but
   * handed to the guest one file at a time, and the difference matters at this
   * budget: staging everything would fail the moment the workspace passed a
   * kilobyte, which is roughly the third file. Matching on the written path is
   * what a person reading the command would do, and it costs nothing to be
   * wrong in the harmless direction.
   */
  static _stage(wanted, room, cost) {
    // Directories first and in one call: a nested path cannot be written until
    // its folder exists, and `mkdir -p` costs the same for one as for ten.
    const folders = [
      ...new Set(wanted.map((file) => file.path.split('/').slice(0, -1).join('/')).filter(Boolean)),
    ]
    const prelude = folders.length ? `mkdir -p ${folders.map(quoted).join(' ')};` : ''

    // Priced, not measured, and priced ONCE per file: the line is what crosses,
    // so what a file costs is what its own `printf` costs — its bytes, its
    // quoting, its path, and one more for every space and every newline in any
    // of them. The newlines are why this is not a length: a forty-line note is
    // forty over what a byte count would have charged for it, and a byte count
    // is what was charged until this wave.
    const placing = wanted.map((file) => {
      const line = `printf %s ${quoted(file.text)}>${quoted(file.path)};`
      return { path: file.path, line, needs: cost(line) }
    })

    const lines = []
    const placed = []
    const missed = []
    // Cheapest first, so that one oversized file cannot cost the command three
    // small ones that would all have fitted beside it.
    for (const file of placing.sort((a, b) => a.needs - b.needs)) {
      // The prelude is counted from the first file on, whether or not it has
      // been emitted yet: it is emitted the moment any file is placed, and a
      // budget that only notices it afterwards is a budget that overspends.
      const spent = cost(prelude) + cost(lines.join(''))
      if (spent + file.needs > room) {
        missed.push({ path: file.path, needs: file.needs, spare: room - spent })
        continue
      }
      lines.push(file.line)
      placed.push(file.path)
    }
    return { staging: lines.length ? prelude + lines.join('') : '', missed, placed }
  }

  /**
   * Split the guest's stdout into what the command said and what it left behind.
   *
   * @returns {{body: string, harvested: Array<{path: string, text: string, bytes: number}>,
   *   unreadable: string[]}}
   */
  static _split(stdout) {
    const lines = stdout.split('\n')
    const at = lines.lastIndexOf(HARVEST)
    // No marker means the frame never reached the end — a trap, or a command
    // that killed the shell. Everything is output, which is the honest reading:
    // nothing was proved to have been left behind.
    if (at < 0) return { body: stdout, harvested: [], unreadable: [] }

    const harvested = []
    const unreadable = []
    let path = ''
    let encoded = ''
    const settle = () => {
      if (!path) return
      const decoded = ShellTool._decode(encoded)
      if (decoded === null) unreadable.push(path)
      else harvested.push({ path, text: decoded, bytes: encoded ? (encoded.length / 4) * 3 : 0 })
      path = ''
      encoded = ''
    }
    for (const line of lines.slice(at + 1)) {
      if (line.startsWith(`${FILE} `)) {
        settle()
        // `find .` writes every path with a leading `./`, which is the guest's
        // way of saying the directory it was told to look in, not part of the
        // name.
        path = line.slice(FILE.length + 1).replace(/^\.\//, '')
        continue
      }
      if (path) encoded += line.trim()
    }
    settle()
    return { body: lines.slice(0, at).join('\n'), harvested, unreadable }
  }

  /**
   * Base64 back to text, or null when it was never text.
   *
   * `fatal` is the whole point. A guest file full of ELF is decodable as
   * base64 and is NOT decodable as UTF-8, and storing it as a string of
   * replacement characters would put a file in the workspace that reads like
   * the agent's own work and is not. It is refused by name instead.
   */
  static _decode(encoded) {
    if (!encoded) return ''
    try {
      const binary = atob(encoded)
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      return null
    }
  }

  async call({ command } = {}) {
    const line = typeof command === 'string' ? command.trim() : ''
    if (!line) {
      // Not a failure: the model asked for nothing and can be told so in the
      // same breath it would read a result.
      return Outcome.ok('no command was given, so nothing ran')
    }
    if (!this.sandbox?.available) {
      return Outcome.ok(
        'the sandbox is not available, so no command can run. Answer without it, and say that you could not run anything.',
      )
    }

    const budget = this._budget()
    const notes = []
    let sent = line
    let framed = false

    if (budget) {
      const listed = await this.files.list()
      notes.push(...listed.notes)
      if (!listed.ok) {
        notes.push(`your files could not be reached, so none were placed in ${WORKDIR}`)
      }
      // Priced by the sandbox, because only the sandbox knows what its guest
      // charges. `_budget` has already established that it can be asked.
      const cost = (text) => this.sandbox.cost(text)
      const room = budget - cost(frame(line, ''))
      if (room < 0) {
        // The frame itself does not fit, so this command cannot carry files
        // whatever they are. Sent bare rather than refused: the command is
        // still a legal command, and `C2wSandbox` owns the sentence about a
        // line that is too long for the guest at all.
        notes.push(
          `the command is too long to run with your files around it, so it ran on its own in / instead`,
        )
      } else {
        // `list()` returns NAMES, and a file is read only where the command
        // mentions one, so the common case — a command naming nothing — reads
        // nothing. It used to say sizes were what made that true; they were
        // not, and `list()` no longer returns any.
        const wanted = []
        for (const file of listed.value ?? []) {
          if (!line.includes(file.path)) continue
          const read = await this.files.read(file.path)
          if (read.ok && read.value) wanted.push(read.value)
        }
        const { staging, missed, placed } = ShellTool._stage(wanted, room, cost)
        for (const file of missed) {
          // Both numbers in ONE unit, the guest's. Naming the file's size in
          // bytes beside a room measured some other way is the shape of the
          // defect this whole slice is repairing.
          notes.push(
            `${file.path} was not put in ${WORKDIR}: placing it costs ${count(file.needs)} of the command line and ${count(file.spare)} was left`,
          )
        }
        if (placed.length) notes.push(`in ${WORKDIR}: ${placed.join(', ')}`)
        sent = frame(line, staging)
        framed = true
      }
    }

    const ran = await this.sandbox.run(sent)
    if (!ran.ok) {
      // The sandbox itself broke. Reported as an observation rather than an
      // error, because the agent's next move is a decision it can make.
      //
      // The hint is carried in the sentence. `Toolbox` appends it for a FAILED
      // outcome and this one is deliberately ok, so every hint the sandbox
      // writes — the whole of what to do about an image that did not load —
      // reached nobody at all.
      //
      // And the model is asked to repeat it, which is not padding: a tool's
      // notes stop at the observation `Toolbox` renders, and the page's notes
      // list is written from the boot and from a turn's own Outcome. There is
      // no channel from here to the person reading the page except this
      // sentence and whoever reads it.
      const { message, hint } = ran.failure
      return Outcome.ok(
        `the sandbox could not run that: ${message}${hint ? ` (${hint})` : ''}. Say so in your answer — nothing else tells the user.`,
        [...notes, ...ran.notes],
      )
    }
    notes.push(...ran.notes)

    const { stdout, code } = ran.value
    const { body, harvested, unreadable } = framed
      ? ShellTool._split(stdout)
      : { body: stdout, harvested: [], unreadable: [] }
    if (framed) notes.push(...(await this._keep(harvested, unreadable)))

    const text = body.trim()
    const clipped =
      text.length > MAX_OUTPUT
        ? `${text.slice(0, MAX_OUTPUT)}\n[... ${text.length - MAX_OUTPUT} more characters, not shown]`
        : text

    // The exit status is part of the result, always. A command that printed
    // nothing and a command that failed silently look identical without it.
    if (!clipped) return Outcome.ok(`(no output, exit ${code})`, notes)
    return Outcome.ok(code === 0 ? clipped : `${clipped}\n(exit ${code})`, notes)
  }

  /**
   * Put what the command left behind into the workspace.
   *
   * Never deletes. A file the command removed from the working directory stays
   * in the workspace, and that is a decision rather than an omission: the
   * working directory only ever held the handful of files the command named, so
   * "absent from /w" means "was never carried in" far more often than it means
   * "was deleted", and treating the two alike would let one `rm` empty a store
   * the agent spent a run filling.
   */
  async _keep(harvested, unreadable) {
    const notes = []
    for (const path of unreadable) {
      notes.push(`${path} was left in ${WORKDIR} but it is not text, so it was not saved`)
    }

    const saved = []
    let bytes = 0
    for (const file of harvested) {
      if (saved.length >= MAX_HARVEST_FILES || bytes + file.bytes > MAX_HARVEST_BYTES) {
        notes.push(
          `${file.path} was left in ${WORKDIR} and not saved: one command may bring back ${MAX_HARVEST_FILES} files and ${count(MAX_HARVEST_BYTES)} bytes`,
        )
        continue
      }
      if (file.bytes > MAX_FILE_BYTES) {
        notes.push(
          `${file.path} was left in ${WORKDIR} and not saved: it is ${count(file.bytes)} bytes and a file may be ${count(MAX_FILE_BYTES)}`,
        )
        continue
      }
      const written = await this.files.write(file.path, file.text)
      if (!written.ok) {
        notes.push(`${file.path} could not be saved: ${written.failure.message}`)
        continue
      }
      bytes += file.bytes
      saved.push(file.path)
    }
    if (saved.length) notes.push(`saved to your files: ${saved.join(', ')}`)
    return notes
  }
}
