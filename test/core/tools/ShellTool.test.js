import { describe, expect, test } from 'bun:test'
import { Outcome, Reason } from '../../../src/core/Outcome.js'
import { Sandbox } from '../../../src/core/sandbox/Sandbox.js'
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

describe('ShellTool', () => {
  test('a sandbox that could not run anything hands the model its hint, and asks it to relay', async () => {
    // The exact shape `C2wSandbox` returns when the image is not being served,
    // which is what a deploy that could not carry 107 MB produces on the first
    // shell call. `Toolbox` appends a hint only to a FAILED outcome and this
    // path returns ok on purpose, so without this the hint reaches nobody.
    const sandbox = new FakeSandbox(
      Outcome.failed(Reason.UNAVAILABLE, 'the sandbox image did not load: HTTP 404 for /x.wasm', {
        hint: 'Build the guest with scripts/wasm/build.sh into public/sandbox/.',
      }),
    )

    const said = await new ShellTool({ sandbox }).call({ command: 'uname -a' })

    expect(said.ok).toBe(true)
    expect(said.value).toBe(
      'the sandbox could not run that: the sandbox image did not load: HTTP 404 for /x.wasm (Build the guest with scripts/wasm/build.sh into public/sandbox/.). Say so in your answer — nothing else tells the user.',
    )
  })

  test('a failure with nothing useful to say does not grow an empty bracket', async () => {
    const sandbox = new FakeSandbox(Outcome.failed(Reason.INTERNAL, 'the sandbox failed: boom'))

    const said = await new ShellTool({ sandbox }).call({ command: 'ls' })

    expect(said.value).toBe(
      'the sandbox could not run that: the sandbox failed: boom. Say so in your answer — nothing else tells the user.',
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
    expect(said.value).toContain('the sandbox is not available')
  })
})
