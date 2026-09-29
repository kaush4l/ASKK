import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

/** Bind a page and its asset URLs to one frozen server snapshot. */
export function createProbeIdentity(provenance) {
  return Object.freeze({ id: randomUUID(), snapshotSha256: createHash('sha256').update(JSON.stringify(provenance)).digest('hex') })
}

/** This matches a page's reported identity; it does not attest executed bytes. */
export async function saveProbeSubmission(directory, label, submission, provenance, identity) {
  if (!submission?.probe || submission.probe.id !== identity.id || submission.probe.snapshotSha256 !== identity.snapshotSha256) {
    throw Object.assign(new Error('Fixture server changed or submission identity is missing. Reload the fixture before running it again.'), { code: 'PROBE_SESSION_MISMATCH', status: 409 })
  }
  if (!submission.receipt || typeof submission.receipt !== 'object' || Array.isArray(submission.receipt)) throw Object.assign(new Error('A probe receipt object is required'), { status: 400 })
  return saveProbeReceipt(directory, label, submission.receipt, {
    ...provenance,
    submission: { identity, matched: true, scope: 'Matching page-reported identity and server snapshot; not proof of executed browser bytes.' },
  })
}

/** Keep every probe invocation, including failures and concurrent submissions. */
export async function saveProbeReceipt(directory, label, receipt, provenance = {}) {
  if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid probe receipt label')
  const payload = JSON.stringify(receipt, null, 2) + '\n'
  const receivedAt = new Date().toISOString()
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const destination = await mkdtemp(join(directory, `${label}-${receivedAt.replace(/[:.]/g, '-')}-`))
  await writeFile(join(destination, 'receipt.json'), payload, { flag: 'wx', mode: 0o600 })
  await writeFile(join(destination, 'provenance.json'), JSON.stringify({
    ...provenance, receivedAt,
    receipt: { bytes: Buffer.byteLength(payload), sha256: createHash('sha256').update(payload).digest('hex') },
  }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  return destination
}
