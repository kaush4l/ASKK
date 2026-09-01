import { Outcome } from '../Outcome.js'
import { Tool } from './Tool.js'

/** How much output a model can usefully read before it is all context and no answer. */
const MAX_OUTPUT = 4000

/**
 * Run a shell command in the sandbox.
 *
 * This is the first tool in this tree that does something the prompt cannot
 * contain — which is the bar a tool has to clear. Everything the agent could
 * be told, it is told; this is for the things it has to go and find out.
 *
 * The tool holds a `Sandbox` port and nothing else. Where the command actually
 * runs — an x86 emulator in this tab, something else later — is not its
 * business, and the agent is told what the environment is rather than which
 * technology provides it.
 */
export class ShellTool extends Tool {
  constructor({ sandbox, description = '' } = {}) {
    super({
      name: 'shell',
      description:
        description ||
        'Run a command in a private Linux sandbox and read its output. BusyBox and the Alpine base tools are available. Nothing is shared with the user’s machine, there is no network, and every call starts from a clean filesystem — so a command that must see an earlier command’s files has to do both in one call, with && or a here-document. The command line cannot exceed 1024 bytes.',
      parameters: {
        command: {
          type: 'string',
          required: true,
          description: 'The command line, run by /bin/sh. Quote it as you would in a terminal.',
        },
      },
    })
    this.sandbox = sandbox
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

    const ran = await this.sandbox.run(line)
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
        ran.notes,
      )
    }

    const { stdout, code } = ran.value
    const body = stdout.trim()
    const clipped =
      body.length > MAX_OUTPUT
        ? `${body.slice(0, MAX_OUTPUT)}\n[... ${body.length - MAX_OUTPUT} more characters, not shown]`
        : body

    // The exit status is part of the result, always. A command that printed
    // nothing and a command that failed silently look identical without it.
    if (!clipped) return Outcome.ok(`(no output, exit ${code})`, ran.notes)
    return Outcome.ok(code === 0 ? clipped : `${clipped}\n(exit ${code})`, ran.notes)
  }
}
