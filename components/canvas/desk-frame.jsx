import * as React from "react"

import { cn } from "@/lib/utils"

// A frame on the canvas (backend/live/canvas-layout.js): around a team (its lead and members), or around a desk
// mounted inside this one. Its line keeps its width on the screen (the layer's --canvas-z, so a camera move
// re-renders no frame) and its label grows as the camera pulls back (by zoom level), so both read at every zoom.

const LABEL_SIZE = { far: "text-xl", mid: "text-sm", near: "text-xs" }

export const DeskFrame = React.memo(function DeskFrame({ frame, level }) {
  const desk = frame.kind === "desk"
  return (
    <div
      data-frame={frame.kind}
      data-desk={desk ? frame.desk : undefined}
      data-team={desk ? undefined : frame.team}
      className={cn("pointer-events-none absolute rounded-3xl", desk ? "border-foreground/50" : "border-dashed border-muted-foreground/50")}
      style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h, borderWidth: `calc(${desk ? 2 : 1.25}px / var(--canvas-z, 1))` }}
    >
      <span
        className={cn(
          "absolute top-1 left-4 max-w-[calc(100%-2rem)] truncate leading-tight tracking-wide",
          LABEL_SIZE[level],
          desk ? "text-foreground" : "text-muted-foreground uppercase"
        )}
      >
        {desk ? `desk · ${frame.desk}` : frame.title}
      </span>
    </div>
  )
})
