import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { Workspace } from '../../../src/backend/files/Workspace.js'
import { MemoryRepository } from '../../../src/backend/repositories/MemoryRepository.js'
import { C2wSandbox } from '../../../src/backend/sandbox/C2wSandbox.js'
import { Outcome, Reason } from '../../../src/core/Outcome.js'
import { Sandbox } from '../../../src/core/sandbox/Sandbox.js'
import { MAX_FILE_BYTES } from '../../../src/core/tools/FilesPort.js'
import { ShellTool } from '../../../src/core/tools/ShellTool.js'

/**
 * The tool had no test at all, and the two things it says to the model when the
 * sandbox is not working are the two things a user acts on.
 *
 * A fake `Sandbox` rather than a real one: what is under test here is the
 * sentence the model reads, and every branch of it is decided before anything
 * would boot. `C2wSandbox` is proved against the real 107 MB guest in a browser
 * by `scripts/smoke.js` — that is the only place it can be proved, and this is
 * the only place these sentences can be.
 */
class FakeSandbox extends Sandbox {
  constructor(answer) {
    super()
    this.answer = answer
    this.asked = []
  }

  get available() {
    return true
  }

  async run(command) {
    this.asked.push(command)
    return this.answer
  }
}

/**
 * A sandbox that declares a command budget and the rule for spending it, which
 * together are what turn the file staging on.
 *
 * Both are the real ones, delegated to `C2wSandbox` rather than written here,
 * so a test that fits inside the budget fits inside the guest's budget too —
 * and so that a fake cannot quietly price a line the guest would refuse. The
 * pricing is the whole of what went wrong: the guest charges a space twice, and
 * a fake that borrowed only the NUMBER certified a limit the real guest would
 * not take.
 */
const guest = new C2wSandbox({})

class GuestSandbox extends FakeSandbox {
  get commandBudget() {
    return guest.commandBudget
  }

  cost(text) {
    return guest.cost(text)
  }
}

const workspace = () => new Workspace(new MemoryRepository('File'))

/** stdout as the frame writes it: the command's output, then the harvest. */
const withFiles = (output, files = {}) =>
  [
    output,
    '__askk_fs',
    ...Object.entries(files).flatMap(([path, text]) => [
      `__askk_f ./${path}`,
      typeof text === 'string' ? btoa(text) : text,
    ]),
  ].join('\n')

describe('ShellTool', () => {
  test('a sandbox that could not run anything hands the model its hint, and asks it to relay', async () => {
    // The exact shape `C2wSandbox` returns when the image is not being served,
    // which is what a deploy that could not carry 107 MB produces on the first
    // shell call. `Toolbox` appends a hint only to a FAILED outcome and this
    // path returns ok on purpose, so without this the hint reaches nobody.
    const sandbox = new FakeSandbox(
      Outcome.failed(
        Reason.UNAVAILABLE,
        'the Linux machine in this tab could not be loaded: HTTP 404 for /x.wasm',
        { hint: 'Build it with scripts/wasm/build.sh into public/sandbox/.' },
      ),
    )

    const said = await new ShellTool({ sandbox }).call({ command: 'uname -a' })

    expect(said.ok).toBe(true)
    expect(said.value).toBe(
      'that command could not run: the Linux machine in this tab could not be loaded: HTTP 404 for /x.wasm (Build it with scripts/wasm/build.sh into public/sandbox/.). Say so in your answer — nothing else tells the user.',
    )
  })

  test('a failure with nothing useful to say does not grow an empty bracket', async () => {
    const sandbox = new FakeSandbox(
      Outcome.failed(Reason.INTERNAL, 'the Linux machine in this tab failed: boom'),
    )

    const said = await new ShellTool({ sandbox }).call({ command: 'ls' })

    expect(said.value).toBe(
      'that command could not run: the Linux machine in this tab failed: boom. Say so in your answer — nothing else tells the user.',
    )
  })

  test('a non-zero exit is a result the model can read, and the status is in it', async () => {
    const sandbox = new FakeSandbox(Outcome.ok({ stdout: 'ls: /nope: not found\n', code: 1 }))

    const said = await new ShellTool({ sandbox }).call({ command: 'ls /nope' })

    expect(said.ok).toBe(true)
    expect(said.value).toBe('ls: /nope: not found\n(exit 1)')
  })

  test('a command that succeeded is quoted alone — an exit line on every reply is noise', async () => {
    const sandbox = new FakeSandbox(Outcome.ok({ stdout: '42\n', code: 0 }))

    expect((await new ShellTool({ sandbox }).call({ command: 'echo $((6*7))' })).value).toBe('42')
  })

  test('silence and a status are not the same thing, so a silent failure still says which', async () => {
    const sandbox = new FakeSandbox(Outcome.ok({ stdout: '', code: 2 }))

    expect((await new ShellTool({ sandbox }).call({ command: 'false' })).value).toBe(
      '(no output, exit 2)',
    )
  })

  test('no sandbox at all is answered without one being asked', async () => {
    // What `ChatService` builds when composition handed it nothing: the tool
    // must not reach for `run` on null.
    const said = await new ShellTool({ sandbox: null }).call({ command: 'uname -a' })

    expect(said.ok).toBe(true)
    expect(said.value).toContain('there is no Linux machine in this tab')
  })
})

