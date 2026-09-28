'use client'
import { useId, useMemo } from 'react'
import { diffLines } from './diff.js'
import './diff.css'

const plural = (count, noun) => `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`

function Excerpt({ label, excerpt }) {
  return <section className="askk-diff-excerpt" aria-label={`${label} excerpt`}>
    <h3>{label}</h3>
    <div className="askk-diff-scroll" tabIndex={0} aria-label={`Scrollable ${label.toLowerCase()} excerpt`}>
      {excerpt.lines.length ? <table><caption className="askk-diff-sr">{label}: unclassified lines from the beginning of the file</caption><tbody>{excerpt.lines.map(line => <tr key={line.number}><th scope="row">{line.number}</th><td><code>{line.text || '\u00a0'}</code></td></tr>)}</tbody></table> : <p className="askk-diff-empty">Empty file</p>}
    </div>
    {excerpt.omittedChars > 0 && <p className="askk-diff-limit">{plural(excerpt.omittedChars, 'UTF-16 code unit')} omitted.{excerpt.partialLastLine && ' The last shown line is incomplete.'}</p>}
  </section>
}

/** Read-only base/draft comparison. It never updates a draft or advances its CAS revision. */
export default function DiffView({ path = 'File', base = '', draft = '', baseLabel = 'Saved base', draftLabel = 'Your draft' }) {
  const label = useId()
  const diff = useMemo(() => diffLines(base, draft), [base, draft])
  return <section className="askk-diff" aria-labelledby={label}>
    <header className="askk-diff-heading"><div><h2 id={label}>{path}</h2><p>{baseLabel} → {draftLabel}</p></div>{diff.mode === 'exact' && diff.changed && <div className="askk-diff-counts" aria-label={`${plural(diff.added, 'addition')}, ${plural(diff.removed, 'deletion')}`}><span className="askk-diff-plus">+{diff.added.toLocaleString()}</span><span className="askk-diff-minus">−{diff.removed.toLocaleString()}</span></div>}</header>
    {!diff.changed ? <div className="askk-diff-empty" role="status">No changes between {baseLabel.toLowerCase()} and {draftLabel.toLowerCase()}.</div>
      : diff.mode === 'fallback' ? <><p className="askk-diff-notice" role="status">This comparison exceeds the editor’s diff limit. These are separate excerpts, not a classified diff; exact addition and deletion counts are unavailable. Your full draft is unchanged.</p><div className="askk-diff-excerpts"><Excerpt label={baseLabel} excerpt={diff.base}/><Excerpt label={draftLabel} excerpt={diff.draft}/></div></>
      : <div className="askk-diff-scroll" tabIndex={0} aria-label={`Scrollable changes in ${path}`}><table className="askk-diff-lines"><caption className="askk-diff-sr">Line comparison. Minus marks deletions from {baseLabel.toLowerCase()}; plus marks additions to {draftLabel.toLowerCase()}. Unchanged ranges may be collapsed.</caption><thead><tr><th scope="col">Base</th><th scope="col">Draft</th><th scope="col"><span className="askk-diff-sr">Change</span></th><th scope="col">Content</th></tr></thead><tbody>{diff.visible.map((row, index) => row.kind === 'omitted'
        ? <tr key={`omitted-${index}`} className="askk-diff-omitted"><td colSpan={4}>{plural(row.count, 'unchanged line')} omitted</td></tr>
        : <tr key={`${row.kind}-${row.beforeLine}-${row.afterLine}`} className={`askk-diff-${row.kind}`}><td className="askk-diff-number">{row.beforeLine ?? ''}</td><td className="askk-diff-number">{row.afterLine ?? ''}</td><td className="askk-diff-mark"><span aria-hidden="true">{row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : ' '}</span><span className="askk-diff-sr">{row.kind === 'context' ? 'Unchanged' : row.kind === 'added' ? 'Added' : 'Deleted'}</span></td><td className="askk-diff-code"><code>{row.text || '\u00a0'}</code>{(row.kind !== 'context' || row.ending !== 'LF') && <span className="askk-diff-ending" aria-label={row.ending ? `${row.ending} line ending` : 'No final newline'}>{row.ending ?? 'No newline'}</span>}</td></tr>)}</tbody></table></div>}
  </section>
}
