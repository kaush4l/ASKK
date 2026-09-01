import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AZ_ROOT,
  buildSystemPrompt,
  CUTS,
  missedCuts,
  scaffold,
} from '../../bench/scaffolds/agent-zero.js'

/**
 * The reference arm, held to its own promise.
 *
 * This scaffold's whole claim is that it sends what agent-zero sends, minus a
 * listed set of cuts. Both halves are checkable without a model:
 *
 *   1. the vendored prompt text is upstream's, byte for byte — the hashes in
 *      PROVENANCE.md are re-derived here rather than trusted;
 *   2. every cut in CUTS actually applied. A `.replace()` whose pattern no
 *      longer matches is silent, and a silently-missed cut leaves the reference
 *      arm promising a tool this rig cannot give it — which would then read as
 *      agent-zero wasting turns rather than as this file drifting. ONE SUCH CUT
 *      WAS ALREADY DEAD when the rig was moved in: the pattern spelled
 *      `open_in_canvas` where the vendored file says `open_in_canvas: true`, so
 *      112 characters of instruction about a canvas/Editor that does not exist
 *      survived into every agent-zero prompt the scratch rig ever sent.
 */

describe('vendored agent-zero prompts', () => {
  test('every file PROVENANCE.md names hashes to what PROVENANCE.md says', async () => {
    const provenance = readFileSync(join(AZ_ROOT, 'PROVENANCE.md'), 'utf8')
    const rows = [...provenance.matchAll(/^ {4}([0-9a-f]{64}) {2}(\S+)$/gm)]
    // Twenty: seventeen prompt files, traced through readPrompt rather than
    // copied wholesale, plus the two python files that are the oracle for the
    // parser divergence in CUTS, plus `agent.py` — which nothing here runs
    // either, and which this scaffold cites fifteen times. Every one of those
    // citations used to be uncheckable from this repository.
    expect(rows.length).toBe(20)
    expect(rows.filter(([, , path]) => path.startsWith('helpers/')).length).toBe(2)

    for (const [, expected, path] of rows) {
      const bytes = readFileSync(join(AZ_ROOT, path))
      const actual = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
      expect(`${path} ${actual}`).toBe(`${path} ${expected}`)
    }
  })
})

describe('agent-zero system prompt', () => {
  const prompt = buildSystemPrompt('/workspace')

  test('every declared cut applied', () => {
    // `buildSystemPrompt` resets the record, so this reads the assembly above.
    expect(missedCuts()).toEqual([])
  })

  test('no cut tool survives into what the model is sent', () => {
    // One string per CUTS row that names a capability. A tool listed in the
    // prompt and absent from `act` is a turn agent-zero spends on nothing.
    const gone = [
      'call_subordinate',
      'search_engine',
      'notify_user',
      'scheduler',
      'document_query',
      'vision_load',
      'office_artifact',
      'skills_tool',
      'memorize',
      '§§include',
      'open_in_canvas',
      'line_from',
      'runtime=output',
      '#### patch',
    ]
    expect(gone.filter((term) => prompt.includes(term))).toEqual([])
  })

  test('the environment section states this rig and not upstream’s container', () => {
    // Upstream says kali linux, /a0 and /opt/venv. Leaving that in would have
    // agent-zero probe for paths that are not there — sabotage dressed as
    // faithfulness.
    expect(prompt).not.toContain('/a0')
    expect(prompt).not.toContain('/opt/venv')
    expect(prompt).toContain('your working directory is /workspace')
  })

  test('the three kept tools are still there, under their own names', () => {
    for (const kept of ['response', 'code_execution_tool', 'text_editor']) {
      expect(prompt).toContain(kept)
    }
  })

  test('the parts upstream writes are upstream’s own bytes', () => {
    // The role file is vendored and uncut, so its text must survive verbatim.
    const role = readFileSync(join(AZ_ROOT, 'prompts/agent.system.main.role.md'), 'utf8').trim()
    expect(role.length).toBeGreaterThan(40)
    expect(prompt).toContain(role.split('\n')[0])
  })

  test('CUTS is stamped into the scaffold the driver carries', () => {
    expect(scaffold.cuts).toBe(CUTS)
    for (const entry of CUTS) {
      expect(entry.where).toBeTruthy()
      expect(entry.why).toBeTruthy()
    }
  })
})

