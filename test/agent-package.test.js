import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { importAgentPackage, restoreAgentPackage, PACKAGE_LOCK } from '../src/core/agent-package.js'

const root = (extra = '', body = 'Help the owner.\n') => `---\npackage_id: example.research\npackage_version: 1.2.3\nid: lead\n${extra}---\n${body}`
const child = (id = 'researcher', extra = '') => `---\nid: ${id}\nname: Researcher\n${extra}---\nResearch the delegated question.\n`
const file = (path, content) => ({ path, content })
const basic = (extra = '') => [file('agent.md', root(extra))]
const sha = value => createHash('sha256').update(value).digest('hex')
const recordsFrom = async result => Promise.all((await result.source.list()).map(async row => file(row.path, await result.source.read(row.path, { as: 'bytes' }))))
const code = async (promise, expected) => { try { await promise; throw new Error('Import unexpectedly succeeded') } catch (error) { expect(error.code).toBe(expected); return error } }

test('service references are package-local IDs with strict shape and no self, missing or cyclic references', async () => {
  for (const services of ['[]', '{unknown: worker}', '{compaction: 4}', '{retrospective: ../worker}']) await code(importAgentPackage(basic(`services: ${services}\n`)), 'PACKAGE_SCHEMA')
  for (const services of ['{compaction: lead}', '{retrospective: absent}']) await code(importAgentPackage(basic(`services: ${services}\n`)), 'PACKAGE_REFERENCE')
  const cycle = await code(importAgentPackage([
    ...basic('services: {retrospective: second}\n'),
    file('two/agent.md', child('second', 'services: {retrospective: third}\n')),
    file('three/agent.md', child('third', 'services: {retrospective: lead}\n')),
  ]), 'PACKAGE_REFERENCE')
  expect(cycle.message).toContain('cyclic')
  const valid = await importAgentPackage([
    ...basic('services: {compaction: short_notes, retrospective: review}\n'),
    file('summary/agent.md', child('short_notes')),
    file('review/agent.md', child('review', 'tools: [memory]\n')),
  ])
  expect(valid.data.agents[0].settings.services).toEqual({ compaction: 'short_notes', retrospective: 'review' })
  expect(valid.data.agents[0].notes).toEqual([])
  expect((await restoreAgentPackage(JSON.parse(JSON.stringify(valid.data)))).data).toEqual(valid.data)
})

test('compaction services cannot request effects or further work even if bindings would deny them', async () => {
  for (const extra of ['tools: [web]\n', 'agents: [lead]\n', 'services: {retrospective: extra}\n', 'skills: true\n', 'skills: [guide.md]\n', 'require_verification: true\n']) {
    const error = await code(importAgentPackage([
      ...basic('services: {compaction: summary}\n'), file('summary/agent.md', child('summary', extra)),
      file('extra/agent.md', child('extra')), file('guide.md', '# A procedure'),
    ]), 'PACKAGE_REFERENCE')
    expect(error.message).toContain('compaction service')
  }
  const empty = await importAgentPackage([...basic('services: {compaction: summary}\n'), file('summary/agent.md', child('summary', 'tools: []\nagents: []\nservices: {}\nskills: false\nrequire_verification: false\n'))])
  expect(empty.data.agents.find(agent => agent.id === 'summary').settings.services).toEqual({})
})

