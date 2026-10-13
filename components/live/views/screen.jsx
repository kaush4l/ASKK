"use client"

import * as React from "react"
import { TerminalIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"

function useStickToBottom(dep) {
  const ref = React.useRef(null)
  React.useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [dep])
  return ref
}

export function Screen({ title, status, children, footer, text, live }) {
  const scroller = useStickToBottom(text)
  return (
    <section aria-label={typeof title === "string" ? title : "Terminal"} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-black text-zinc-100">
      <header className="flex min-w-0 flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2 text-xs text-zinc-400">
        <TerminalIcon className="size-3.5" />
        {title}
        <span className="ml-auto flex items-center gap-1.5">{status}</span>
      </header>
      <div ref={scroller} className="min-h-32 flex-1 overflow-auto p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-words">
        {children}
        {text}
        {live && <span className="inline-block h-3.5 w-2 translate-y-0.5 animate-pulse bg-zinc-300" aria-hidden />}
      </div>
      {footer && <footer className="border-t border-zinc-800 px-3 py-1.5 font-mono text-[11px] break-all text-zinc-500">{footer}</footer>}
    </section>
  )
}

// "$ command" as the first line of a run.
export function Prompt({ command }) {
  return (
    <>
      <span className="text-emerald-400">$ </span>
      <span>{command}</span>
      {"\n"}
    </>
  )
}

export const exitBadge = (exit) => (exit == null ? null : <Badge variant={String(exit) === "0" ? "secondary" : "destructive"}>exit {exit}</Badge>)
