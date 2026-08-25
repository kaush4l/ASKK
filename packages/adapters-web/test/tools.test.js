import { expect, test, describe } from 'bun:test'
import { CAPABILITIES } from '@harness/kernel'
import { fakeClock, testPorts } from '@harness/adapters-test'
import { SPACE, available, facultyTools, loadAgents, spaceNamed, toolboxFor } from '@harness/agent'
import { bootFresh, parseSkill } from '@harness/core'
import { fakeWorkspace, memorySegments } from './doubles.js'
import { CATALOGUE, toolRunners } from '../src/toolset.js'
import { replaced } from '../src/edit.js'
import { matches } from '../src/find.js'

/** The tools `apps/web/public/agents/main/agent.md` names, read off that file rather than copied. */
const AGENT_FILE = `${import.meta.dir}/../../../apps/web/public/agents/main/agent.md`

/** One build with a real tool table over a fake workspace. @param {Record<string, string>} [files] */
function build(files = {}) {
  const clock = fakeClock({ start: 1_700_000_000_000, step: 0 })
  const ports = { ...testPorts({ clock }), workspace: fakeWorkspace(files) }
  const app = bootFresh({
    ports,
    available: [...CAPABILITIES],
    segments: memorySegments(),
    tools: toolRunners(ports, { keyFor: () => '' }),
    roster: { ...loadAgents([{ path: 'agents/scout/agent.md', text: '---\nname: scout\ndescription: reads things\n---\nYou look things up.\n' }]), paths: { scout: 'agents/scout/agent.md' } },
    skills: [/** @type {any} */ (parseSkill('tool-calls', '---\ndescription: how to write a call\n---\nWrite it as JSON.\n'))],
  })
  return app
}

/**
 * The catalogue `adoptSpec` actually resolves against: this build's tools plus
 * the ones this file's own faculties bring — and a named SPACE is a faculty
 * under an older spelling, which is why `space: research` grants `remember`
 * with no entry in `faculties:`.
 * @param {import('@harness/agent').AgentSpec} spec
 */
function catalogueFor(spec) {
  const named = [...(spaceNamed(spec.space) ? [SPACE] : []), ...spec.faculties].filter((n) => n !== '')
  return [...CATALOGUE, ...facultyTools([...new Set(named)])]
}

/** @param {import('@harness/core').App} app @param {string} name @param {Record<string, unknown>} args */
function call(app, name, args) {
  const runner = app.tools[name]
  if (!runner) throw new Error(`no runner for ${name}`)
  return runner(JSON.stringify(args), { signal: new AbortController().signal })
}

describe('every tool the shipped agent file names', () => {
  test('resolves to a descriptor with a runner behind it, or is named in a request to the lead', async () => {
    // THE GAP, EXECUTED. `unresolved` is honest and the agents pane is the only
    // place a person meets it, so this is the check that says which names are
    // still owed. Anything appearing here that is not in `OWED` is a name the
    // shipped file grants and this build silently cannot answer.
    //
    // THE LIST IS EMPTY, and it took two strikings to get there. The lead
    // struck `observe` and the four process tools from
    // `apps/web/public/agents/main/agent.md`, because they need a place that
    // keeps a command alive between turns and this build's workspace is OPFS,
    // which stores files and runs nothing. `write_agent` and `spawn_agent` were
    // the last two: they needed one Worker per agent, and the composition root
    // now starts one. An empty list is the claim — anything appearing here is a
    // name the shipped file grants and this build silently cannot answer.
    const OWED = /** @type {string[]} */ ([])
    const app = build()
    const read = loadAgents([{ path: 'agents/main/agent.md', text: await Bun.file(AGENT_FILE).text() }])
    const spec = read.specs[0]
    if (!spec) throw new Error(read.refusals[0]?.message ?? 'main/agent.md did not parse')
    const peers = [{ ...spec, name: 'critic', description: 'checks work' }]
    const box = toolboxFor(spec, { catalogue: catalogueFor(spec), offered: [...CAPABILITIES], peers })
    expect([...box.unresolved].sort()).toEqual([...OWED].sort())
  })

  test('and no tool it DOES resolve is a descriptor with nothing behind it', async () => {
    // The other half of the same defect: a name the model is told it may call
    // and that comes back refused. The faculty tools are exempt — the loop
    // answers those, not this table.
    const app = build()
    const read = loadAgents([{ path: 'agents/main/agent.md', text: await Bun.file(AGENT_FILE).text() }])
    const spec = /** @type {any} */ (read.specs[0])
    const faculty = new Set(catalogueFor(spec).filter((t) => !CATALOGUE.includes(t)).map((t) => t.name))
    const box = toolboxFor(spec, { catalogue: catalogueFor(spec), offered: [...CAPABILITIES] })
    const runnerless = box.toolbox.filter((t) => !faculty.has(t.name) && !Object.hasOwn(app.tools, t.name))
    expect(runnerless.map((t) => t.name)).toEqual([])
  })

  test('each of the seven that landed answers a real call', async () => {
    const app = build({ 'notes/today.md': 'one\ntwo\nTODO ship it\n' })
    expect((await call(app, 'now', {})).output).toContain('2023-11-14T')
    expect((await call(app, 'list_agents', {})).output).toBe('scout: reads things')
    expect((await call(app, 'read_agent', { name: 'scout' })).output).toContain('You look things up.')
    expect((await call(app, 'list_skills', {})).output).toContain('tool-calls: how to write a call')
    expect((await call(app, 'read_skill', { name: 'tool-calls' })).output).toContain('Write it as JSON.')
    expect((await call(app, 'find_files', { text: 'TODO' })).output).toContain('notes/today.md:3:TODO ship it')
    expect((await call(app, 'edit_file', { path: 'notes/today.md', find: 'two', replace: 'THREE' })).output)
      .toBe('edited notes/today.md: replaced one occurrence, at line 2.')
  })

  test('a name nothing here answers to is a RESULT the model can read, not a throw', async () => {
    const app = build()
    expect(await call(app, 'read_agent', { name: 'nobody' })).toEqual({
      ok: false, output: 'No agent called "nobody". Loaded: scout',
    })
    expect((await call(app, 'read_skill', { name: 'nothing' })).ok).toBe(false)
  })

  test('a withheld capability keeps the file tools out of the toolbox, and leaves the local three in', () => {
    const offered = CAPABILITIES.filter((id) => id !== 'workspace')
    const named = (/** @type {string} */ n) => CATALOGUE.find((t) => t.name === n)
    expect(available(/** @type {any} */ (named('edit_file')), offered)).toBe(false)
    expect(available(/** @type {any} */ (named('find_files')), offered)).toBe(false)
    // The local three need nothing but this page, which is why they declare no
    // capability: withholding one would hide a read of state the App already has.
    for (const n of ['now', 'list_agents', 'read_agent', 'list_skills', 'read_skill']) {
      expect(available(/** @type {any} */ (named(n)), offered)).toBe(true)
    }
  })
})

