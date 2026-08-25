import { expect, test, describe } from 'bun:test'
import { loadAgents, parseAgentFile, roleHolder } from '@harness/agent'

const PATH = 'public/agents/shopper/agent.md'

/** @param {string} frontmatter @returns {string} */
const file = (frontmatter) => `---\n${frontmatter}\n---\n\nYou shop.\n`

/** @param {string} frontmatter */
function refusalOf(frontmatter) {
  const read = parseAgentFile(PATH, file(frontmatter))
  if (!('refusal' in read)) throw new Error('the file was accepted')
  return read.refusal
}

/** @param {string} frontmatter */
function specOf(frontmatter) {
  const read = parseAgentFile(PATH, file(frontmatter))
  if ('refusal' in read) throw new Error(read.refusal.message)
  return read.spec
}

describe('the YAML subset, written by us because a person may author a file in the browser', () => {
  test('a block list and the inline form are the same list', () => {
    expect(specOf('name: a\ntools:\n  - now\n  - exec').tools).toEqual(['now', 'exec'])
    expect(specOf('name: a\ntools: [now, exec]').tools).toEqual(['now', 'exec'])
  })

  test('quotes are a nicety, comments and blank lines are not values, and a trailing comma costs nothing', () => {
    const spec = specOf('# who this is\nname: "shopper"\n\ntools: [now, exec,]\ndescription: \'buys things\'')
    expect([spec.name, spec.description, spec.tools]).toEqual(['shopper', 'buys things', ['now', 'exec']])
  })

  test('a bare "- item" under no open list is DROPPED and never fed to tools:, because silence must not grant capability', () => {
    expect(specOf('name: a\ndescription: x\n- exec').tools).toEqual([])
  })

  test('an empty tools: list is a choice somebody wrote — every built-in — and stays empty on the spec', () => {
    expect(specOf('name: a\ntools: []').tools).toEqual([])
  })

  test('a line that is neither is REFUSED, not dropped: "exec" alone parses clean while nothing reads it', () => {
    const refusal = refusalOf('name: a\nexec\nrm -rf /')
    expect(refusal.key).toBe('')
    expect(refusal.message).toContain('"exec"')
  })

  test('a key written twice is refused: last-wins is a choice made on the author behalf', () => {
    expect(refusalOf('name: a\nmodel: x\nmodel: y').key).toBe('model')
    expect(specOf('name: a\ntools:\n  - now\n  - exec').tools).toEqual(['now', 'exec'])
  })
})

describe('a file this build cannot read is refused BY KEY AND BY PATH, never defaulted', () => {
  test('a missing name names the key and the file', () => {
    const refusal = refusalOf('description: buys things')
    expect(refusal.key).toBe('name')
    expect(refusal.path).toBe(PATH)
    expect(refusal.message).toContain(PATH)
    expect(refusal.message).toContain('"name"')
  })

  test('a misspelt key is refused rather than ignored: a setting that looks applied is worse than none', () => {
    const refusal = refusalOf('name: a\ntemprature: 0.7')
    expect(refusal.key).toBe('temprature')
    expect(refusal.message).toContain('temperature')
  })

  test('a value outside a closed set is named with the set — engine: reakt parsed clean for eighteen rounds', () => {
    expect(refusalOf('name: a\nengine: reakt').message).toContain('one of: react, base')
    expect(refusalOf('name: a\nrole: enrty').key).toBe('role')
  })

  test('a number that is not one is refused, not silently defaulted', () => {
    expect(refusalOf('name: a\ncompact_at: lots').message).toContain('a whole number')
    expect(specOf('name: a').compactAt).toBe(75)
  })

  test('a key with nothing after it is refused — temperature: alone used to parse to 0 and run fully deterministic', () => {
    expect(refusalOf('name: a\ntemperature:').key).toBe('temperature')
    expect(refusalOf('name: a\ntemperature:').message).toContain('nothing after it')
    expect(specOf('name: a').temperature).toBe(null)
  })

  test('a tools: line of the wrong shape is refused, because dropping it would grant EVERY built-in', () => {
    expect(refusalOf('name: a\ntools: exec').message).toContain('reads it as a list')
  })

  test('a stage name this build does not have is named with the ones it does', () => {
    expect(refusalOf('name: a\nstages: [plan, wrok]').message).toContain('"wrok"')
  })

  test('frontmatter that never closes is refused whole, and the key is empty because the failure is the file', () => {
    const read = parseAgentFile(PATH, '---\nname: a\n\nYou shop.')
    if (!('refusal' in read)) throw new Error('an unterminated file was accepted')
    expect(read.refusal.key).toBe('')
  })
})

describe('two keys that each parse and together mean nothing', () => {
  test('engine: base with a tools: list is refused — it would never be granted', () => {
    expect(refusalOf('name: a\nengine: base\ntools: [now]').key).toBe('tools')
  })

  test('engine: base with a stages: list is refused — base is ONE reply', () => {
    expect(refusalOf('name: a\nengine: base\nstages: [work]').key).toBe('stages')
  })

  test('a stages: list that can never act is refused; [strategy] is not, because the vote picks a list that does', () => {
    expect(refusalOf('name: a\nstages: [plan, critique]').message).toContain('needs work')
    expect(specOf('name: a\nstages: [strategy]').stages).toEqual(['strategy'])
  })

  test('a ceiling of zero rounds is refused: it parses clean and can never call a tool', () => {
    expect(refusalOf('name: a\nmax_rounds: 0').key).toBe('max_rounds')
    expect(specOf('name: a\nmax_rounds: 1').maxRounds).toBe(1)
  })

  test('zero passes is refused too: it never walks the stage list it counts laps of', () => {
    expect(refusalOf('name: a\nstages: [work]\npasses: 0').key).toBe('passes')
    expect(specOf('name: a\ncompact_at: 0').compactAt).toBe(0)
  })

  test('passes: with no list to lap is refused: it would parse clean and do nothing', () => {
    expect(refusalOf('name: a\npasses: 3').key).toBe('passes')
    expect(specOf('name: a\nstages: [work]\npasses: 3').passes).toBe(3)
  })
})

describe('the roster: many files at once', () => {
  const of = (/** @type {string} */ name, /** @type {string} */ front) => ({ path: `public/agents/${name}/agent.md`, text: file(front) })

  test('a broken file costs that one agent and no more, and its refusal comes back beside the rest', () => {
    const { specs, refusals } = loadAgents([of('a', 'name: a'), of('b', 'engine: reakt'), of('c', 'name: c')])
    expect(specs.map((s) => s.name)).toEqual(['a', 'c'])
    expect(refusals.map((r) => r.path)).toEqual(['public/agents/b/agent.md'])
  })

  test('a later file of the same name REPLACES the built-in it shadows', () => {
    const { specs } = loadAgents([of('a', 'name: a\nmodel: local'), of('a', 'name: a\nmodel: cloud')])
    expect(specs.map((s) => s.model)).toEqual(['cloud'])
  })

  test('two files claiming one job: the loser is reported AND stripped, so no file says it holds a job it does not', () => {
    const { specs, refusals } = loadAgents([of('main', 'name: main\nrole: entry'), of('copy', 'name: copy\nrole: entry')])
    expect(roleHolder(specs, 'entry')?.name).toBe('copy')
    expect(specs.find((s) => s.name === 'main')?.role).toBe('')
    expect(refusals[0]?.message).toContain('2 agents declare "role: entry"')
  })
})
