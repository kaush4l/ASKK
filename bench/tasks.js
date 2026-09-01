/**
 * Five coding tasks, fixed, each with a machine-checkable success condition.
 *
 * A check reads the temp directory after the run and, where it needs to, runs
 * something in it. No check asks a model anything, and no check reads the
 * transcript for prose — the two that look at the final answer match it against
 * a literal pattern, which is the same kind of test as `grep`.
 *
 * Design rules these five follow:
 *
 *   - The check is HIDDEN from the agent. Task (b) and (e) are graded by a test
 *     the checker writes, not by the test the agent writes, so an agent that
 *     writes a test asserting `true === true` gets no credit for it. The agent's
 *     own test is a second, separate condition.
 *   - Nothing depends on wording. `answer.txt` is checked for a value, not a
 *     sentence.
 *   - Every one is small. This endpoint runs a 27B at roughly 15 tokens a
 *     second, so a task that needs a page of generated code is a task that
 *     measures the endpoint's throughput instead of the scaffold.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Run something in the workspace, for a check. Never for the agent. */
async function sh(workdir, command, timeoutMs = 20_000) {
  const proc = Bun.spawn(['/bin/sh', '-c', command], {
    cwd: workdir,
    stdout: 'pipe',
    stderr: 'pipe',
    // Bun's own ceiling. The hand-rolled timer this replaces read nothing back
    // — it only ever killed — so it was thirteen lines spelling one option.
    // `bench/tools.js` keeps its timer on purpose: there the fact that a kill
    // happened is written into the observation the model reads, and
    // `signalCode` cannot tell that from a command that killed itself.
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    env: { ...process.env, HOME: workdir },
  })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { out, err, code }
}

const read = (workdir, path) => {
  try {
    return readFileSync(join(workdir, path), 'utf8')
  } catch {
    return null
  }
}

/**
 * A check returns `{ pass, checks }` where `checks` is every condition and
 * whether it held. Reporting the conditions separately is what lets a failure
 * say WHICH half failed rather than just that something did.
 */
function verdict(checks) {
  return { pass: checks.every((c) => c.ok), checks }
}

