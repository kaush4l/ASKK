// Markdown as plain data for a React renderer (components/views/markdown.jsx) — never HTML: an agent's document can
// carry text read from the web, and this UI may POST to the host API, so nothing in it is ever parsed as markup.
// Blocks: headings, paragraphs, lists, tables, fenced code, quotes, rules. Inline: **bold**, *italic*, `code`,
// [links](https://…) — http(s) only, anything else stays text. Pure; tested in markdown.test.js.
//
//   mdBlocks(text) → [{type: "h", level, inline} | {type: "p", inline} | {type: "ul" | "ol", items: [inline]} |
//                     {type: "table", head: [inline], rows: [[inline]]} | {type: "code", lang, text} |
//                     {type: "quote", inline} | {type: "hr"}]
//   mdInline(s)    → [{t: "text" | "b" | "i" | "code", v} | {t: "a", v, href}]

export const safeHref = (url) => {
  const u = String(url ?? "").trim()
  return /^https?:\/\/[^\s<>"']+$/i.test(u) ? u : null
}

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\*[^*\s][^*\n]*\*|(?<![\w])_[^_\s][^_\n]*_(?![\w]))|(\[[^\]\n]+\]\([^)\s]+\))/g

export function mdInline(s) {
  const text = String(s ?? "")
  const out = []
  let at = 0
  const push = (t, v, extra) => {
    if (!v) return
    const last = out.at(-1)
    if (t === "text" && last?.t === "text") last.v += v
    else out.push({ t, v, ...extra })
  }
  for (const m of text.matchAll(INLINE)) {
    push("text", text.slice(at, m.index))
    const [all, code, bold, italic, link] = m
    if (code) push("code", code.slice(1, -1))
    else if (bold) push("b", bold.slice(2, -2))
    else if (italic) push("i", italic.slice(1, -1))
    else if (link) {
      const l = link.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)
      const href = safeHref(l?.[2])
      if (href) push("a", l[1], { href })
      else push("text", all)
    }
    at = m.index + all.length
  }
  push("text", text.slice(at))
  return out
}

const cells = (line) => {
  const t = line.trim().replace(/^\|/, "").replace(/\|$/, "")
  return t.split("|").map((c) => c.trim())
}
const isRule = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)

export function mdBlocks(text, { max = 600 } = {}) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n")
  const blocks = []
  let i = 0
  while (i < lines.length && blocks.length < max) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    const fence = line.match(/^\s*(```|~~~)\s*([\w-]*)/)
    if (fence) {
      const body = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith(fence[1])) body.push(lines[i++])
      i++
      blocks.push({ type: "code", lang: fence[2] || "", text: body.join("\n") })
      continue
    }
    const h = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/)
    if (h) {
      blocks.push({ type: "h", level: h[1].length, inline: mdInline(h[2]) })
      i++
      continue
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: "hr" })
      i++
      continue
    }
    if (line.includes("|") && i + 1 < lines.length && isRule(lines[i + 1])) {
      const head = cells(line).map(mdInline)
      i += 2
      const rows = []
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]).map(mdInline))
      blocks.push({ type: "table", head, rows })
      continue
    }
    const item = (l) => l.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/)
    if (item(line)) {
      const ordered = !!item(line)[2]
      const items = []
      while (i < lines.length && item(lines[i]) && !!item(lines[i])[2] === ordered) items.push(mdInline(item(lines[i++])[3]))
      blocks.push({ type: ordered ? "ol" : "ul", items })
      continue
    }
    if (/^\s*>/.test(line)) {
      const body = []
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""))
      blocks.push({ type: "quote", inline: mdInline(body.join(" ")) })
      continue
    }
    const para = []
    while (i < lines.length && lines[i].trim() && !/^\s*(```|~~~|#{1,6}\s|>)/.test(lines[i]) && !item(lines[i]) && !(lines[i].includes("|") && i + 1 < lines.length && isRule(lines[i + 1]))) para.push(lines[i++].trim())
    if (!para.length) para.push(lines[i++].trim()) // a line no rule above took
    blocks.push({ type: "p", inline: mdInline(para.join(" ")) })
  }
  return blocks
}