describe('agent-zero tool-call contract', () => {
  const state = {
    workdir: '/workspace',
    system: '',
    history: [],
    lastResponse: '',
    unusable: 0,
    stopped: '',
  }

  test('a bare JSON object is a tool request', () => {
    const action = scaffold.parse(
      '{"thoughts":["a"],"tool_name":"code_execution_tool","tool_args":{"runtime":"terminal","code":"ls"}}',
      { ...state },
    )
    expect(action.kind).toBe('tool')
    expect(action.tool).toBe('code_execution_tool')
    expect(action.args.code).toBe('ls')
  })

  test('prose around the object is a misformat, which is the strictness under test', () => {
    // extract_tools.py refuses anything that does not start `{` and end `}`.
    // How often a contract survives contact with a model is what the rig
    // measures, so this must not be leniently repaired.
    const action = scaffold.parse('Sure! {"tool_name":"response","tool_args":{"text":"hi"}}', {
      ...state,
    })
    expect(action.kind).toBe('malformed')
    expect(action.reason).toBe('misformat')
  })

  test('`tool_name: "x:action"` splits into tool_args.action', () => {
    const action = scaffold.parse('{"tool_name":"text_editor:write","tool_args":{"path":"a"}}', {
      ...state,
    })
    expect(action.tool).toBe('text_editor')
    expect(action.args.action).toBe('write')
  })

  test('the response tool ends the run', () => {
    const action = scaffold.parse('{"tool_name":"response","tool_args":{"text":"done"}}', {
      ...state,
    })
    expect(action.kind).toBe('answer')
    expect(action.text).toBe('done')
  })

  test('the three shapes upstream accepts and this arm does not, pinned', () => {
    // THE ONE CUT THAT MAKES THE REFERENCE ARM WORSE, and it lands on the
    // quantity this rig measures. Upstream's `extract_tool_request` parses the
    // object with DirtyJson; `extractToolRequest` here uses `JSON.parse`. These
    // are the shapes that differ, measured against the vendored oracle at
    // `bench/vendor/agent-zero/helpers/extract_tools.py` with the command in
    // PROVENANCE.md, so a reader can re-derive every line of this table from
    // this repository. `misformat` here, `ACCEPT` there:
    const divergent = [
      '{"tool_name":"code_execution_tool","tool_args":{"runtime":"terminal","code":"ls",}}',
      "{'tool_name': 'code_execution_tool', 'tool_args': {'runtime': 'terminal', 'code': 'ls'}}",
      '{tool_name: "code_execution_tool", tool_args: {runtime: "terminal", code: "ls"}}',
    ]
    for (const shape of divergent) {
      const action = scaffold.parse(shape, { ...state })
      expect(`${shape.slice(0, 24)} -> ${action.kind}/${action.reason}`).toBe(
        `${shape.slice(0, 24)} -> malformed/misformat`,
      )
    }

    // And the shapes where the two AGREE, so the row in CUTS claims a
    // divergence exactly as wide as the measurement and no wider. The critic
    // who found this listed an unterminated object as a fourth divergence; it
    // is not one — upstream's `extract_json_root_string(content) != content`
    // rejects it too, and so does the `endsWith('}')` gate for a fence.
    const agreed = [
      '{"tool_name":"code_execution_tool","tool_args":{"runtime":"terminal","code":"ls"}',
      'Sure! {"tool_name":"response","tool_args":{"text":"hi"}}',
      '```json\n{"tool_name":"response","tool_args":{"text":"hi"}}\n```',
    ]
    for (const shape of agreed) {
      expect(scaffold.parse(shape, { ...state }).kind).toBe('malformed')
    }
  })

  test('the divergence is DECLARED, so no misformat count can be quoted without it', () => {
    // A gap disclosed nowhere is a gap nobody carries into the result. This row
    // is stamped into every transcript by run.js.
    const row = CUTS.find((entry) => entry.where.includes('extract_tools.py'))
    expect(row).toBeDefined()
    expect(row.dropped).toEqual(['trailing commas', 'single-quoted strings', 'unquoted keys'])
  })

  test('an identical reply is refused before it is parsed', () => {
    const raw = '{"tool_name":"response","tool_args":{"text":"done"}}'
    const action = scaffold.parse(raw, { ...state, lastResponse: raw })
    expect(action.kind).toBe('malformed')
    expect(action.reason).toBe('repeat')
  })

  test('five consecutive unusable replies stop the run, and a usable one resets the count', () => {
    // agent-zero's own circuit breaker. Ours has none, which is a finding the
    // rig reports rather than a gap it fills.
    const live = { ...state, history: [] }
    for (let i = 0; i < 4; i++) {
      scaffold.observe(live, { action: { kind: 'malformed', raw: `x${i}` }, observation: 'no' })
    }
    expect(scaffold.stopped(live)).toBe('')
    scaffold.observe(live, {
      action: { kind: 'tool', tool: 'text_editor', raw: 'y' },
      observation: 'ok',
    })
    expect(live.unusable).toBe(0)
    for (let i = 0; i < 5; i++) {
      scaffold.observe(live, { action: { kind: 'malformed', raw: `z${i}` }, observation: 'no' })
    }
    expect(scaffold.stopped(live)).toContain('5 consecutive unusable')
  })
})
