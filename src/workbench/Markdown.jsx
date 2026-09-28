import { Fragment } from 'react'

function inline(text) {
  return String(text).split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g).map((part, i) => {
    if (part.startsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>
    if (part.startsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(part)
    if (link) return <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a>
    return <Fragment key={i}>{part}</Fragment>
  })
}
export default function Markdown({ text = '' }) {
  const parts = String(text).split(/(```[\s\S]*?(?:```|$))/g)
  return <div className="markdown">{parts.map((part, index) => {
    if (part.startsWith('```')) {
      const first = part.indexOf('\n')
      return <pre key={index}><code>{first < 0 ? part.slice(3) : part.slice(first + 1).replace(/```$/, '')}</code></pre>
    }
    return part.split(/\n\s*\n/).filter(Boolean).map((block, i) => {
      if (/^#{1,6} /.test(block)) return <h3 key={`${index}-${i}`}>{inline(block.replace(/^#{1,6} /, ''))}</h3>
      const lines = block.split('\n')
      if (lines.every(line => /^[-*] /.test(line))) return <ul key={`${index}-${i}`}>{lines.map((line, n) => <li key={n}>{inline(line.slice(2))}</li>)}</ul>
      return <p key={`${index}-${i}`}>{inline(block)}</p>
    })
  })}</div>
}
