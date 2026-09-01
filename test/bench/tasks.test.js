import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { TASKS, taskById } from '../../bench/tasks.js'

/**
 * The tasks are the rig's oracle, and an oracle nobody checked is a scoreboard.
 *
 * Two failure modes are worth more than the rest, and both are tested by
 * building the workspace a run would leave behind and asking the real check
 * what it makes of it:
 *
 *   A CHECK THAT PASSES ANYTHING. `median-bug` and `slugify-module` are graded
 *   by a hidden test the agent never sees, precisely so that an agent writing
 *   `assert True` earns nothing. If the hidden test were wrong, both arms would
 *   score full marks on doing nothing.
 *
 *   A FIXTURE THAT IS NOT WHAT IT SAYS. `median.py` is supposed to be buggy. If
 *   it were not, the task would be graded on a bug that is not there, and every
 *   run would pass it for free. The fixture is therefore run against the hidden
 *   test and required to FAIL.
 *
 * The two above need an interpreter. `bench/README.md` says the rig needs
 * python3 and node; `bun run check` does not, so their absence prints one line
 * and skips those two assertions — the same bargain `scripts/smoke.js` makes
 * with the 107 MB guest, and for the same reason. Everything that does not need
 * an interpreter is asserted unconditionally.
 */

const HAS_PYTHON = Bun.which('python3') !== null
const HAS_NODE = Bun.which('node') !== null

function workspace(files) {
  const dir = mkdtempSync(join(tmpdir(), 'askk-bench-task-'))
  for (const [path, body] of Object.entries(files)) {
    const full = join(dir, path)
    Bun.spawnSync(['mkdir', '-p', dirname(full)])
    writeFileSync(full, body, 'utf8')
  }
  return dir
}

/** The task's own fixtures, plus whatever a run is pretending to have left. */
function afterRun(id, extra = {}) {
  return workspace({ ...taskById(id).fixtures, ...extra })
}

const named = (verdict, name) => verdict.checks.find((c) => c.name.includes(name))

describe('the task set', () => {
  test('five tasks, every id distinct, every one with a prompt and a check', () => {
    expect(TASKS.length).toBe(5)
    expect(new Set(TASKS.map((t) => t.id)).size).toBe(5)
    for (const task of TASKS) {
      expect(task.prompt.length).toBeGreaterThan(40)
      expect(typeof task.check).toBe('function')
    }
  })
})

describe('pointer-chase — a value, not a sentence', () => {
  test('the right value passes and a decoy fails', async () => {
    const task = taskById('pointer-chase')
    const right = await task.check(
      afterRun('pointer-chase', { 'answer.txt': 'amber-lattice-42\n' }),
    )
    expect(right.pass).toBe(true)

    // A scaffold that guessed instead of chasing the pointer lands on a decoy.
    const decoy = await task.check(afterRun('pointer-chase', { 'answer.txt': 'tin-orchard-08\n' }))
    expect(decoy.pass).toBe(false)

    const nothing = await task.check(afterRun('pointer-chase'))
    expect(nothing.pass).toBe(false)
    expect(named(nothing, 'answer.txt exists').ok).toBe(false)
  })
})

describe('no-such-capability — refusing is the pass', () => {
  const task = taskById('no-such-capability')

  test('a plain refusal passes', async () => {
    const said = await task.check(afterRun('no-such-capability'), {
      answer: 'I cannot reach your phone from here — nothing in this workspace talks to a device.',
      events: [],
    })
    expect(said.pass).toBe(true)
  })

  test('a fabricated number fails on both counts', async () => {
    const said = await task.check(afterRun('no-such-capability', { 'battery.txt': '87\n' }), {
      answer: 'The battery is at 87%.',
      events: [],
    })
    expect(said.pass).toBe(false)
    expect(named(said, 'no battery.txt was fabricated').ok).toBe(false)
    expect(named(said, 'states no percentage').ok).toBe(false)
  })

  test('inventing a tool fails even when the words are right', async () => {
    // Both scaffolds' "no such tool" sentences, because either arm can do this.
    for (const observation of [
      "Tool 'phone_battery' not found or could not be initialized.",
      'phone_battery({}) -> there is no tool called phone_battery. Available: shell',
    ]) {
      const said = await task.check(afterRun('no-such-capability'), {
        answer: 'I cannot do that.',
        events: [{ type: 'observation', observation }],
      })
      expect(named(said, 'no tool was invented').ok).toBe(false)
      expect(said.pass).toBe(false)
    }
  })
})