test('minimal authored agent generates a complete immutable portable inventory without rewriting its bytes', async () => {
  const source = root('x_owner_note: Keep this unknown setting.\n', 'One  line.\nAnother line.\n\n  Indented text.  \n').replaceAll('\n', '\r\n')
  const result = await importAgentPackage([file('agent.md', source)])
  expect(result.data).toMatchObject({ schemaVersion: 1, packageId: 'example.research', packageVersion: '1.2.3', entryAgentId: 'lead' })
  expect(result.data.agents[0]).toMatchObject({ id: 'lead', path: 'agent.md', contractVersion: 2, responseFormat: 'json', settings: { x_owner_note: 'Keep this unknown setting.' } })
  expect(result.data.agents[0].body).toBe('One  line.\r\nAnother line.\r\n\r\n  Indented text.  \r\n')
  expect(result.data.agents[0].notes).toEqual(['Uninterpreted frontmatter preserved: x_owner_note'])
  expect(await result.source.read('agent.md')).toBe(source)
  expect(result.data.lock.files).toEqual([{ path: 'agent.md', bytes: Buffer.byteLength(source), sha256: sha(source) }])
  expect(result.data.revisionDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
  expect(result.data.lock.files.some(row => row.path === PACKAGE_LOCK)).toBe(false)
  expect((await result.source.list()).map(row => row.path)).toEqual(['agent.md', PACKAGE_LOCK])
  expect(Object.isFrozen(result.data.agents[0].settings)).toBe(true)
  expect(Object.isFrozen(result.data.files)).toBe(true)
  expect(JSON.parse(JSON.stringify(result.data))).toEqual(result.data)
})

test('Unicode text, empty assets and binary bytes survive export, JSON restoration and detached source reads', async () => {
  const binary = new Uint8Array([0, 255, 254, 128, 13, 10, 0, 42])
  const result = await importAgentPackage([...basic(), file('assets/empty.bin', new Uint8Array()), file('assets/picture.png', binary), file('notes/日本語.md', 'Café — 🌱\n')])
  const restored = await restoreAgentPackage(JSON.parse(JSON.stringify(result.data)))
  expect(restored.data).toEqual(result.data)
  expect(await restored.source.read('assets/picture.png', { as: 'bytes' })).toEqual(binary)
  expect(await restored.source.read('notes/日本語.md')).toBe('Café — 🌱\n')
  expect(result.data.lock.files.find(row => row.path === 'assets/empty.bin').sha256).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  expect(result.data.lock.files.find(row => row.path === 'notes/日本語.md').bytes).toBe(Buffer.byteLength('Café — 🌱\n'))
  const read = await result.source.read('assets/picture.png', { as: 'bytes' }); read[0] = 17
  expect((await result.source.read('assets/picture.png', { as: 'bytes' }))[0]).toBe(0)
  await code(result.source.read('assets/picture.png'), 'PACKAGE_TEXT')
})

test('caller mutation after import admission cannot change the revision being hashed', async () => {
  const bytes = new TextEncoder().encode(root()), asset = new Uint8Array([10, 20, 30])
  const records = [file('agent.md', bytes), file('assets/bytes.bin', asset)]
  const pending = importAgentPackage(records)
  bytes.fill(0); asset.fill(0); records[1].path = 'changed.bin'; records.push(file('extra.txt', 'late'))
  const result = await pending
  expect(await result.source.read('agent.md')).toBe(root())
  expect(await result.source.read('assets/bytes.bin', { as: 'bytes' })).toEqual(new Uint8Array([10, 20, 30]))
  expect(result.data.lock.files.map(row => row.path)).toEqual(['agent.md', 'assets/bytes.bin'])
})

test('revision is independent of input order, byte representation, or lock formatting', async () => {
  const records = [...basic(), file('assets/b.bin', new Uint8Array([1, 2])), file('assets/a.txt', 'A')]
  const first = await importAgentPackage(records)
  const second = await importAgentPackage([...records].reverse().map(row => ({ ...row, content: typeof row.content === 'string' ? new TextEncoder().encode(row.content) : row.content })))
  expect(first.data.revisionDigest).toBe(second.data.revisionDigest)
  const lockText = ` \n${JSON.stringify(first.data.lock, null, 4)}\n`
  const locked = await importAgentPackage([...records, file(PACKAGE_LOCK, lockText)])
  expect(locked.data.revisionDigest).toBe(first.data.revisionDigest)
  expect(await locked.source.read(PACKAGE_LOCK)).toBe(lockText)
  const changed = await importAgentPackage([...records.slice(0, -1), file('assets/a.txt', 'B')])
  expect(changed.data.revisionDigest).not.toBe(first.data.revisionDigest)
})

test('supplied lock rejects same-length byte corruption and unlisted files instead of regenerating', async () => {
  const result = await importAgentPackage([...basic(), file('assets/note.txt', 'first')])
  const records = await recordsFrom(result)
  await code(importAgentPackage(records.map(row => row.path === 'assets/note.txt' ? file(row.path, 'other') : row)), 'PACKAGE_LOCK')
  await code(importAgentPackage([...records, file('extra.txt', 'not inventoried')]), 'PACKAGE_LOCK')
  await code(importAgentPackage(records.filter(row => row.path !== 'assets/note.txt')), 'PACKAGE_LOCK')
  expect(await result.source.read('assets/note.txt')).toBe('first')
})

test('lock metadata, digest, schema and self references are verified, never trusted', async () => {
  const result = await importAgentPackage(basic())
  const variants = [
    { ...result.data.lock, packageId: 'other.package' },
    { ...result.data.lock, revisionDigest: `sha256:${'0'.repeat(64)}` },
    { ...result.data.lock, schemaVersion: 99 },
    { ...result.data.lock, files: [...result.data.lock.files, { path: PACKAGE_LOCK, bytes: 0, sha256: sha('') }] },
    { ...result.data.lock, unsupported: true },
  ]
  for (const lock of variants) await code(importAgentPackage([...basic(), file(PACKAGE_LOCK, JSON.stringify(lock))]), 'PACKAGE_LOCK')
  await code(importAgentPackage([...basic(), file(PACKAGE_LOCK, '{')]), 'PACKAGE_LOCK')
  await code(importAgentPackage([...basic(), file('agents/child/askk.lock.json', '{}')]), 'PACKAGE_LOCK')
  await code(importAgentPackage([...basic(), file('ASKK.LOCK.JSON', '{}')]), 'PACKAGE_LOCK')
})

test('unsafe paths fail before admission and normalized/case aliases cannot overwrite one another', async () => {
  for (const path of ['../escape', '/root.txt', './note', 'a/../note', 'a//b', 'a\\b', 'https://example.test/file', 'a/%2e%2e/b', 'a\0b', 'name.', ' dir/file', 'a/']) await code(importAgentPackage([...basic(), file(path, 'value')]), 'PACKAGE_PATH')
  for (const names of [['same.txt', 'same.txt'], ['Same.txt', 'same.txt'], ['café.txt', 'cafe\u0301.txt']]) await code(importAgentPackage([...basic(), ...names.map(name => file(name, 'value'))]), 'PACKAGE_DUPLICATE')
  const normalized = await importAgentPackage([...basic(), file('cafe\u0301.txt', 'value')])
  expect((await normalized.source.list()).some(row => row.path === 'café.txt')).toBe(true)
  expect(await normalized.source.read('cafe\u0301.txt')).toBe('value')
  await code(normalized.source.read('../agent.md'), 'PACKAGE_PATH')
})

test('bounded import includes generated lock storage and rejects unknown limits', async () => {
  await code(importAgentPackage([...basic(), file('x', 'x')], { limits: { maxFiles: 1 } }), 'PACKAGE_LIMIT')
  await code(importAgentPackage(basic(), { limits: { maxFileBytes: 1 } }), 'PACKAGE_LIMIT')
  await code(importAgentPackage(basic(), { limits: { maxExpandedBytes: Buffer.byteLength(root()) } }), 'PACKAGE_LIMIT')
  await code(importAgentPackage(basic(), { limits: { arbitrary: 1 } }), 'PACKAGE_LIMIT')
  await code(importAgentPackage(basic(), { limits: { maxFiles: 0 } }), 'PACKAGE_LIMIT')
  await code(importAgentPackage([...basic(), file('agents/second/agent.md', child())], { limits: { maxAgents: 1 } }), 'PACKAGE_LIMIT')
})

test('agent identities and delegation use authored IDs, not display names or nested folder names', async () => {
  const result = await importAgentPackage([
    file('agent.md', root('name: Same name\nagents: {research: worker_one, review: worker_two}\n')),
    file('agents/arbitrary/agent.md', child('worker_one').replace('Researcher', 'Same name')),
    file('agents/deep/nested/agent.md', child('worker_two').replace('Researcher', 'Same name')),
  ])
  expect(result.data.agents.map(agent => agent.id)).toEqual(['lead', 'worker_one', 'worker_two'])
  expect(result.data.agents[0].delegates).toEqual({ research: 'worker_one', review: 'worker_two' })
  expect(result.data.agents.every(agent => agent.settings.name === 'Same name')).toBe(true)
  const other = await importAgentPackage([file('agent.md', root().replace('example.research', 'other.research'))])
  expect(other.data.entryAgentId).toBe(result.data.entryAgentId)
  expect(other.data.packageId).not.toBe(result.data.packageId)
})

test('duplicate IDs, unknown aliases, self delegation and tool alias collisions are rejected', async () => {
  await code(importAgentPackage([...basic(), file('one/agent.md', child()), file('two/agent.md', child())]), 'PACKAGE_DUPLICATE')
  await code(importAgentPackage(basic('agents: [missing]\n')), 'PACKAGE_REFERENCE')
  await code(importAgentPackage(basic('agents: [lead]\n')), 'PACKAGE_REFERENCE')
  await code(importAgentPackage([...basic('tools: [research]\nagents: {research: child}\n'), file('agents/x/agent.md', child('child'))]), 'PACKAGE_REFERENCE')
  await code(importAgentPackage([...basic(), file('agents/x/agent.md', child('child', 'package_id: other\n'))]), 'PACKAGE_SCHEMA')
})

test('package-relative templates and skills are audited while each soul remains local to its definition', async () => {
  const template = 'System {{job}}\n<!-- user -->\n{{context}} {{response}}\n'
  const result = await importAgentPackage([
    ...basic('prompt_template: custom/layout.md\nskills: [skills/research.md]\nagents: [child]\n'),
    file('custom/layout.md', template), file('skills/research.md', '# Research\n'), file('soul.md', 'Root identity'),
    file('agents/x/agent.md', child('child', 'prompt_template: custom/layout.md\n')), file('agents/x/soul.md', 'Child identity'),
  ])
  expect(result.data.agents[0].references).toEqual(['custom/layout.md', 'skills/research.md', 'soul.md'])
  expect(result.data.agents[1].references).toEqual(['agents/x/soul.md', 'custom/layout.md'])
  expect(await result.source.read('custom/layout.md')).toBe(template)
  await code(importAgentPackage(basic('prompt_template: missing.md\n')), 'PACKAGE_REFERENCE')
  await code(importAgentPackage([...basic('prompt_template: prompt.md\n'), file('prompt.md', 'No separator')]), 'PACKAGE_REFERENCE')
  await code(importAgentPackage(basic(`prompt_template: ${PACKAGE_LOCK}\n`)), 'PACKAGE_LOCK')
  await code(importAgentPackage(basic('skills: [missing.md]\n')), 'PACKAGE_REFERENCE')
})

test('executable imported modules are rejected without running any package source', async () => {
  const marker = `package_was_executed_${crypto.randomUUID().replaceAll('-', '')}`
  for (const path of ['tools.js', 'agents/child/local.mjs', 'tools/compute.cjs', 'skills/scripts/run.py', 'assets/code.wasm']) await code(importAgentPackage([...basic(), file(path, `globalThis.${marker} = true`)]), 'PACKAGE_EXECUTABLE')
  expect(globalThis[marker]).toBeUndefined()
})

test('credential and transport settings fail explicitly without echoing their values', async () => {
  for (const config of ['api_key: hidden_value\n', 'apiKey: hidden_value\n', 'base_url: https://private.example\n', 'provider: hidden_value\n', 'via: bridge\n', 'context:\n  custom:\n    token: hidden_value\n']) {
    const error = await code(importAgentPackage(basic(config)), 'PACKAGE_SECRET_CONFIG')
    expect(error.message).not.toContain('hidden_value')
    expect(error.message).not.toContain('private.example')
  }
  for (const path of ['.env', '.env.local', 'nested/.npmrc', 'private.key', 'certificate.pem']) await code(importAgentPackage([...basic(), file(path, 'hidden_value')]), 'PACKAGE_SECRET_CONFIG')
  await code(importAgentPackage(basic('model: https://model.example/v1\n')), 'PACKAGE_SCHEMA')
})

test('known malformed settings and duplicate frontmatter cannot silently change agent semantics', async () => {
  for (const config of ['id: duplicate\n', 'agents: missing\n', 'tools: arbitrary\n', 'remembers: sometimes\n', 'max_steps: -1\n', 'response_format: invalid\n', 'response_format: toon\n', 'permissions: {some_tool: whatever}\n', '__proto__: {polluted: true}\n']) await code(importAgentPackage(basic(config)), 'PACKAGE_SCHEMA')
  await code(importAgentPackage([file('agent.md', 'No frontmatter')]), 'PACKAGE_SCHEMA')
  await code(importAgentPackage([file('agent.md', root().replace('package_version: 1.2.3', 'package_version: latest'))]), 'PACKAGE_SCHEMA')
  expect({}.polluted).toBeUndefined()
  const legacy = await importAgentPackage(basic('contract_version: 1\nresponse_format: toon\nsession: task\ncontext: {time: {zone: UTC}}\npermissions: {read: allow}\n'))
  expect(legacy.data.agents[0]).toMatchObject({ contractVersion: 1, responseFormat: 'toon', settings: { context: { time: { zone: 'UTC' } } } })
})

test('unexpected indentation and duplicate nested keys cannot discard or replace authored permissions', async () => {
  for (const config of [
    'description: valid\n  stray: value\ntools: [read]\n',
    'permissions: {read: ask, read: allow}\n',
    'permissions:\n  read: ask\n  read: allow\n',
    'context:\n  time: {zone: UTC, zone: Pacific/Honolulu}\n',
    'tools: [read\n',
    'tools: [read,,write]\n',
    'context:\n  time:\n    zone: UTC\n   stray: value\n',
    'description: &anchor trusted\n',
  ]) await code(importAgentPackage(basic(config)), 'PACKAGE_SCHEMA')
  const good = await importAgentPackage(basic('tools:\n- read\n- write\ncontext:\n  time:\n    zone: UTC\npermissions:\n  read: ask\n  write: deny\nx_rows:\n  - label: first\n    nested:\n      thing: yes\n  - label: second\n'))
  expect(good.data.agents[0].settings).toMatchObject({ tools: ['read', 'write'], context: { time: { zone: 'UTC' } }, permissions: { read: 'ask', write: 'deny' }, x_rows: [{ label: 'first', nested: { thing: true } }, { label: 'second' }] })
  const prose = await importAgentPackage(basic('description: Help the owner\'s team. # a comment\nname: "Desk #1"\nmodel: local/qwen\n'))
  expect(prose.data.agents[0].settings).toMatchObject({ description: "Help the owner's team.", name: 'Desk #1', model: 'local/qwen' })
})

test('larger binary storage uses bounded flat base64 validation and preserves every byte', async () => {
  const asset = new Uint8Array(128 * 1024)
  for (let i = 0; i < asset.length; i++) asset[i] = i % 251
  const imported = await importAgentPackage([...basic(), file('assets/data.bin', asset)])
  const restored = await restoreAgentPackage(JSON.parse(JSON.stringify(imported.data)))
  expect(await restored.source.read('assets/data.bin', { as: 'bytes' })).toEqual(asset)
  expect(restored.data.revisionDigest).toBe(imported.data.revisionDigest)
})

test('stored data is rederived from exact locked bytes and tampered metadata cannot replace instructions', async () => {
  const result = await importAgentPackage(basic())
  const metadata = JSON.parse(JSON.stringify(result.data)); metadata.agents[0].body = 'Modified instructions'
  await code(restoreAgentPackage(metadata), 'PACKAGE_DATA')
  const changed = JSON.parse(JSON.stringify(result.data)); changed.files.find(row => row.path === 'agent.md').content = Buffer.from(root('', 'Modified instructions')).toString('base64')
  await code(restoreAgentPackage(changed), 'PACKAGE_LOCK')
  const invalid = JSON.parse(JSON.stringify(result.data)); invalid.files[0].content = 'nonbase64'
  await code(restoreAgentPackage(invalid), 'PACKAGE_DATA')
  await code(restoreAgentPackage(result.data, { limits: { maxExpandedBytes: 1 } }), 'PACKAGE_LIMIT')
})

test('fatal UTF-8 validation protects definitions without rejecting binary assets', async () => {
  await code(importAgentPackage([file('agent.md', new Uint8Array([255, 254]))]), 'PACKAGE_TEXT')
  await code(importAgentPackage([...basic('prompt_template: prompt.md\n'), file('prompt.md', new Uint8Array([255]))]), 'PACKAGE_TEXT')
  await code(importAgentPackage([{ path: 'agent.md', content: root(), executable: true }]), 'PACKAGE_SCHEMA')
  await code(importAgentPackage([file('agent.md', new ArrayBuffer(2))]), 'PACKAGE_SCHEMA')
})
