import { DRAFT_BACKUP_LIMITS } from '../core/draft-backup.js'

/** Check the declared size before allocating memory for a selected backup. */
export async function readDraftBackup(file, { isCurrent = () => true, maxBytes = DRAFT_BACKUP_LIMITS.maxBytes } = {}) {
  if (!file || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > maxBytes) throw new Error(`Choose a draft backup no larger than ${Math.ceil(maxBytes / 1048576)} MiB.`)
  if (!isCurrent()) throw new DOMException('Backup selection was cancelled.', 'AbortError')
  const bytes = await file.arrayBuffer()
  if (!isCurrent()) throw new DOMException('Backup selection was cancelled.', 'AbortError')
  if (bytes.byteLength !== file.size || bytes.byteLength > maxBytes) throw new Error('The backup changed while reading it. Select the file again.')
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw new Error('Choose a UTF-8 JSON draft backup.') }
}

/** Draft text remains authoritative, including invalid Markdown and YAML. */
export const draftChanged = (saved, draft) => Boolean(saved && draft && (saved.label !== draft.label || JSON.stringify(saved.files) !== JSON.stringify(draft.files)))
export function studioFilePath(raw, files, previous) {
  const path = String(raw || '').normalize('NFC')
  if (!path || path.length > 1024 || /[\\:%\u0000-\u001f\u007f]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..' || part.trim() !== part || part.endsWith('.'))) throw new Error('Use a relative path such as skills/research.md, without empty or parent folders.')
  if (path.toLowerCase() === 'askk.lock.json') throw new Error('The integrity lock is generated when you review the draft.')
  if (files.some(file => file.path !== previous && file.path.toLowerCase().normalize('NFC') === path.toLowerCase())) throw new Error('A file already uses that path.')
  return path
}
export function draftChanges(base, next) {
  const before = new Map((base || []).map(file => [file.path, file.content]))
  const after = new Map((next || []).map(file => [file.path, file.content]))
  return [...new Set([...before.keys(), ...after.keys()])].filter(path => before.get(path) !== after.get(path)).map(path => ({ path, base: before.get(path) || '', draft: after.get(path) || '', kind: !before.has(path) ? 'Added' : !after.has(path) ? 'Deleted' : 'Changed' }))
}
