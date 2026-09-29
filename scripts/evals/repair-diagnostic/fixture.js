import { createHash } from 'node:crypto'

export const SOURCE_RECEIPT = 'docs/rewrite/evidence/native-run-rmulp44n21.json'
export const SOURCE_RUN = 'rmulp44n21'
export const SOURCE_FILES = ['app/page.js', 'app/globals.css', 'app/layout.js', 'package.json', 'next.config.js']
export const sha256 = value => createHash('sha256').update(value).digest('hex')

/** Recover only complete recorded reads. Never reconstruct code from model prose. */
export function extractFixture(bytes) {
  const data = JSON.parse(String(bytes))
  const run = data.runs?.find(row => row.id === SOURCE_RUN && row.agent === 'main')
  if (!run) throw new Error('Expected historical main run is absent')
  const files = new Map()
  for (const prompt of run.prompts ?? []) for (const message of prompt.snapshot.messages) for (const line of message.content.split('\n')) {
    const match = line.match(/(?:^|observation: )workspace_read\((\{.*?\})\) -> (\{.*\})$/)
    if (!match) continue
    let args, receipt
    try { args = JSON.parse(match[1]); receipt = JSON.parse(match[2]) } catch { continue }
    if (!SOURCE_FILES.includes(args.path) || receipt.path !== args.path || typeof receipt.content !== 'string') continue
    const hash = sha256(receipt.content)
    if (receipt.rev !== hash) throw new Error(`Recorded content/revision mismatch: ${args.path}`)
    if (files.has(args.path) && files.get(args.path).rev !== hash) throw new Error(`Source changed inside the historical run: ${args.path}`)
    files.set(args.path, { path: args.path, content: receipt.content, rev: hash, size: Buffer.byteLength(receipt.content) })
  }
  if (SOURCE_FILES.some(path => !files.has(path))) throw new Error('Complete recorded source files are missing')
  const checks = (run.log ?? []).filter(event => event.kind === 'observation' && event.name.startsWith('workspace_check'))
  const original = JSON.parse(checks[0]?.value ?? 'null')
  if (original?.ok !== false || original.results?.length !== 15 || original.assertions?.[15]?.value !== 'Buy groceries') throw new Error('Historical failed check differs from the audited counterexample')
  return {
    version: 1,
    provenance: { receipt: SOURCE_RECEIPT, publicReceiptSha256: sha256(bytes), originalPrivateReceiptSha256: data._redaction?.originalSha256 ?? data._redaction?.rawSha256 ?? null, run: SOURCE_RUN, notice: 'Source recovered from complete historical read receipts. Public receipt text has recorded home-path redactions.' },
    files: SOURCE_FILES.map(path => files.get(path)),
    originalFailure: original,
    originalFailureSha256: sha256(JSON.stringify(original)),
    sourceFingerprint: sha256(JSON.stringify(SOURCE_FILES.map(path => [path, files.get(path).rev]))),
    auditAnchor: { failedIndex: 15, action: 'assertText', selector: '.task-title', expected: 'Buy groceries', filter: 'Active', expectedActualFromSource: 'Write report', actualTextProvenance: 'Source-derived audit expectation; the historical inspector did not capture actual text. A new baseline inspection must reproduce it.' },
  }
}