/**
 * The bridge between the agent's files and a guest that forgets everything.
 *
 * These are the tests for a channel that was MEASURED rather than assumed: a
 * thousand characters of command line into the guest — bytes, and one more for
 * every space — per ~950 ms boot, with no way to chunk because the filesystem
 * does not survive; and at least 512 KiB of stdout back out for the same money.
 * Everything asserted below is a consequence of that asymmetry, so if the
 * numbers ever move these are the tests that should argue about it.
 */
describe('ShellTool and the agent’s files', () => {
  test('a file the command names is written into the working directory before it runs', async () => {
    const files = workspace()
    await files.write('notes.md', 'hello')
    const sandbox = new GuestSandbox(Outcome.ok({ stdout: withFiles('hello'), code: 0 }))

    const said = await new ShellTool({ sandbox, files }).call({ command: 'cat notes.md' })

    expect(sandbox.asked[0]).toContain(`printf %s 'hello'>'notes.md';`)
    // In the working directory, and the command runs there, so `cat notes.md`
    // means the agent's own file with no path in front of it.
    expect(sandbox.asked[0]).toStartWith('mkdir -p /w;cd /w||exit 1;')
    expect(said.value).toBe('hello')
    expect(said.notes).toContain('in /w: notes.md')
  })

  test('a file the command does not name is left where it is', async () => {
    // The whole workspace would not fit — that is the measured 1 KB — so what
    // goes in is what was asked for. Staging everything would break on the
    // third file and this is the assertion that says it does not try.
    const files = workspace()
    await files.write('notes.md', 'hello')
    await files.write('other.md', 'unrelated')
    const sandbox = new GuestSandbox(Outcome.ok({ stdout: withFiles(''), code: 0 }))

    await new ShellTool({ sandbox, files }).call({ command: 'cat notes.md' })

    expect(sandbox.asked[0]).toContain(`'notes.md'`)
    expect(sandbox.asked[0]).not.toContain('unrelated')
  })

  test('a file too big for the command line is refused out loud, with both numbers', async () => {
    // The failure that must never be silent. A command that reads an empty
    // file it asked for by name would have the agent conclude its own work had
    // vanished, and go and do it again.
    const files = workspace()
    await files.write('big.md', 'x'.repeat(2000))
    const sandbox = new GuestSandbox(Outcome.ok({ stdout: withFiles(''), code: 0 }))

    const said = await new ShellTool({ sandbox, files }).call({ command: 'wc -c big.md' })

    expect(sandbox.asked[0]).not.toContain('xxxx')
    // Both numbers in ONE unit. "it is 2,000 bytes and the line had N to spare"
    // was two units in one sentence, which is the same confusion that made the
    // budget wrong in the first place.
    expect(
      said.notes.some((note) => note.startsWith('big.md was not put in /w: placing it costs 2,0')),
    ).toBe(true)
  })

  test('a nested path gets its folder made before anything is written into it', async () => {
    // `src/main.c` cannot be written until `src` exists, and the guest starts
    // every command with an empty working directory. Nothing else in the gate
    // sees this: `scripts/smoke.js` stages one nested file through the real
    // guest for the same reason, and deleting the prelude fails both.
    const files = workspace()
    await files.write('src/main.c', 'int main(){}')
    await files.write('notes.md', 'hello')
    const sandbox = new GuestSandbox(Outcome.ok({ stdout: withFiles(''), code: 0 }))

    await new ShellTool({ sandbox, files }).call({ command: 'cc src/main.c; cat notes.md' })

    // Before the first `printf`, and only for the file that needs one.
    expect(sandbox.asked[0]).toContain(`;mkdir -p 'src';printf %s `)
  })

  test('one oversized file does not cost the command the small ones beside it', async () => {
    // The whole point of taking them cheapest first. Sent in path order the
    // 700-byte file goes in and eats the room, and two of the three small files
    // the command also named are then refused for want of what it took.
    const files = workspace()
    await files.write('a-big.md', 'x'.repeat(700))
    for (const name of ['x-one.md', 'y-two.md', 'z-three.md']) await files.write(name, 'k')
    const sandbox = new GuestSandbox(Outcome.ok({ stdout: withFiles(''), code: 0 }))

    const said = await new ShellTool({ sandbox, files }).call({
      command: 'cat a-big.md x-one.md y-two.md z-three.md',
    })

    expect(said.notes).toContain('in /w: x-one.md, y-two.md, z-three.md')
    expect(said.notes.some((note) => note.startsWith('a-big.md was not put in /w'))).toBe(true)
  })

  test('a command too long to wrap runs on its own, and the model is told where', async () => {
    // The frame itself is 159 of the guest's 962, so a long enough command
    // leaves nothing for it. Sent bare rather than refused — it is still a legal
    // command — but a command that ran in `/` with none of its files is a
    // different command from the one the model asked for, and it has to know.
    const files = workspace()
    await files.write('notes.md', 'hello')
    const sandbox = new GuestSandbox(Outcome.ok({ stdout: 'out', code: 0 }))

    const long = `echo notes.md ${'a'.repeat(820)}`
    const said = await new ShellTool({ sandbox, files }).call({ command: long })

    expect(sandbox.asked).toEqual([long])
    expect(said.notes).toContain(
      'the command is too long to run with your files around it, so it ran on its own in / instead',
    )
  })

  test('a store that cannot be listed is said out loud, not silently skipped', async () => {
    // The agent would otherwise watch a command read an empty directory and
    // conclude its own work had vanished.
    const files = {
      async list() {
        return Outcome.failed(Reason.UNAVAILABLE, 'IndexedDB is blocked by another open tab')
      },
      async read() {
        return Outcome.ok(null)
      },
      async write() {
        return Outcome.ok({ path: 'x', bytes: 0, created: true })
      },
    }
    const sandbox = new GuestSandbox(Outcome.ok({ stdout: withFiles('out'), code: 0 }))

    const said = await new ShellTool({ sandbox, files }).call({ command: 'cat notes.md' })

    expect(said.notes).toContain('your files could not be reached, so none were placed in /w')
  })

  test('a file the command left behind that is too big for the store is named, not dropped', async () => {
    // The guest can write a file larger than the workspace will hold, and the
    // harvest cap is a blast radius rather than a per-file one — so without
    // this the write simply failed and the model was told nothing.
    const files = workspace()
    const sandbox = new GuestSandbox(
      Outcome.ok({
        stdout: withFiles('', { 'huge.txt': 'x'.repeat(MAX_FILE_BYTES + 100) }),
        code: 0,
      }),
    )

    const said = await new ShellTool({ sandbox, files }).call({ command: 'yes >huge.txt' })

    expect((await files.list()).value).toEqual([])
    expect(
      said.notes.some(
        (note) =>
          note.startsWith('huge.txt was left in /w and not saved: it is 65,') &&
          note.endsWith('and a file may be 65,536'),
      ),
    ).toBe(true)
  })

  test('the status the agent is told is its own command’s, not the harvest’s', async () => {
    // `base64` and `find` run AFTER the command inside the same line, and
    // `C2wSandbox` reads the status from an echo it appends after all of it. So
    // without this the exit code of every failing command would be 0.
    const files = workspace()
    const sandbox = new GuestSandbox(Outcome.ok({ stdout: withFiles('nope'), code: 1 }))

    await new ShellTool({ sandbox, files }).call({ command: 'false' })

    expect(sandbox.asked[0]).toContain(';_r=$?;')
    expect(sandbox.asked[0]).toEndWith(';exit $_r')
  })

  test('what the command left behind is saved, and never shown as its output', async () => {
    const files = workspace()
    const sandbox = new GuestSandbox(
      Outcome.ok({ stdout: withFiles('done', { 'out.txt': 'made it\n' }), code: 0 }),
    )

    const said = await new ShellTool({ sandbox, files }).call({ command: 'echo done >out.txt' })

    expect((await files.read('out.txt')).value.text).toBe('made it\n')
    // The frame's own chatter is not the command's output. A model reading
    // base64 of its own file back as an observation would pay for it twice.
    expect(said.value).toBe('done')
    expect(said.notes).toContain('saved to your files: out.txt')
  })

  test('a command that ends in a comment does not swallow the harvest', async () => {
    // `#` runs to the end of the line and the frame is one line, so without the
    // newline after the command the closing paren, the status capture and the
    // whole harvest are inside the comment. The real guest answers
    // `sh: syntax error: unexpected end of file (expecting ")")`, and
    // `scripts/smoke.js` sends exactly this shape because it is the only place
    // the guest can say so.
    const files = workspace()
    const sandbox = new GuestSandbox(Outcome.ok({ stdout: withFiles('done'), code: 0 }))

    await new ShellTool({ sandbox, files }).call({ command: 'ls -la # what is here' })

    expect(sandbox.asked[0]).toContain('( ls -la # what is here\n);_r=$?;')
  })

  test('the marker is put on a line of its own, whatever the command left on the last one', async () => {
    // Found in the browser, not here. `cat` a file with no trailing newline and
    // the output runs into the marker — `written before the reload__askk_fs` —
    // so nothing matched, and the model was handed its own files back as
    // base64. The bare `echo` is the fix and this is the pin on it.
    const files = workspace()
    const sandbox = new GuestSandbox(Outcome.ok({ stdout: withFiles('no newline'), code: 0 }))

    await new ShellTool({ sandbox, files }).call({ command: 'printf x' })

    expect(sandbox.asked[0]).toContain(';echo;echo __askk_fs;')
  })

  test('a command that prints the harvest marker itself does not lose its output', async () => {
    // The last marker is the frame's, because the frame runs after the command
    // and nothing can be printed after a command has exited. Same rule as the
    // status marker in `C2wSandbox`, and it is a rule rather than luck.
    const files = workspace()
    const sandbox = new GuestSandbox(
      Outcome.ok({ stdout: withFiles('__askk_fs\nreal output', { 'a.txt': 'x' }), code: 0 }),
    )

    const said = await new ShellTool({ sandbox, files }).call({ command: 'echo __askk_fs' })

    expect(said.value).toBe('__askk_fs\nreal output')
    expect((await files.read('a.txt')).value.text).toBe('x')
  })

  test('a file that is not text is named and not stored', async () => {
    // Decoded with `fatal`, so a guest binary cannot enter the workspace as a
    // string of replacement characters that reads like the agent's own writing.
    const files = workspace()
    const sandbox = new GuestSandbox(
      Outcome.ok({
        stdout: withFiles('', { 'a.out': String.fromCharCode(0x7f, 0x45, 0xff, 0xfe) }),
        code: 0,
      }),
    )

    const said = await new ShellTool({ sandbox, files }).call({ command: 'cc x.c' })

    expect((await files.list()).value).toEqual([])
    expect(said.notes).toContain('a.out was left in /w but it is not text, so it was not saved')
  })

  test('a command that fills the working directory cannot fill the database', async () => {
    // `cp -r /bin /w` is one command away, and the outward channel is nearly
    // free. What is over the cap is named rather than dropped in silence.
    const files = workspace()
    const many = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`f${String(i).padStart(2, '0')}.txt`, 'x']),
    )
    const sandbox = new GuestSandbox(Outcome.ok({ stdout: withFiles('', many), code: 0 }))

    const said = await new ShellTool({ sandbox, files }).call({ command: 'sh make-many.sh' })

    expect((await files.list()).value).toHaveLength(32)
    expect(said.notes.some((note) => note.includes('one command may bring back 32 files'))).toBe(
      true,
    )
  })

  test('a sandbox that will not price its own line is sent the bare command', async () => {
    // Sizing the staging wrong does not fail politely — the guest refuses to
    // boot and answers about an entrypoint nobody wrote — so a sandbox that
    // does not say how long a line it takes, OR does not say what a line costs,
    // is not one this frame fits. Both halves, because a budget with no pricing
    // rule is what this file spent two waves assuming was a byte count.
    const files = workspace()
    await files.write('notes.md', 'hello')
    const neither = new FakeSandbox(Outcome.ok({ stdout: 'hello', code: 0 }))
    class BudgetOnly extends FakeSandbox {
      get commandBudget() {
        return guest.commandBudget
      }
    }
    const unpriced = new BudgetOnly(Outcome.ok({ stdout: 'hello', code: 0 }))

    expect(
      (await new ShellTool({ sandbox: neither, files }).call({ command: 'cat notes.md' })).value,
    ).toBe('hello')
    expect(
      (await new ShellTool({ sandbox: unpriced, files }).call({ command: 'cat notes.md' })).value,
    ).toBe('hello')
    expect(neither.asked).toEqual(['cat notes.md'])
    expect(unpriced.asked).toEqual(['cat notes.md'])
  })

  test('a build with nowhere to keep files still runs the command', async () => {
    // `null` is what `ChatService` passes when composition handed it nothing,
    // and it is not `undefined`, so the parameter default never fires. Before
    // the port was checked by value this threw `null is not an object` on
    // `this.files.list` — inside `shell`, which the Kernel reports as a bug in
    // the harness rather than as a shell that has no store.
    const sandbox = new GuestSandbox(Outcome.ok({ stdout: 'hi', code: 0 }))

    const said = await new ShellTool({ sandbox, files: null }).call({ command: 'echo hi' })

    expect(said.ok).toBe(true)
    expect(said.value).toBe('hi')
    expect(sandbox.asked).toEqual(['echo hi'])
  })

  test('the frame plus the limit the prompt states fits the budget the sandbox declares', async () => {
    // What this CAN check, said in its own name. The number in the tool
    // description is written down, because `scripts/dryrun.js` builds this tool
    // with no sandbox and a description that changed shape without one would
    // make every prompt measured there a measurement of a different prompt.
    // This is what stops it drifting: the room really left for a command, after
    // the guest's own wrapper and this file's frame, has to be at least what
    // the model was told.
    //
    // What it CANNOT check is that the guest agrees, because the sandbox here is
    // a fake that borrows a number. This test used to be called "the limit the
    // prompt states is one the guest will actually accept", and the guest did
    // not accept it: 800 bytes of ordinary shell was refused. The assertion that
    // needs a guest lives in `scripts/smoke.js`, where there is one.
    const stated = Number(
      /cannot exceed (\d+) bytes/.exec(new ShellTool({ sandbox: null }).description)[1],
    )
    const files = workspace()
    const sandbox = new GuestSandbox(Outcome.ok({ stdout: withFiles(''), code: 0 }))

    await new ShellTool({ sandbox, files }).call({ command: 'a'.repeat(stated) })

    expect(sandbox.cost(sandbox.asked[0])).toBeLessThanOrEqual(sandbox.commandBudget)
  })

  test('the description names the language runtimes the image recipe installs, and no others', () => {
    // The one assertion in this file whose oracle is not written in this file.
    //
    // `ShellTool`'s description ENUMERATES what is in the guest, and an
    // enumeration is a declaration that goes stale silently: `apk add
    // --no-cache python3` landed in the image and the sentence still said
    // "BusyBox and the Alpine base tools", which reads to a model as "there is
    // no interpreter here". Measured against the real model on 2026-09-01, it
    // cost four guest boots and four turns to find out otherwise.
    //
    // So the recipe is the oracle. `scripts/wasm/image/Dockerfile` is where a
    // runtime enters or leaves the guest, and this reads its `apk add` line
    // rather than a copy of it. Both directions are checked, which is what
    // makes it a link and not a restatement: a runtime the recipe installs must
    // be named in the prompt, and one it does not must not be.
    //
    // An ALLOWLIST OF SUBJECTS, not a denylist of spellings, and not every
    // package. Only names that answer "what can I write a program in" belong in
    // the sentence the model reads; `tzdata` does not, and a test that demanded
    // every package be named would force nonsense prose the first time one was
    // added. Adding `nodejs` to the recipe turns this red until the sentence
    // says so, which is the only failure mode that matters.
    //
    // What this CANNOT see is whether the guest that ships was built from this
    // recipe, and the check that would is narrower than it looks. `bun run
    // toolchain` boots the real guest and fails with "the guest has no
    // python3" — that ONE runtime, hard-coded there, with nothing linking it to
    // the list below. Measured: adding `nodejs` to the recipe and `node` to the
    // sentence and rebuilding nothing passes lint, all 670 tests and `bun run
    // toolchain`, over a guest that has no node. So a SECOND runtime named in
    // the sentence is unguarded against the artifact that ships. Closing that
    // means making `scripts/wasm/toolchain-check.js` prove each named runtime
    // answers in the guest; that file is not this slice's to edit and it is
    // filed as a row.
    const RUNTIMES = ['python3', 'nodejs', 'ruby', 'perl', 'php', 'lua']
    const recipe = readFileSync(
      new URL('../../../scripts/wasm/image/Dockerfile', import.meta.url),
      'utf8',
    )
    const installs = recipe
      // An `apk add` list routinely continues onto the next line, and a parser
      // that reads only the line the verb is on reports the whole recipe as
      // installing nothing — which this test then renders as "the sentence
      // names a runtime the image does not have", the one message that argues
      // for deleting the true half. Measured: putting THIS recipe's `apk add`
      // onto two lines, changing no package, turned the assertion below red on
      // `python3`; adding `nodejs` behind the same continuation failed on
      // `python3` first and never mentioned `nodejs` at all.
      .replace(/\\\n/g, ' ')
      .split('\n')
      .filter((line) => /^RUN\s+apk\s+add\b/.test(line))
      .join(' ')
    const description = new ShellTool({ sandbox: null }).description

    // ONE spelling of "this text names that runtime", used on both sides.
    // `includes` was on the description side, and a description carrying the
    // word "evaluate" makes `lua` read as named — measured, it turns this red
    // on a fault that is not there. Anchoring on whitespace is also what keeps
    // the `rm -rf /usr/lib/python3.12/...` the continuation now joins in from
    // answering for `python3`.
    const names = (text, word) => new RegExp(`(^|\\s)${word}[.,;:]?(\\s|$)`).test(text)

    // Not "is the verb there" — that survived the reformat above with every
    // argument hidden. This image ships a runtime, so a parse that finds none
    // has come loose from the recipe rather than found an empty one.
    expect(RUNTIMES.filter((runtime) => names(installs, runtime))).not.toBeEmpty()
    for (const runtime of RUNTIMES) {
      // `node`, because the package is `nodejs` and the command is `node`; the
      // sentence is written for a model that will type the command.
      const spelling = runtime === 'nodejs' ? 'node' : runtime
      expect({ runtime, named: names(description, spelling) }).toEqual({
        runtime,
        named: names(installs, runtime),
      })
    }
  })
})