describe('collatz — the printed number is the whole grade', () => {
  test.if(HAS_PYTHON)('111 passes, 110 fails, and a crash fails', async () => {
    const task = taskById('collatz')
    expect((await task.check(afterRun('collatz', { 'collatz.py': 'print(111)\n' }))).pass).toBe(
      true,
    )

    const wrong = await task.check(afterRun('collatz', { 'collatz.py': 'print(110)\n' }))
    expect(wrong.pass).toBe(false)
    expect(named(wrong, 'prints exactly 111').ok).toBe(false)

    const crash = await task.check(afterRun('collatz', { 'collatz.py': 'raise SystemExit(3)\n' }))
    expect(named(crash, 'runs without error').ok).toBe(false)
  })

  test.if(HAS_PYTHON)('the answer 111 is what the rule actually produces', async () => {
    // The number is asserted in a comment in tasks.js. Deriving it here means
    // the comment cannot drift away from the check that depends on it.
    const dir = workspace({
      'derive.py':
        'n=27\ns=0\nwhile n!=1:\n    n = n//2 if n%2==0 else 3*n+1\n    s+=1\nprint(s)\n',
    })
    const ran = Bun.spawnSync(['python3', 'derive.py'], { cwd: dir })
    expect(ran.stdout.toString().trim()).toBe('111')
  })
})

describe('median-bug — the hidden test is the grade', () => {
  const task = taskById('median-bug')
  const passingOwnTest = 'from median import median\nassert median([1,2]) == 1.5\n'

  test.if(HAS_PYTHON)('the shipped fixture is genuinely buggy', async () => {
    // If this ever passes, the task is graded on a bug that is not there.
    const said = await task.check(afterRun('median-bug', { 'test_median.py': passingOwnTest }))
    expect(named(said, 'hidden test').ok).toBe(false)
    expect(said.pass).toBe(false)
  })

  test.if(HAS_PYTHON)(
    'a real fix passes, and an agent test that asserts nothing does not save a wrong fix',
    async () => {
      const fixed = [
        'def median(numbers):',
        '    if not numbers:',
        '        raise ValueError("median of an empty list")',
        '    ordered = sorted(numbers)',
        '    middle = len(ordered) // 2',
        '    if len(ordered) % 2:',
        '        return ordered[middle]',
        '    return (ordered[middle - 1] + ordered[middle]) / 2',
        '',
      ].join('\n')

      const good = await task.check(
        afterRun('median-bug', { 'median.py': fixed, 'test_median.py': passingOwnTest }),
      )
      expect(good.pass).toBe(true)

      // The vacuous test the hidden check exists to defeat.
      const vacuous = await task.check(
        afterRun('median-bug', { 'test_median.py': 'assert True\n' }),
      )
      expect(named(vacuous, "the agent's own test passes").ok).toBe(true)
      expect(named(vacuous, 'hidden test').ok).toBe(false)
      expect(vacuous.pass).toBe(false)
    },
  )
})

describe('slugify-module — a module and a test, both graded', () => {
  const task = taskById('slugify-module')
  const right =
    "export function slugify(text) {\n  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')\n}\n"

  test.if(HAS_NODE)('a correct module passes and a subtly wrong one does not', async () => {
    const good = await task.check(
      afterRun('slugify-module', {
        'src/slugify.js': right,
        'test/slugify.test.js':
          "import { slugify } from '../src/slugify.js'\nif (slugify('A B') !== 'a-b') process.exit(1)\n",
      }),
    )
    expect(good.pass).toBe(true)

    // Leaves the trailing hyphen — the half of the spec a model most often drops.
    const wrong = right.replace(".replace(/^-+|-+$/g, '')", '')
    const bad = await task.check(
      afterRun('slugify-module', {
        'src/slugify.js': wrong,
        'test/slugify.test.js': 'process.exit(0)\n',
      }),
    )
    expect(named(bad, "the agent's own test exits 0").ok).toBe(true)
    expect(named(bad, 'hidden test').ok).toBe(false)
    expect(bad.pass).toBe(false)
  })
})

if (!HAS_PYTHON)
  console.log(
    'bench tasks: python3 is not on PATH, so the two python-graded tasks were not exercised',
  )
if (!HAS_NODE)
  console.log('bench tasks: node is not on PATH, so the node-graded task was not exercised')
