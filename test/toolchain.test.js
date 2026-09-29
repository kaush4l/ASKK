import { expect, test } from 'bun:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describeToolchain } from '../src/execution/toolchain.js'
import { LocalExecution } from '../src/execution/local.js'
import { BrowserLinuxExecution } from '../src/execution/browser-linux.js'

test('local command facts follow the reported runtime without inventing npm or probe evidence', async () => {
  const local = new LocalExecution()
  expect(local.describeCapabilities().toolchain).toEqual({ kind: 'unknown', version: undefined })
  for (const runtime of ['bun', 'node', 'other']) {
    local.request = async () => ({ json: async () => ({ runtimeId: `local:${runtime}`, runtime, version: 'fixture', capabilities: ['fs', 'exec'] }) })
    await local.prepare()
    const toolchain = local.describeCapabilities().toolchain
    expect(toolchain.kind).toBe(runtime)
    if (runtime === 'bun') {
      expect(toolchain.packageManager).toBe('bun')
      expect(toolchain.commandFacts).toMatchObject({ testRunner: 'bun test', packageScript: 'bun run <name>', executionVerified: false })
    } else {
      expect(toolchain.commandFacts).toBeUndefined()
      expect(toolchain.packageManager).toBeUndefined()
    }
  }
})

test('browser describes its npm script semantics without claiming execution or Bun availability', () => {
  const browser = new BrowserLinuxExecution()
  const initial = browser.describeCapabilities()
  expect(initial.ready).toBe(false)
  expect(initial.toolchain.commandFacts).toMatchObject({ packageScript: 'npm run <name>', testScript: 'npm test', executionVerified: false })
  expect(initial.toolchain.commandFacts.testRunner).toBeUndefined()
  expect(JSON.stringify(initial.toolchain)).not.toContain('bun')
  browser.info = { node: '24.fixture', preparedTemplate: 'fixture-template' }
  expect(browser.describeCapabilities().toolchain).toMatchObject({ version: '24.fixture', preparedTemplate: 'fixture-template' })
  expect(describeToolchain({ kind: 'other', packageManager: 'npm' }).commandFacts).toBeUndefined()
})

test('returned command facts are independent across descriptions', () => {
  const toolchain = describeToolchain({ kind: 'bun' })
  toolchain.commandFacts.testRunner = 'bun run test'
  expect(describeToolchain({ kind: 'bun' }).commandFacts.testRunner).toBe('bun test')
})

test('advertised Bun runner works as scripts.test and propagates a failing assertion through the package command', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'askk-toolchain-'))
  try {
    const facts = describeToolchain({ kind: 'bun' }).commandFacts
    await writeFile(join(directory, 'package.json'), JSON.stringify({ scripts: { test: facts.testRunner } }))
    const execute = command => Bun.spawnSync([process.execPath, ...command.split(' ').slice(1)], { cwd: directory, timeout: 10000 })
    await writeFile(join(directory, 'sum.test.js'), 'import { expect, test } from "bun:test"; test("sum", () => expect(2 + 3).toBe(5));')
    expect(execute(facts.testRunner).exitCode).toBe(0)
    expect(execute(facts.packageScript.replace('<name>', 'test')).exitCode).toBe(0)
    await writeFile(join(directory, 'sum.test.js'), 'import { expect, test } from "bun:test"; test("sum", () => expect(2 + 3).toBe(6));')
    const failed = execute(facts.packageScript.replace('<name>', 'test'))
    expect(failed.exitCode).toBe(1)
    expect(failed.stderr.toString()).toContain('1 fail')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
