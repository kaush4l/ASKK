import { expect, test } from 'bun:test'
import { encodeDraftBackup, decodeDraftBackup, DRAFT_BACKUP_LIMITS } from '../src/core/draft-backup.js'
import { PACKAGE_LIMITS } from '../src/core/agent-package.js'

test('backup text is detached and escaped content round-trips losslessly', () => {
  const draft = { label: 'draft', files: [{ path: 'agent.md', content: '\u0000'.repeat(10000) + '😀\ud800\r\n' }] }
  const encoded = encodeDraftBackup(draft)
  expect(encoded.text.length).toBeGreaterThan(60000)
  expect(decodeDraftBackup(encoded.text)).toEqual(draft)
  draft.files[0].content = 'changed'
  expect(decodeDraftBackup(encoded.text).files[0].content).not.toBe('changed')
  expect(DRAFT_BACKUP_LIMITS.maxBytes).toBeGreaterThan(PACKAGE_LIMITS.maxExpandedBytes * 6)
})

test('backup bounds raw JSON before parsing and decoded UTF-8 file bytes before storage', () => {
  expect(() => decodeDraftBackup(' '.repeat(DRAFT_BACKUP_LIMITS.maxBytes + 1))).toThrow('byte limit')
  const oversized = { format: 'askk-agent-draft', version: 1, label: 'large', files: [{ path: 'agent.md', content: '😀'.repeat(PACKAGE_LIMITS.maxFileBytes / 4 + 1) }] }
  expect(() => decodeDraftBackup(JSON.stringify(oversized))).toThrow('byte')
  expect(() => decodeDraftBackup(JSON.stringify({ ...oversized, files: Array(257).fill({ path: 'agent.md', content: '' }) }))).toThrow('too many')
})
