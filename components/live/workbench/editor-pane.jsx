"use client"

import * as React from "react"
import { AppWindowIcon, FileTextIcon, XIcon } from "lucide-react"

import { changedLines, diffCut, diffRows, fileLines } from "@/backend/live/workbench"
import { workspace } from "@/backend/live/workspace"
import { clock, Empty, ShowSwitch } from "@/components/live/workbench/pane"
import { useStripScroll } from "@/hooks/use-strip-scroll"
import { LIMITS } from "@/lib/config"
import { cn } from "@/lib/utils"

const MAX_LINES = LIMITS.ui.workbench.fileLines

// The center pane: the tab strip (the one Preview tab, then open and modified files, newest first) over the open tab — a
// file's text, or the one preview pane (`preview`: components/live/workbench/preview-pane.jsx, 2026-10-17 owner: "There
// will be need for only one preview pane").
export function EditorPane({ tabs, tab, onPick, onClose, live, empty, preview = null }) {
  return (
    <section aria-label="Editor" className="flex min-h-0 flex-1 flex-col">
      <TabStrip tabs={tabs} active={tab?.id} onPick={onPick} onClose={onClose} />
      {!tab && <Empty>{empty}</Empty>}
      {tab?.kind === "file" && <FileView key={tab.path} tab={tab} live={live} />}
      {tab?.kind === "preview" && preview}
    </section>
  )
}

