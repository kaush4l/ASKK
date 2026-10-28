"use client"

import { AppWindowIcon } from "lucide-react"

import { openPreview, previewOf } from "@/backend/live/preview"
import { PreviewVisual } from "@/components/preview/visual"
import { useDesk } from "@/hooks/use-engines"

// A drawing in the conversation (2026-10-18 owner: "Only text based conversation is slow and verbose. So, when asking
// questions, the lead should have the option to draw the architecture for me to preview and understand. This should
// help curate the plan more easily."): under a talk message or a chat answer — a spec the agent drew (kernel
// builtin/visual.js readVisual), or {show: id}: a visual already in the preview (the architecture its script computes),
// read from the preview's twin so it stays current, with "Open in the preview". A click on an element → onPoint({context,
// text}) (the reply says what the owner pointed at).
//   visual: {kind, …} | {show}; error: why a drawing could not be read (a chat answer's visualError)

export function TalkVisual({ visual, error = null, onPoint = null }) {
  const desk = useDesk()
  const preview = previewOf(desk?.artifacts)
  const shown = visual?.show ? (preview?.state?.visuals ?? []).find((v) => v.id === visual.show) : null
  if (error) return <p className="text-[11px] text-amber-500">The drawing could not be read: {error}</p>
  if (!visual) return null
  if (visual.show && !shown) return <p className="text-[11px] text-muted-foreground">Drawing “{visual.show}” is not in the preview any more.</p>
  const spec = shown ? { ...shown.visual, title: shown.visual?.title ?? shown.title } : visual
  return (
    <div className="mt-1.5 flex min-w-0 flex-col gap-1.5 rounded-lg border bg-background/60 p-2">
      <div className="min-w-0 overflow-x-auto">
        <PreviewVisual visual={spec} compact onPoint={onPoint ?? (() => {})} />
      </div>
      {shown && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          {shown.says && <span className="min-w-0 flex-1 break-words">{shown.says}</span>}
          <button
            type="button"
            onClick={() => openPreview(preview.id, { id: shown.id }).catch(() => {})}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-accent hover:text-foreground pointer-coarse:min-h-10"
          >
            <AppWindowIcon className="size-3" /> Open in the preview
          </button>
        </div>
      )}
    </div>
  )
}