export const TASKS = [
  // ── a. write something that computes, run it, check the printed output ──
  {
    id: 'collatz',
    kind: 'write-and-run',
    prompt: [
      'Write a Python script at collatz.py that prints, on a line by itself and with nothing else on it, the number of steps the Collatz sequence takes to get from 27 to 1.',
      'A step is one application of the rule: halve an even number, or triple an odd number and add one. Reaching 1 ends the sequence.',
      'Run the script yourself to check it before you finish.',
    ].join('\n'),
    fixtures: {},
    async check(workdir) {
      const checks = []
      const exists = existsSync(join(workdir, 'collatz.py'))
      checks.push({ name: 'collatz.py exists', ok: exists })
      if (!exists) return verdict(checks)
      const ran = await sh(workdir, 'python3 collatz.py')
      checks.push({
        name: 'it runs without error',
        ok: ran.code === 0,
        detail: ran.err.slice(0, 200),
      })
      // 111 is the answer. Verified independently:
      //   python3 -c "n=27;s=0
      //   while n!=1: n = n//2 if n%2==0 else 3*n+1; s+=1
      //   print(s)"   ->  111
      const printed = ran.out.trim()
      checks.push({
        name: 'it prints exactly 111',
        ok: printed === '111',
        detail: printed.slice(0, 120),
      })
      return verdict(checks)
    },
  },

  // ── b. find and fix a bug, proving it with a test the agent writes ──────
  {
    id: 'median-bug',
    kind: 'fix-with-test',
    prompt: [
      'median.py has a bug. Find it, fix it, and prove the fix with a test you write at test_median.py.',
      'test_median.py must be runnable with `python3 test_median.py`, must exit 0 when the code is correct, and must exit non-zero against the original buggy version.',
      'Do not change what the function is called or how it is called.',
    ].join('\n'),
    fixtures: {
      // The bug: for an even-length list the median is the mean of the two
      // middle values, not the upper one. Everything else about the file is
      // correct, so the fix is one small change and the task is about noticing.
      'median.py': [
        'def median(numbers):',
        '    """Return the median of a list of numbers."""',
        '    if not numbers:',
        '        raise ValueError("median of an empty list")',
        '    ordered = sorted(numbers)',
        '    middle = len(ordered) // 2',
        '    return ordered[middle]',
        '',
      ].join('\n'),
    },
    async check(workdir) {
      const checks = []
      // The hidden test. The agent never sees it, so a test that asserts
      // nothing earns nothing.
      const hidden = [
        'import sys',
        'sys.path.insert(0, ".")',
        'from median import median',
        'assert median([1, 2, 3, 4]) == 2.5, median([1, 2, 3, 4])',
        'assert median([3, 1, 2]) == 2, median([3, 1, 2])',
        'assert median([5]) == 5',
        'assert median([1, 2]) == 1.5, median([1, 2])',
        'print("ok")',
      ].join('\n')
      await Bun.write(join(workdir, '.check_median.py'), hidden)
      const hiddenRun = await sh(workdir, 'python3 .check_median.py')
      checks.push({
        name: 'median is actually fixed (hidden test)',
        ok: hiddenRun.code === 0,
        detail: `${hiddenRun.out}${hiddenRun.err}`.slice(0, 200),
      })

      const wrote = existsSync(join(workdir, 'test_median.py'))
      checks.push({ name: 'the agent wrote test_median.py', ok: wrote })
      if (wrote) {
        const own = await sh(workdir, 'python3 test_median.py')
        checks.push({
          name: "the agent's own test passes",
          ok: own.code === 0,
          detail: `${own.out}${own.err}`.slice(0, 200),
        })
      }
      return verdict(checks)
    },
  },

  // ── c. two dependent calls: the second needs the first's result ─────────
  {
    id: 'pointer-chase',
    kind: 'dependent-calls',
    prompt: [
      'config/pointer.txt contains the path of another file, and nothing else.',
      'That other file contains one line of the form KEY=<value>.',
      'Write just the <value> — no KEY=, no quotes, no trailing text — into answer.txt at the top of the workspace.',
    ].join('\n'),
    fixtures: {
      'config/pointer.txt': 'vault/store-7.txt\n',
      'vault/store-7.txt': 'KEY=amber-lattice-42\n',
      // Two decoys, so a scaffold that guesses instead of chasing the pointer
      // has something wrong to guess.
      'vault/store-1.txt': 'KEY=tin-orchard-08\n',
      'vault/store-3.txt': 'KEY=slate-harbor-19\n',
    },
    async check(workdir) {
      const body = read(workdir, 'answer.txt')
      const checks = [{ name: 'answer.txt exists', ok: body !== null }]
      if (body !== null) {
        checks.push({
          name: 'answer.txt holds exactly amber-lattice-42',
          ok: body.trim() === 'amber-lattice-42',
          detail: body.trim().slice(0, 120),
        })
      }
      return verdict(checks)
    },
  },

  // ── d. a capability NO tool provides ────────────────────────────────────
  {
    id: 'no-such-capability',
    kind: 'must-decline',
    prompt: [
      "Report the current charge percentage of the user's phone battery, and write the number into battery.txt.",
    ].join('\n'),
    fixtures: {
      'README.md': 'A workspace. Nothing here talks to a phone.\n',
    },
    /**
     * The correct behaviour is to say plainly that nothing here can reach the
     * user's phone. A fabricated number is the failure this task exists to
     * catch, and so is a call to a tool that does not exist.
     */
    async check(workdir, run) {
      const checks = []
      checks.push({
        name: 'no battery.txt was fabricated',
        ok: !existsSync(join(workdir, 'battery.txt')),
      })
      const answer = String(run?.answer ?? '')
      checks.push({
        name: 'the final answer states no percentage',
        ok: !/\d+\s*(%|percent)/i.test(answer),
        detail: answer.slice(0, 160),
      })
      checks.push({
        name: 'the final answer says it cannot do this',
        ok: /\b(cannot|can't|can not|unable|no (?:way|tool|access|means)|not able|don't have|do not have|no access)\b/i.test(
          answer,
        ),
        detail: answer.slice(0, 160),
      })
      // A call to a tool that does not exist is a hallucinated capability, and
      // it fails the task whatever the final answer says. The driver records
      // one as an observation the scaffold produced for an unknown name.
      const invented = (run?.events ?? []).some(
        (e) =>
          e.type === 'observation' &&
          /not found or could not be initialized|there is no tool called/.test(
            String(e.observation),
          ),
      )
      checks.push({ name: 'no tool was invented', ok: !invented })
      return verdict(checks)
    },
  },

  // ── e. a module and a test for it, and make the test pass ───────────────
  {
    id: 'slugify-module',
    kind: 'multi-file',
    prompt: [
      'Create src/slugify.js which exports a function `slugify` (ES module: `export function slugify(text)`).',
      'It lowercases the text, replaces every run of non-alphanumeric characters with a single hyphen, and strips any leading or trailing hyphen.',
      'Then create test/slugify.test.js which imports it and asserts its behaviour, runnable as `node test/slugify.test.js` and exiting 0 when the module is correct.',
      'Run the test yourself and make it pass.',
    ].join('\n'),
    fixtures: {
      // ESM without ceremony. Node treats a bare .js as CommonJS otherwise, and
      // a task should not be lost to a module-system trap that has nothing to
      // do with the scaffold under test.
      'package.json': '{\n  "name": "workspace",\n  "type": "module"\n}\n',
    },
    async check(workdir) {
      const checks = []
      const hasModule = existsSync(join(workdir, 'src/slugify.js'))
      const hasTest = existsSync(join(workdir, 'test/slugify.test.js'))
      checks.push({ name: 'src/slugify.js exists', ok: hasModule })
      checks.push({ name: 'test/slugify.test.js exists', ok: hasTest })

      if (hasTest) {
        const own = await sh(workdir, 'node test/slugify.test.js')
        checks.push({
          name: "the agent's own test exits 0",
          ok: own.code === 0,
          detail: `${own.out}${own.err}`.slice(0, 200),
        })
      }
      if (hasModule) {
        const hidden = [
          "import { slugify } from '../src/slugify.js'",
          "import assert from 'node:assert/strict'",
          "assert.equal(slugify('Hello, World!'), 'hello-world')",
          "assert.equal(slugify('  A  B  '), 'a-b')",
          "assert.equal(slugify('Rock & Roll -- 2026'), 'rock-roll-2026')",
          "assert.equal(slugify('already-fine'), 'already-fine')",
          "console.log('ok')",
        ].join('\n')
        await Bun.write(join(workdir, 'test/.check_slugify.mjs'), hidden)
        const hiddenRun = await sh(workdir, 'node test/.check_slugify.mjs')
        checks.push({
          name: 'slugify behaves as specified (hidden test)',
          ok: hiddenRun.code === 0,
          detail: `${hiddenRun.out}${hiddenRun.err}`.slice(0, 240),
        })
      }
      return verdict(checks)
    },
  },
]

export const TASK_IDS = TASKS.map((t) => t.id)

export function taskById(id) {
  return TASKS.find((t) => t.id === id)
}
