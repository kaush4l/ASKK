import { Outcome } from '../Outcome.js'
import { filesOr } from './FilesPort.js'
import { Tool } from './Tool.js'

/**
 * How much of a file a model can usefully read before it is all context and no
 * answer.
 *
 * `ShellTool` has a constant of the same size and they are not one knob. That
 * one caps what a COMMAND printed, which is unbounded and often accidental.
 * This one caps a file the agent wrote itself, and would move on an argument
 * about how much of its own work it should see in one go.
 */
const MAX_OUTPUT = 4000

/**
 * Read one of the agent's own files.
 *
 * The counterpart to `write_file`, and the reason the pair earns two round trips
 * rather than living in the prompt: a file is the one thing the agent knows
 * about that is too big to state on every turn. `tools/index.js` sets the bar —
 * a FACT belongs in the context block, a CAPABILITY belongs in a tool — and the
 * split here is exactly that. WHICH files exist is a fact, so it is one line of
 * the context block. What is IN one is a capability, so it is this.
 */
export class ReadFileTool extends Tool {
  constructor({ files = null } = {}) {
    super({
      name: 'read_file',
      // The persistence claim is stated once, in `write_file`, because that is
      // the tool whose decision it changes. Repeating it here would be two
      // spellings of one fact about 60 tokens apart, on every turn of every
      // run — the same cut `Toolbox.render` made to its lead-in line.
      description: 'Read one of your own files back — the ones the context block names.',
      parameters: {
        path: { type: 'string', required: true, description: 'The path, as it is listed.' },
      },
    })
    this.files = filesOr(files)
  }

  async call({ path } = {}) {
    const found = await this.files.read(path)
    if (!found.ok) {
      // A bad path and a broken store are both observations rather than
      // failures, for the reason `ShellTool` gives: the agent's next move is a
      // decision it can make, and an ended turn takes that away.
      const { message, hint } = found.failure
      return Outcome.ok(`could not read that: ${message}${hint ? ` (${hint})` : ''}`, found.notes)
    }

    if (!found.value) {
      // NOT a listing. This used to render one, capped at its own copy of
      // `ChatService`'s forty, which is `list_files` under another name — the
      // tool `tools/index.js` refuses on the rule that a FACT belongs in the
      // context block. Priced with this tree's own `estimateTokens` over the
      // workspace `notes.md src/main.c plan-2.txt README.md src/util.c …`, the
      // old sentence cost 13 tokens at one file, 28 at five, 53 at twelve and
      // 151 at forty; this one costs 15 whatever is there. All of it to restate
      // a line rendered into the same prompt a few hundred characters above.
      //
      // Its defence was that a file written THIS turn is not in that line. That
      // does not survive the paths: `write_file` answers `wrote notes.md, 5
      // bytes` and `ShellTool._keep` answers `saved to your files: …`, so
      // everything created mid-turn has already named itself in the scratchpad
      // the model is reading. And past forty both listings truncate at the same
      // forty, so the one case a second listing could serve is the one case it
      // cannot.
      return Outcome.ok(`there is no file called ${path} — check the names in your files.`)
    }

    const { text, bytes } = found.value
    if (!text) return Outcome.ok(`${found.value.path} is empty`)
    if (text.length > MAX_OUTPUT) {
      return Outcome.ok(
        `${text.slice(0, MAX_OUTPUT)}\n[... ${text.length - MAX_OUTPUT} more characters of ${bytes} bytes, not shown]`,
      )
    }
    return Outcome.ok(text)
  }
}
