"use client"

import * as React from "react"
import { Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// The parts the artifact views and the workflow viewer share: the owner's call hooks, the small line and button, the
// fold, the form field. A change to how an owner action looks or fails is made here once.

export const field = "w-full rounded-md border bg-background px-2 py-1.5 text-base md:text-sm"
export { hm as clock } from "@/backend/live/time"
export const errorText = (error) => error?.message ?? String(error)
// A form's submit: the page stays, `fn` runs.
export const submitted = (fn) => (e) => (e.preventDefault(), fn())

// A view's one owner call at a time: {busy, note: {ok, text}}. `send(id, method, extra)` is the view's call to the host;
// `say(result)` words what it did (else "done"); the refusal's message is the note. → true when it went through.
export function useOwnerCall(send, id, say = () => "done") {
  const [busy, setBusy] = React.useState(false)
  const [note, setNote] = React.useState(null)
  const call = async (method, extra, done) => {
    setBusy(true)
    setNote(null)
    try {
      setNote({ ok: true, text: say(await send(id, method, extra)) })
      done?.()
      return true
    } catch (error) {
      setNote({ ok: false, text: errorText(error) })
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, note, call }
}

// One async action at a time: {busy, error, setError, run}. `run(fn)` sets busy, clears the error, keeps a refusal's
// message as the error. → true when it went through.
export function useBusy() {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState(null)
  const run = async (fn) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      return true
    } catch (e) {
      setError(errorText(e))
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, setError, run }
}

// `fn` now and every `ms` while `on` (a list the page keeps fresh). `fn` should be stable (useCallback).
export function usePoll(fn, ms, on = true) {
  React.useEffect(() => {
    if (!on) return
    fn()
    const timer = setInterval(fn, ms)
    return () => clearInterval(timer)
  }, [fn, ms, on])
}

// Owner calls on the rows of a list, per key: {busy, done, error, tag} while and after `run()` — the host's refusal stays
// under its row and the button works again.
export function useKeyedCalls() {
  const [calls, setCalls] = React.useState({})
  const act = React.useCallback(async (key, run, tag = null) => {
    const set = (state) => setCalls((c) => ({ ...c, [key]: { busy: false, done: false, error: null, tag, ...state } }))
    set({ busy: true })
    try {
      await run()
      set({ done: true })
    } catch (error) {
      set({ error: errorText(error) })
    }
  }, [])
  return [calls, act]
}

const TONE = { muted: "text-muted-foreground", error: "text-red-700 dark:text-red-400", warn: "text-amber-700 dark:text-amber-400" }

// One small line of text; `tone` muted | error | warn; `as` the element (a div where a list or a fold sits inside).
export const Small = ({ as: Tag = "p", tone = "muted", className, ...props }) => <Tag className={cn("text-[11px] break-words", TONE[tone], className)} {...props} />

// What an owner call did: a line under the form, quiet = only a refusal.
export const CallNote = ({ note, quiet = false, className }) =>
  note && !(quiet && note.ok) ? <p className={cn("text-xs", note.ok ? "text-muted-foreground" : "text-destructive", className)}>{note.text}</p> : null

// A form or row button (small, 40 px on touch); the icon or words inside.
export const SmButton = ({ className, ...props }) => <Button size="sm" className={cn("pointer-coarse:h-10", className)} {...props} />

// <option>s from [{value, label}].
export const Options = ({ items }) => items.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)

// The small owner button on a card row (40 px on touch).
export const MiniButton = ({ className, ...props }) => <Button type="button" size="xs" className={cn("h-6 px-2 text-[11px] pointer-coarse:h-10 pointer-coarse:min-w-10", className)} {...props} />

// A delete that asks once more: Delete → "Delete for good?" / Cancel.
export function ConfirmDelete({ label = "Delete", confirm = "Delete for good?", busy, onConfirm, className }) {
  const [asking, setAsking] = React.useState(false)
  if (!asking)
    return <SmButton variant="ghost" className={cn("text-destructive", className)} disabled={busy} onClick={() => setAsking(true)}><Trash2Icon /> {label}</SmButton>
  return (
    <span className={cn("flex items-center gap-1", className)}>
      <SmButton variant="destructive" disabled={busy} onClick={async () => (await onConfirm()) !== false && setAsking(false)}><Trash2Icon /> {confirm}</SmButton>
      <SmButton variant="ghost" disabled={busy} onClick={() => setAsking(false)}>Cancel</SmButton>
    </span>
  )
}

// A <details> with the small summary every viewer fold uses (40 px to touch on a phone).
export const Fold = ({ title, children, className, ...props }) => (
  <details className={cn("min-w-0", className)} {...props}>
    <summary className="min-h-7 cursor-pointer text-[11px] text-muted-foreground pointer-coarse:min-h-10">{title}</summary>
    {children}
  </details>
)
