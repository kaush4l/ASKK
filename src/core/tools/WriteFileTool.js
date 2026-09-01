import { Outcome } from '../Outcome.js'
import { filesOr } from './FilesPort.js'
import { Tool } from './Tool.js'

/**
 * Write one of the agent's own files.
 *
 * Whole-file, never a patch. Two reasons, and the second is the one that
 * decided it: this store's `put` writes a whole record, so a partial write
 * would be a read-modify-write pretending to be an edit; and a patch format is
 * a second contract the model has to get right, with a failure mode — an
 * anchor that does not match — that costs a turn to discover and another to
 * repair. A model that can write the file can write the file.
 */
export class WriteFileTool extends Tool {
  constructor({ files = null } = {}) {
    super({
      name: 'write_file',
      description:
        'Keep something. Writes the whole file, replacing what was there. Your files last between turns and across a reload; the sandbox forgets everything the moment a command ends, so anything worth having later belongs here.',
      parameters: {
        path: {
          type: 'string',
          required: true,
          description: 'Where to keep it — notes.md, src/main.c.',
        },
        content: { type: 'string', required: true, description: 'The whole file.' },
      },
    })
    this.files = filesOr(files)
  }

  async call({ path, content } = {}) {
    // Not defaulted to an empty string. `write_file({"path": "x"})` with the
    // content forgotten would otherwise silently truncate a file the agent
    // spent a turn writing, and report success for it.
    if (content === undefined || content === null) {
      return Outcome.ok(`nothing was written: write_file needs content as well as a path`)
    }

    const written = await this.files.write(path, content)
    if (!written.ok) {
      const { message, hint } = written.failure
      return Outcome.ok(
        `could not write that: ${message}${hint ? ` (${hint})` : ''}`,
        written.notes,
      )
    }

    const { path: name, bytes, created } = written.value
    return Outcome.ok(`${created ? 'wrote' : 'replaced'} ${name}, ${bytes} bytes`, written.notes)
  }
}