describe('edit_file refuses rather than guesses', () => {
  test('the rule, in all four directions', () => {
    expect(replaced('a b a', 'b', 'B')).toEqual({ after: 'a B a' })
    expect(replaced('a b a', 'a', 'X')).toEqual({ why: expect.stringContaining('there 2 times') })
    expect(replaced('a b a', 'z', 'X')).toEqual({ why: 'that text is not there' })
    expect(replaced('a b a', '', 'X')).toEqual({ why: expect.stringContaining('empty') })
    // Verbatim: the leading whitespace is part of what was named, so it is not
    // trimmed the way an identifier argument is.
    expect(replaced('x\n    y\n', '    y', '    z')).toEqual({ after: 'x\n    z\n' })
  })

  test('a file with the text twice is UNCHANGED, and the refusal says the number and quotes the search back', async () => {
    const files = { 'a.md': 'hello\nhello\n' }
    const app = build(files)
    const ran = await call(app, 'edit_file', { path: 'a.md', find: 'hello', replace: 'goodbye' })
    expect(ran.ok).toBe(false)
    expect(ran.output).toContain('a.md is unchanged')
    expect(ran.output).toContain('there 2 times')
    expect(ran.output).toContain('hello')
    expect(ran.output).toContain('edit_file({')
    expect(files['a.md']).toBe('hello\nhello\n')
  })

  test('a huge search is quoted back BOUNDED — a refusal must not spend the window', () => {
    const app = build({ 'a.md': 'x' })
    return call(app, 'edit_file', { path: 'a.md', find: 'q'.repeat(5000), replace: '' })
      .then((ran) => expect(ran.output.length).toBeLessThan(1200))
  })
})

describe('find_files, without a shell to run find in', () => {
  test('the one glob it honours is *, applied to a name and not a path', () => {
    expect(matches('*.md', 'today.md')).toBe(true)
    expect(matches('*.md', 'today.mdx')).toBe(false)
    expect(matches('note*', 'notes.txt')).toBe(true)
    expect(matches('a*c', 'ac')).toBe(true)
    expect(matches('a*c', 'abbbc')).toBe(true)
    expect(matches('exact', 'exact')).toBe(true)
    expect(matches('exact', 'inexact')).toBe(false)
  })

  test('a search that found nothing SAYS what it looked for', async () => {
    const app = build({ 'a.md': 'nothing here' })
    const ran = await call(app, 'find_files', { name: '*.rs' })
    expect(ran.output).toBe('Nothing in this folder matches: files named *.rs.')
  })

  test('it walks into folders and skips our own records', async () => {
    const app = build({ 'src/deep/a.md': 'x', '.harness/proc/1': 'x' })
    expect((await call(app, 'find_files', { name: '*' })).output).toContain('src/deep/a.md')
    expect((await call(app, 'find_files', { name: '*' })).output).not.toContain('.harness')
  })

  test('the cap it announces is the cap it keeps, even when a folder carries it past in one step', async () => {
    // ACROSS TWO FOLDERS on purpose: `walk` checks the count between entries, so
    // a sub-directory arrives whole and the array crosses the cap in one push.
    /** @type {Record<string, string>} */
    const files = {}
    for (let i = 0; i < 40; i++) files[`one/a${i}.md`] = files[`two/b${i}.md`] = 'x'
    const ran = await call(build(files), 'find_files', { name: '*.md' })
    const [headline = '', ...lines] = ran.output.split('\n')
    expect(headline).toContain('capped at 60')
    expect(lines).toHaveLength(60)
    expect(headline.startsWith(`${lines.length} match(es)`)).toBe(true)
  })

  test('a search with no subject is refused rather than answered with the whole workspace', async () => {
    const app = build({ 'a.md': 'x' })
    expect((await call(app, 'find_files', {})).ok).toBe(false)
  })
})
