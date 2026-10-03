"use client"

// Temporary debug view: the exact prompt text sent to the LLM. "Sent" shows
// the prompt of each LLM call (kept on its assistant message); "Next" renders
// what the next request would send now, with the composer text as request.

import * as React from "react"
import { CheckIcon, CopyIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const PREVIEW_DELAY_MS = 300

function useNextPrompt(engine, messages, input, enabled) {
  const [prompt, setPrompt] = React.useState("")
  const [error, setError] = React.useState(null)
  React.useEffect(() => {
    if (!enabled || !engine) return
    let current = true
    const timer = setTimeout(() => {
      engine.preview(input).then(
        (text) => current && (setPrompt(text), setError(null)),
        (e) => current && setError(e.message)
      )
    }, PREVIEW_DELAY_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [engine, messages, input, enabled])
  return { prompt, error }
}

function CopyButton({ text }) {
  const [copied, setCopied] = React.useState(false)
  async function copy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <Button variant="ghost" size="icon-sm" onClick={copy} disabled={!text} aria-label="Copy prompt" className="pointer-coarse:size-10">
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  )
}

export function PromptPanel({ engine, messages, input, onClose, className }) {
  const sent = React.useMemo(() => messages.filter((m) => m.role === "assistant" && m.prompt), [messages])
  const [tab, setTab] = React.useState("sent")
  const [pick, setPick] = React.useState(null) // message id; null = latest
  const next = useNextPrompt(engine, messages, input, tab === "next")

  const selected = sent.find((m) => m.id === pick) ?? sent.at(-1)
  const text = tab === "next" ? next.prompt : (selected?.prompt ?? "")
  const index = selected ? sent.indexOf(selected) : -1

  return (
    <aside aria-label="Prompt sent to the LLM" className={cn("flex min-h-0 min-w-0 flex-col", className)}>
      <header className="flex flex-wrap items-center gap-1 border-b p-2">
        <div role="tablist" className="flex rounded-md border p-0.5 text-xs">
          {[
            ["sent", "Sent"],
            ["next", "Next"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className="rounded px-2 py-1 text-muted-foreground aria-selected:bg-muted aria-selected:text-foreground pointer-coarse:min-h-9"
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "sent" && sent.length > 0 && (
          <select
            value={selected?.id ?? ""}
            onChange={(e) => setPick(e.target.value === sent.at(-1).id ? null : e.target.value)}
            aria-label="LLM call"
            className="h-8 min-w-0 rounded-md border bg-background px-2 text-base md:text-xs pointer-coarse:h-10"
          >
            {sent.map((m, i) => (
              <option key={m.id} value={m.id}>
                Call {i + 1}
                {m.step ? ` · step ${m.step}` : ""}
                {i === sent.length - 1 ? " (latest)" : ""}
              </option>
            ))}
          </select>
        )}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {text.length.toLocaleString()} chars · ~{Math.ceil(text.length / 4).toLocaleString()} tok
        </span>
        <CopyButton text={text} />
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close prompt panel" className="pointer-coarse:size-10">
          <XIcon />
        </Button>
      </header>
      {tab === "sent" && index >= 0 && sent.length > 1 && (
        <p className="border-b px-2 py-1 text-xs text-muted-foreground">
          Call {index + 1} of {sent.length} in this conversation
        </p>
      )}
      {tab === "next" && next.error && <p className="border-b p-2 text-xs text-destructive">{next.error}</p>}
      {text ? (
        <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
          {text}
        </pre>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">
          {tab === "sent" ? "Nothing sent yet in this conversation. Open Next to see what the first request will send." : "Rendering…"}
        </p>
      )}
    </aside>
  )
}
