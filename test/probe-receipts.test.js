import { expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createProbeIdentity, saveProbeReceipt, saveProbeSubmission } from '../scripts/probe-receipts.js'

test('concurrent repeated probe submissions retain independent exact receipts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'askk-probe-receipts-'))
  try {
    const receipts = [{ ok: true }, { ok: false, errors: ['failed'] }]
    const paths = await Promise.all(receipts.map(receipt => saveProbeReceipt(directory, 'safari-isolated', receipt, { fixture: 'frozen' })))
    expect(new Set(paths).size).toBe(2)
    for (const [index, path] of paths.entries()) {
      const payload = await readFile(join(path, 'receipt.json'))
      expect(payload.toString()).toBe(JSON.stringify(receipts[index], null, 2) + '\n')
      const provenance = JSON.parse(await readFile(join(path, 'provenance.json'), 'utf8'))
      expect(provenance.fixture).toBe('frozen')
      expect(provenance.receipt).toEqual({ bytes: payload.length, sha256: createHash('sha256').update(payload).digest('hex') })
      expect((await stat(path)).mode & 0o777).toBe(0o700)
      expect((await stat(join(path, 'receipt.json'))).mode & 0o777).toBe(0o600)
    }
    await expect(saveProbeReceipt(directory, '../escape', {})).rejects.toThrow('Invalid probe')
    expect((await readdir(directory)).length).toBe(2)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('server identity changes even when the frozen snapshot is identical', () => {
  const snapshot = { profile: 'fixture', moduleSha256: 'same-module', fixturesSha256: 'same-fixtures' }
  const first = createProbeIdentity(snapshot), second = createProbeIdentity(snapshot)
  expect(first.id).not.toBe(second.id)
  expect(first.snapshotSha256).toBe(second.snapshotSha256)
  expect(first.snapshotSha256).not.toBe(createProbeIdentity({ ...snapshot, moduleSha256: 'changed' }).snapshotSha256)
  expect(Object.isFrozen(first)).toBe(true)
})

test('stale or missing page identities reject before creating any receipt directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'askk-probe-receipts-'))
  try {
    const destination = join(directory, 'not-created')
    const snapshot = { profile: 'frozen' }, identity = createProbeIdentity(snapshot)
    const staleIdentity = createProbeIdentity(snapshot)
    for (const probe of [undefined, staleIdentity, { ...identity, snapshotSha256: 'wrong-snapshot' }, { id: identity.id }]) {
      try {
        await saveProbeSubmission(destination, 'chrome-isolated', { probe, receipt: { ok: true } }, snapshot, identity)
        throw new Error('Unexpected receipt accepted')
      } catch (error) {
        expect(error.status).toBe(409)
        expect(error.code).toBe('PROBE_SESSION_MISMATCH')
      }
    }
    expect(await readdir(directory)).toEqual([])
    await expect(saveProbeSubmission(destination, 'chrome-isolated', { probe: identity, receipt: [] }, snapshot, identity)).rejects.toMatchObject({ status: 400 })
    expect(await readdir(directory)).toEqual([])
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('matching submissions retain exact receipts and bounded provenance independently', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'askk-probe-receipts-'))
  try {
    const snapshot = { profile: 'isolated-srcdoc', moduleSha256: 'frozen-module' }
    const identity = createProbeIdentity(snapshot)
    const receipt = { userAgent: 'Synthetic test agent', results: [{ passed: false, detail: 'retained failure' }] }
    const paths = await Promise.all([1, 2].map(() => saveProbeSubmission(directory, 'unknown-isolated', { probe: identity, receipt }, snapshot, identity)))
    expect(new Set(paths).size).toBe(2)
    for (const path of paths) {
      expect(JSON.parse(await readFile(join(path, 'receipt.json'), 'utf8'))).toEqual(receipt)
      const saved = JSON.parse(await readFile(join(path, 'provenance.json'), 'utf8'))
      expect(saved.moduleSha256).toBe(snapshot.moduleSha256)
      expect(saved.submission.identity).toEqual(identity)
      expect(saved.submission.matched).toBe(true)
      expect(saved.submission.scope).toContain('not proof of executed browser bytes')
      expect((await stat(join(path, 'provenance.json'))).mode & 0o777).toBe(0o600)
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
})
