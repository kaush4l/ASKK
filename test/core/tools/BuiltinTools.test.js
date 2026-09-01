import { describe, expect, test } from 'bun:test'
import { Workspace } from '../../../src/backend/files/Workspace.js'
import { MemoryRepository } from '../../../src/backend/repositories/MemoryRepository.js'
import { AgentCatalogue } from '../../../src/core/agent/AgentCatalogue.js'
import { resolveTools } from '../../../src/core/agent/loadAgent.js'
import { Outcome } from '../../../src/core/Outcome.js'
import { Blocked } from '../../../src/core/tools/HttpPort.js'
import { Toolbox } from '../../../src/core/tools/Toolbox.js'

/**
 * That the tools are actually attached, from the real agent file.
 *
 * This tree's signature defect, nine times over, is a capability that was built
 * and never named — and the named-and-not-wired half is worse, because the code
 * is all there and the only thing missing is one word in a list. Every test
 * beside this one constructs the tool itself, so all of them stayed green while
 * `tools:` in `agents/main/agent.md` said nothing about `search` or `fetch`.
 *
 * So this reads the real file through the real `AgentCatalogue` — the same path
 * the browser and `scripts/dryrun.js` take — and drives the resolved toolbox.
 * A `file://` fetch, which is not a network: the roster on disk is the roster
 * the build publishes, and the point is precisely to assert against what ships
 * rather than against a fixture that agrees with the test.
 */

/** A port that records what it was handed. */
function fakePort() {
  const calls = []
  const port = async (request) => {
    calls.push(request)
    return Outcome.ok({
      url: request.url,
      status: 200,
      contentType: 'text/plain',
      text: 'a real answer',
      bytes: 13,
      truncated: false,
      stopped: '',
      blocked: Blocked.NONE,
    })
  }
  port.calls = calls
  return port
}

const catalogue = new AgentCatalogue(new URL('../../..', import.meta.url).href.replace(/\/$/, ''))

describe('the tools the real agent file asks for', () => {
  test('main names search and fetch, and both reach the port they were composed with', async () => {
    const spec = await catalogue.spec('main')
    expect(spec.ok).toBe(true)

    const http = fakePort()
    const resolved = resolveTools({ names: spec.value.tools, services: { http, sandbox: null } })
    const toolbox = new Toolbox(resolved.value)

    // Named in the file at all. Deleting either from `tools:` turns this red,
    // which is the only thing in the tree that notices.
    expect(toolbox.names).toContain('search')
    expect(toolbox.names).toContain('fetch')
    expect(resolved.notes).toEqual([])

    // And WIRED: the port handed to `resolveTools` is the one the tool used.
    // A tool that is named but composed without its collaborator answers
    // politely and reaches nothing, which no name check can see.
    const said = await toolbox.run('fetch({"url": "https://example.com/"})')
    expect(said.count).toBe(1)
    expect(http.calls).toHaveLength(1)
    expect(http.calls[0].url).toBe('https://example.com/')
    expect(said.observation).toContain('a real answer')

    const searched = await toolbox.run('search({"query": "zig"})')
    expect(http.calls).toHaveLength(2)
    expect(http.calls[1].method).toBe('POST')
    expect(searched.observation).not.toContain('there is no tool called')
  })

  test('main names read_file and write_file, and both reach the store it was composed with', async () => {
    // Same argument as the test above, for the capability the goal is made of.
    // A file store that is built, tested and absent from `tools:` is a store
    // the agent cannot reach, and every other test of it constructs the tool
    // itself and would stay green through exactly that.
    const spec = await catalogue.spec('main')
    const files = new Workspace(new MemoryRepository('File'))

    const resolved = resolveTools({ names: spec.value.tools, services: { files } })
    const toolbox = new Toolbox(resolved.value)

    expect(toolbox.names).toContain('read_file')
    expect(toolbox.names).toContain('write_file')

    const wrote = await toolbox.run('write_file({"path": "notes.md", "content": "kept"})')
    expect(wrote.observation).toContain('wrote notes.md, 4 bytes')
    // Through the real store and back out, so a tool wired to `NO_FILES` by a
    // missing key in the services object fails here rather than answering
    // politely for ever.
    expect((await files.read('notes.md')).value.text).toBe('kept')
    expect((await toolbox.run('read_file({"path": "notes.md"})')).observation).toContain('kept')
  })
})
