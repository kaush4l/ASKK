import { expect, test, describe } from 'bun:test'
import { ALL_TOOLS, NO_TOOLS, actsIn, briefPath, grant, loadBriefs, onlyTools, resolveStage, WORK_BUDGET } from '@harness/agent'

const BRIEFS = ['strategy', 'plan', 'verify', 'critique', 'durable'].map((key) => ({ key, text: `the ${key} words` }))
const loaded = loadBriefs(BRIEFS)
if ('refusal' in loaded) throw new Error(loaded.refusal.message)

describe('a stage grants tools', () => {
  const toolbox = [{ name: 'exec' }, { name: 'read_file' }, { name: 'write_file' }]

  test('none yields an empty toolbox, so a stage that may not act cannot even NAME a tool', () => {
    expect(grant(NO_TOOLS, toolbox)).toEqual([])
  })

  test('all yields whatever this agent was given, and does not alias it', () => {
    const granted = grant(ALL_TOOLS, toolbox)
    expect(granted).toEqual(toolbox)
    expect(granted).not.toBe(toolbox)
  })

  test('only yields exactly the named tools, in the TOOLBOX order the agent file set', () => {
    expect(grant(onlyTools(['write_file', 'exec']), toolbox)).toEqual([{ name: 'exec' }, { name: 'write_file' }])
  })

  test('naming a tool this agent does not hold grants nothing rather than inventing it', () => {
    expect(grant(onlyTools(['launch_missiles']), toolbox)).toEqual([])
  })

  test('only work and verify may act: a stage added to the vocabulary takes nothing by omission', () => {
    expect([actsIn('work'), actsIn('verify')]).toEqual([true, true])
    expect([actsIn('strategy'), actsIn('plan'), actsIn('critique'), actsIn('answer')]).toEqual([false, false, false, false])
    expect(WORK_BUDGET.maxTokens).toBe(8192)
  })
})

describe('the briefs are fetched, and a missing one is loud at both ends', () => {
  test('a stage is its words, its allowlist and the shape it must answer in', () => {
    const stage = resolveStage('critique', { briefs: loaded.briefs })
    if ('refusal' in stage) throw new Error(stage.refusal.message)
    expect(stage.stage).toEqual({ name: 'critique', brief: 'the critique words', toolAllowlist: NO_TOOLS, responseSchema: null })
  })

  test('work and answer carry no brief: the person own request is the instruction, and a second would compete with it', () => {
    for (const name of /** @type {const} */ (['work', 'answer'])) {
      const stage = resolveStage(name, { briefs: loaded.briefs })
      expect('refusal' in stage ? '' : stage.stage.brief).toBe('')
    }
  })

  test('a half-loaded set refuses at LOAD, naming the file that is missing', () => {
    const short = loadBriefs(BRIEFS.filter((b) => b.key !== 'verify'))
    if (!('refusal' in short)) throw new Error('a half-loaded set was accepted')
    expect(short.refusal.key).toBe('verify')
    expect(short.refusal.path).toBe(briefPath('verify'))
  })

  test('an empty file is refused too — a stage entered with no instruction looks exactly like one that ran', () => {
    const blank = loadBriefs(BRIEFS.map((b) => (b.key === 'plan' ? { key: 'plan', text: '   \n' } : b)))
    expect('refusal' in blank && blank.refusal.message).toContain('is empty')
  })

  test('a key nothing walks is refused: a file somebody wrote that nothing will ever read', () => {
    const strange = loadBriefs([...BRIEFS, { key: 'work', text: 'do it' }])
    expect('refusal' in strange && strange.refusal.key).toBe('work')
  })

  test('and a briefed stage whose file never arrived refuses AT THE STAGE rather than entering empty', () => {
    const stage = resolveStage('verify', { briefs: { strategy: 'x' } })
    if (!('refusal' in stage)) throw new Error('an unbriefed stage was entered')
    expect(stage.refusal.message).toContain(briefPath('verify'))
  })

  test('the durable paragraph is appended by the APPENDER, so plan.md never has to be split on a separator', () => {
    const withSpace = resolveStage('plan', { briefs: loaded.briefs, hasSpace: true })
    const alone = resolveStage('plan', { briefs: loaded.briefs })
    expect('refusal' in withSpace ? '' : withSpace.stage.brief).toBe('the plan words\n\nthe durable words')
    expect('refusal' in alone ? '' : alone.stage.brief).toBe('the plan words')
  })
})
