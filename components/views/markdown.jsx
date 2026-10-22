"use client"

import * as React from "react"

import { mdBlocks } from "@/backend/live/markdown"
import { cn } from "@/lib/utils"

// A markdown document drawn as React elements from backend/live/markdown.js — never as HTML (an agent's document may
// carry text read from the web). Tables scroll inside their own box, so a phone never scrolls the page sideways.

function Inline({ parts }) {
  return parts.map((p, i) => {
    if (p.t === "b") return <strong key={i} className="text-foreground">{p.v}</strong>
    if (p.t === "i") return <em key={i}>{p.v}</em>
    if (p.t === "code") return <code key={i} className="rounded bg-muted/60 px-1 font-mono text-[0.92em]">{p.v}</code>
    if (p.t === "a")
      return (
        <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" className="break-all text-sky-700 underline underline-offset-2 dark:text-sky-400">
          {p.v}
        </a>
      )
    return <React.Fragment key={i}>{p.v}</React.Fragment>
  })
}

const HEADING = { 1: "text-base", 2: "text-[15px]", 3: "text-sm", 4: "text-sm", 5: "text-xs", 6: "text-xs" }

export function Markdown({ text, className, hideCode = [] }) {
  const blocks = React.useMemo(() => mdBlocks(text), [text])
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5 text-xs leading-5 break-words", className)}>
      {blocks.map((b, i) => {
        if (b.type === "h") {
          const Tag = `h${Math.min(6, b.level + 2)}`
          return (
            <Tag key={i} className={cn("mt-1 text-foreground", HEADING[b.level])}>
              <Inline parts={b.inline} />
            </Tag>
          )
        }
        if (b.type === "p") return <p key={i}><Inline parts={b.inline} /></p>
        if (b.type === "quote")
          return (
            <blockquote key={i} className="border-l-2 pl-2 text-muted-foreground">
              <Inline parts={b.inline} />
            </blockquote>
          )
        if (b.type === "hr") return <hr key={i} className="border-border" />
        if (b.type === "ul" || b.type === "ol") {
          const List = b.type
          return (
            <List key={i} className={cn("flex flex-col gap-0.5 pl-4", b.type === "ul" ? "list-disc" : "list-decimal")}>
              {b.items.map((it, j) => (
                <li key={j}>
                  <Inline parts={it} />
                </li>
              ))}
            </List>
          )
        }
        if (b.type === "code") {
          if (hideCode.includes(b.lang)) return null
          return (
            <pre key={i} className="max-h-64 overflow-auto rounded-md border px-2 py-1 font-mono text-[11px] leading-4 whitespace-pre-wrap">
              {b.lang ? <span className="block text-muted-foreground">{b.lang}</span> : null}
              {b.text}
            </pre>
          )
        }
        if (b.type === "table")
          return (
            <div key={i} className="max-w-full overflow-x-auto rounded-md border">
              <table className="w-full min-w-max border-collapse text-[11px]">
                <thead>
                  <tr className="border-b">
                    {b.head.map((c, j) => (
                      <th key={j} className="px-2 py-1 text-left font-normal text-muted-foreground">
                        <Inline parts={c} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r, j) => (
                    <tr key={j} className="border-b last:border-0">
                      {r.map((c, k) => (
                        <td key={k} className="px-2 py-1 align-top">
                          <Inline parts={c} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        return null
      })}
    </div>
  )
}
