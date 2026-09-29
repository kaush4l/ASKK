/** Lossless text-only draft backups. This format carries authored files only;
 * it never carries installation bindings, provider settings or runtime state. */
import { PACKAGE_LIMITS, PACKAGE_LOCK } from './agent-package.js'

const encoder = new TextEncoder()
const fail = (code, message) => { throw Object.assign(new Error(message), { code }) }
const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)))
const only = (value, keys) => Object.keys(value).every(key => keys.includes(key))

export const draftLabel = value => {
  if (typeof value !== 'string' || value.length > 200) fail('DRAFT_LABEL', 'A draft name must be text of at most 200 characters.')
  return value
}
export function draftFiles(files) {
  if (!Array.isArray(files) || files.length > PACKAGE_LIMITS.maxFiles) fail('DRAFT_LIMIT', 'The draft has too many files.')
  let bytes = 0
  const paths = new Set()
  return Array.from(files, file => {
    if (!plain(file) || !only(file, ['path', 'content'])) fail('DRAFT_TEXT', 'Draft files must be plain path and text records.')
    const path = file?.path
    if (typeof path !== 'string' || !path || path.length > 1024 || path !== path.normalize('NFC') || /[\\:%\u0000-\u001f\u007f]/.test(path) || path.split('/').length > 32 || path.split('/').some(part => !part || part === '.' || part === '..' || part.trim() !== part || part.endsWith('.'))) fail('DRAFT_PATH', 'Draft files require safe relative paths.')
    const alias = path.toLowerCase()
    if (paths.has(alias)) fail('DRAFT_PATH', `Duplicate draft path: ${path}`)
    paths.add(alias)
    if (alias === PACKAGE_LOCK || alias.endsWith(`/${PACKAGE_LOCK}`)) fail('DRAFT_LOCK', 'askk.lock.json is generated when validating a draft; remove it from editable files.')
    if (typeof file.content !== 'string') fail('DRAFT_TEXT', `Draft file ${path} must contain text.`)
    if (file.content.length > PACKAGE_LIMITS.maxFileBytes) fail('DRAFT_LIMIT', `Draft file ${path} exceeds the byte limit.`)
    const size = encoder.encode(file.content).length
    if (size > PACKAGE_LIMITS.maxFileBytes || (bytes += size) > PACKAGE_LIMITS.maxExpandedBytes) fail('DRAFT_LIMIT', 'Draft file bytes exceed the package limit.')
    return { path, content: file.content }
  })
}

// JSON can expand one authored control character to six ASCII bytes. Include
// bounded path/label overhead so every accepted draft can round-trip losslessly.
export const DRAFT_BACKUP_LIMITS = Object.freeze({ maxBytes: PACKAGE_LIMITS.maxExpandedBytes * 6 + 2 * 1024 * 1024 })
export function encodeDraftBackup({ label, files }) {
  const text = JSON.stringify({ format: 'askk-agent-draft', version: 1, label: draftLabel(label), files: draftFiles(files) }, null, 2) + '\n'
  return { filename: 'agent-draft.askk-draft.json', mimeType: 'application/json', text }
}
export function decodeDraftBackup(text) {
  if (typeof text !== 'string') fail('DRAFT_BACKUP', 'Choose a text JSON draft backup.')
  if (text.length > DRAFT_BACKUP_LIMITS.maxBytes || encoder.encode(text).length > DRAFT_BACKUP_LIMITS.maxBytes) fail('DRAFT_LIMIT', 'The draft backup exceeds its byte limit.')
  let data
  try { data = JSON.parse(text) } catch { fail('DRAFT_BACKUP', 'The draft backup is not valid JSON.') }
  if (!plain(data) || !only(data, ['format', 'version', 'label', 'files']) || data.format !== 'askk-agent-draft' || data.version !== 1) fail('DRAFT_BACKUP', 'Expected an ASKK draft backup with format version 1 and no extra fields.')
  return { label: draftLabel(data.label), files: draftFiles(data.files) }
}
