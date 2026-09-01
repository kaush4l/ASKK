import { describe, expect, test } from 'bun:test'
import { Workspace } from '../../src/backend/files/Workspace.js'
import { MemoryRepository } from '../../src/backend/repositories/MemoryRepository.js'
import { ChatService } from '../../src/backend/services/ChatService.js'
import { ConversationService } from '../../src/backend/services/ConversationService.js'
import { AgentSpec } from '../../src/core/agent/AgentSpec.js'
import { Outcome } from '../../src/core/Outcome.js'
import { ScriptedInference } from '../support/ScriptedInference.js'

/**
 * A file written on one turn and read back on a later one — through the loop
 * the browser runs, not around it.
 *
 * Everything here is real except the model: the real `ChatService`, the real
 * `buildAgent`, the real `ReActEngine`, the real `Toolbox` parsing the call out
 * of the model's text, the real tools resolved by NAME from an agent spec, and
 * the real `Workspace` over a real `Repository`. That matters because the
 * defect this whole slice exists to avoid is a capability that works when a
 * test constructs it and is unreachable in the app: `search` and `fetch` were
 * both built, tested and missing from `tools:` for a whole wave.
 *
 * Two separate `send` calls, because one turn's scratchpad would prove nothing.
 * The second call starts from an empty scratchpad and a fresh agent build, so
 * the only way `read_file` can answer is out of the store.
 */

const toolTurn = (call) => `think: []\n\nplan: []\n\nact: tool\n\nresult: ${call}`
const answerTurn = (text) => `think: []\n\nplan: []\n\nact: answer\n\nresult: ${text}`

/** The real service with only its transport replaced. */
class ScriptedChat extends ChatService {
  constructor(inference, ...rest) {
    super(...rest)
    this._scripted = inference
  }

  async _inferenceFor() {
    return Outcome.ok(this._scripted)
  }
}

function chat(files, tools = ['read_file', 'write_file', 'shell']) {
  const repository = new MemoryRepository('conversation')
  repository.rows.set('c1', { id: 'c1', title: 'Chat', messages: [], createdAt: 1 })
  const spec = AgentSpec.of({
    metadata: { name: 'main', tools },
    body: 'be brief',
    source: 'test',
  }).value
  return (replies) => {
    const inference = new ScriptedInference({ replies })
    const service = new ScriptedChat(inference, {
      conversations: new ConversationService(repository),
      settings: {
        async get() {
          return Outcome.ok({ agent: 'main', kind: 'openai', model: 'm', baseUrl: '', apiKey: '' })
        },
      },
      catalogue: {
        async spec() {
          return Outcome.ok(spec)
        },
        async all() {
          return Outcome.ok([spec])
        },
      },
      pool: { ask: async () => Outcome.ok('') },
      files,
    })
    return { service, inference }
  }
}

describe('the agent’s files, across turns', () => {
  test('what one turn writes, a later turn reads back', async () => {
    const files = new Workspace(new MemoryRepository('File'))
    const send = chat(files)

    const first = send([
      toolTurn('write_file({"path": "notes.md", "content": "the kernel is 6.1.0"})'),
      answerTurn('Noted.'),
    ])
    const wrote = await first.service.send({ id: 'c1', text: 'remember the kernel version' })
    expect(wrote.ok).toBe(true)

    // A DIFFERENT service instance, a different agent build, an empty
    // scratchpad. Nothing carries over but the store.
    const second = send([toolTurn('read_file({"path": "notes.md"})'), answerTurn('It was 6.1.0.')])
    const read = await second.service.send({ id: 'c1', text: 'what was the kernel version?' })

    expect(read.ok).toBe(true)
    expect(read.value.assistant.text).toBe('It was 6.1.0.')
    // The observation the second turn's model actually read, taken out of the
    // prompt the transport was handed rather than out of the tool's return
    // value: this is the assertion that the bytes crossed the whole loop.
    expect(second.inference.prompts[1]).toContain('the kernel is 6.1.0')
  })

  test('the model is told which files exist without being sent a tree', async () => {
    // The reference arm hands its model a recursive listing on all 79 of its
    // turns. This is the cheaper half of that: names, in the context block, and
    // the contents only when the agent goes and asks.
    const files = new Workspace(new MemoryRepository('File'))
    await files.write('notes.md', 'x'.repeat(500))
    await files.write('src/main.c', 'y'.repeat(500))

    const { service, inference } = chat(files)([answerTurn('Two of them.')])
    await service.send({ id: 'c1', text: 'what have you got?' })

    expect(inference.prompts[0]).toContain('your files: notes.md src/main.c')
    // Names only. A thousand bytes of file contents did not travel with them.
    expect(inference.prompts[0]).not.toContain('xxxxx')
  })

  test('a workspace past the cap says it was cut, and by how much', async () => {
    // The sentence `MAX_LISTED` exists for. Forty names is where the line stops
    // being the cheaper buy than a `list_files` tool, and the one thing that
    // must not happen at the boundary is an agent certain it has seen all of
    // them — deleting this suffix left every other test in the tree green.
    const files = new Workspace(new MemoryRepository('File'))
    for (let i = 0; i <= 40; i++) await files.write(`f${String(i).padStart(2, '0')}.md`, 'x')

    const { service, inference } = chat(files)([answerTurn('Lots.')])
    await service.send({ id: 'c1', text: 'what have you got?' })

    expect(inference.prompts[0]).toContain('f39.md (and 1 more, not listed)')
    expect(inference.prompts[0]).not.toContain('f40.md')
  })

  test('an empty workspace says nothing at all', async () => {
    // A line reading `your files:` with nothing after it is a line paid for on
    // every turn of every run to say that there is nothing to say.
    const { service, inference } = chat(new Workspace(new MemoryRepository('File')))([
      answerTurn('Nothing yet.'),
    ])

    await service.send({ id: 'c1', text: 'anything?' })

    // The `:` matters — the tool descriptions say "your own files", so the bare
    // phrase would pass over a context line that had rendered empty.
    expect(inference.prompts[0]).not.toContain('your files:')
  })

  test('a store that cannot be read tells the user and not the model', async () => {
    // The listing is a convenience; the run is not conditional on it. What the
    // user must not get is a silent one.
    const broken = {
      async list() {
        return Outcome.failed('UNAVAILABLE', 'IndexedDB is blocked by another open tab')
      },
    }
    const { service, inference } = chat(broken)([answerTurn('Hello.')])

    const said = await service.send({ id: 'c1', text: 'hi' })

    expect(said.ok).toBe(true)
    expect(said.notes).toContain(
      'your files could not be listed: IndexedDB is blocked by another open tab',
    )
    expect(inference.prompts[0]).not.toContain('your files:')
  })

  test('the file tools are the ones the agent file names, resolved by name', async () => {
    // Resolution through `BUILTIN_TOOLS`, which is what an agent file reaches.
    // A tool that exists and is not in that table is a tool no agent can ask
    // for, and this is the only assertion that would notice.
    const files = new Workspace(new MemoryRepository('File'))
    const { service, inference } = chat(files)([
      toolTurn('write_file({"path": "a.md", "content": "hi"})'),
      answerTurn('done'),
    ])

    await service.send({ id: 'c1', text: 'write a.md' })

    expect(inference.prompts[0]).toContain('read_file({"path": string})')
    expect(inference.prompts[0]).toContain('write_file({"path": string, "content": string})')
    expect((await files.read('a.md')).value.text).toBe('hi')
  })
})