// One row of tabs; it scrolls sideways inside itself, never the page. A modified file has a dot; the Preview tab counts
// the owner's open questions.
function TabStrip({ tabs, active, onPick, onClose }) {
  const [stripRef, activeRef] = useStripScroll(active)
  if (!tabs.length) return null
  return (
    <div ref={stripRef} role="tablist" aria-label="Open files and the preview" className="relative flex min-w-0 shrink-0 overflow-x-auto border-b [scrollbar-width:thin]">
      {tabs.map((t) => (
        <div
          key={t.id}
          ref={t.id === active ? activeRef : undefined}
          className={cn("group flex shrink-0 items-center border-r border-b-2", t.id === active ? "border-b-primary text-foreground" : "border-b-transparent text-muted-foreground hover:text-foreground")}
        >
          <button
            type="button"
            role="tab"
            aria-selected={t.id === active}
            onClick={() => onPick(t)}
            title={t.kind === "file" ? t.path : `The preview: the app's pages and the agents' visuals (${t.items ?? 0})`}
            className={cn("flex min-h-9 max-w-56 items-center gap-1.5 pl-2.5 text-xs pointer-coarse:min-h-10", t.kind === "file" ? "pr-1" : "pr-2.5")}
          >
            {t.kind === "preview" ? <AppWindowIcon className="size-3.5 shrink-0" aria-hidden /> : <FileTextIcon className="size-3.5 shrink-0" aria-hidden />}
            <span className="truncate">{t.name}</span>
            {t.kind === "file" && t.modified && <span className="size-1.5 shrink-0 rounded-full bg-amber-500" aria-label="modified" />}
            {t.kind === "preview" && t.open > 0 && (
              <span className="shrink-0 rounded-full border border-amber-500/60 px-1 text-[10px] leading-4 text-amber-700 tabular-nums dark:text-amber-300" aria-label={`${t.open} open question${t.open === 1 ? "" : "s"}`}>
                {t.open}
              </span>
            )}
          </button>
          {t.kind === "file" && (
            <button
              type="button"
              onClick={() => onClose(t)}
              aria-label={`Close ${t.name}`}
              className="mr-1 flex size-6 items-center justify-center rounded-sm opacity-60 hover:bg-accent hover:opacity-100 pointer-coarse:size-10"
            >
              <XIcon className="size-3" />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// fs/read of the file; read again when the twin records a newer change or fs/watch reports this path.
function useFileText(path, version) {
  const [file, setFile] = React.useState({ loading: true })
  React.useEffect(() => {
    let alive = true
    setFile((f) => ({ ...f, loading: true }))
    workspace()
      .then((ws) => (ws ? ws.read(path) : Promise.reject(new Error("No desk server answers here."))))
      .then((r) => alive && setFile({ ...r, loading: false, error: null }))
      .catch((e) => alive && setFile({ loading: false, error: e.message }))
    return () => {
      alive = false
    }
  }, [path, version])
  return file
}

// A file tab: who opened or changed it, then its text with line numbers and the lines the last change added
// highlighted ("full"), or that change's diff ("diff").
function FileView({ tab, live }) {
  const change = tab.modified
  const [bump, setBump] = React.useState(0)
  React.useEffect(() => {
    if (live?.changed?.includes(tab.path)) setBump(live.version)
  }, [live?.version, live?.changed, tab.path])
  const file = useFileText(tab.path, `${change?.at ?? ""}|${bump}`)
  const [mode, setMode] = React.useState("full")
  const shown = change ? mode : "full"
  const text = typeof file.text === "string" ? file.text : null
  const { lines, cut } = React.useMemo(() => fileLines(text, MAX_LINES), [text])
  const marked = React.useMemo(
    () => (text != null && change?.diff ? changedLines(text, change.diff, { added: change.added }) : new Set()),
    [text, change?.diff, change?.added]
  )
  const first = marked.size ? Math.min(...marked) : null

  // Each new version opens at its first changed line (the pane scrolls, never the page).
  const boxRef = React.useRef(null)
  const firstRef = React.useRef(null)
  React.useEffect(() => {
    const box = boxRef.current
    const el = firstRef.current
    if (shown === "full" && first && box && el) box.scrollTop = Math.max(0, el.offsetTop - box.clientHeight / 3)
  }, [first, text, shown])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-2 py-1 text-[11px] text-muted-foreground">
        <span className="min-w-0 break-all font-mono text-foreground/80">{tab.path}</span>
        {change && (
          <span className="shrink-0">
            {change.by} {change.op} <span className="text-emerald-600 dark:text-emerald-400">+{change.added ?? 0}</span>{" "}
            <span className="text-red-600 dark:text-red-400">-{change.removed ?? 0}</span> · {clock(change.at)}
          </span>
        )}
        {change?.why && <span className="basis-full break-words text-foreground/80">note: {change.why}</span>}
        {!change && tab.open && (
          <span className="shrink-0">
            opened by {tab.open.by} · {clock(tab.open.at)}
          </span>
        )}
        {file.loading && <span className="shrink-0">reading…</span>}
        {change && <ShowSwitch options={["full", "diff"]} value={shown} onPick={setMode} className="ml-auto" />}
      </div>
      {shown === "diff" ? (
        <DiffBody change={change} text={text} onFull={() => setMode("full")} />
      ) : file.error ? (
        <Empty>{file.error}</Empty>
      ) : file.binary ? (
        <Empty>A binary file ({file.size} bytes): not shown.</Empty>
      ) : (
        <div ref={boxRef} className="relative min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-5">
          <div className="min-w-max py-1">
            {lines.map((l, i) => {
              const n = i + 1
              const hit = marked.has(n)
              return (
                <div key={n} ref={n === first ? firstRef : undefined} className={cn("flex border-l-2", hit ? "border-l-amber-500 bg-amber-500/10" : "border-l-transparent")}>
                  <span className="w-12 shrink-0 select-none pr-3 text-right text-muted-foreground/60 tabular-nums">{n}</span>
                  <span className="whitespace-pre pr-4">{l || " "}</span>
                </div>
              )
            })}
          </div>
          {(file.truncated || cut > 0) && <p className="px-3 py-1 text-[11px] text-muted-foreground">… the rest of the file is not shown</p>}
        </div>
      )}
    </div>
  )
}

// The twin's diff of the last change: + green, - red, context muted. The twin keeps 80 lines of it; when it was cut,
// a note says how much of each side is shown, and the added lines past the cut (a whole-file rewrite loses all of
// them: its removed block comes first) follow from the file as it reads now, with their line numbers.
function DiffBody({ change, text, onFull }) {
  const rows = React.useMemo(() => diffRows(change.diff), [change.diff])
  const cut = React.useMemo(() => diffCut(change.diff, { added: change.added, removed: change.removed }), [change.diff, change.added, change.removed])
  const rest = React.useMemo(() => {
    if (!cut?.range || text == null) return []
    const all = text.split("\n")
    const to = Math.min(cut.range.to, all.length, cut.range.from + MAX_LINES - 1)
    const out = []
    for (let n = cut.range.from; n <= to; n++) out.push({ n, text: all[n - 1] })
    return out
  }, [cut, text])
  if (!rows.length) return <Empty>No change in the text.</Empty>
  const side = (s) => (s.total == null ? `${s.shown}` : `${s.shown} of ${s.total}`)
  return (
    <div className="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-5">
      <div className="min-w-max py-1">
        {rows.map((r, i) => (
          <div
            key={i}
            className={cn(
              "flex whitespace-pre pr-4",
              r.op === "+" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
              r.op === "-" && "bg-red-500/10 text-red-700 dark:text-red-300",
              (r.op === "@" || r.op === "…") && "text-muted-foreground"
            )}
          >
            <span className="w-6 shrink-0 select-none text-center text-muted-foreground/70">{r.op === " " || r.op === "…" ? "" : r.op}</span>
            <span>{r.text || " "}</span>
          </div>
        ))}
      </div>
      {cut && (
        <div className="sticky left-0 max-w-[min(100%,40rem)] border-y px-3 py-1.5 font-sans text-[11px] text-muted-foreground">
          The diff was cut at 80 lines: {side(cut.removed)} removed and {side(cut.added)} added lines shown.
          {cut.range && (
            <>
              {" "}
              The added lines past the cut ({cut.range.from}–{cut.range.to}){rest.length ? " follow, as the file reads now." : " are highlighted in "}
              {!rest.length && (
                <button type="button" onClick={onFull} className="underline underline-offset-2 hover:text-foreground">
                  full
                </button>
              )}
              {!rest.length && "."}
            </>
          )}
        </div>
      )}
      {rest.length > 0 && (
        <div className="min-w-max py-1">
          {rest.map((r) => (
            <div key={r.n} className="flex whitespace-pre bg-emerald-500/10 pr-4 text-emerald-700 dark:text-emerald-300">
              <span className="w-6 shrink-0 select-none text-center text-muted-foreground/70">+</span>
              <span className="w-10 shrink-0 select-none pr-2 text-right text-muted-foreground/60 tabular-nums">{r.n}</span>
              <span>{r.text || " "}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
