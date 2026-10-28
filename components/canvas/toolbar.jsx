import { LocateFixedIcon, ScanIcon, ZoomInIcon, ZoomOutIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// The canvas's controls, floating over it: zoom out, the zoom (click: 100%), zoom in, Fit the desk, Follow the work
// (only where the board has work to follow: onFollow).
export function Toolbar({ zoom, follow, onZoomOut, onZoomIn, onReset, onFit, onFollow, className }) {
  const icon = "size-8 pointer-coarse:size-10"
  return (
    <div role="toolbar" aria-label="Canvas controls" className={cn("flex items-center gap-0.5 glass rounded-xl border p-1", className)}>
      <Button variant="ghost" size="icon" className={icon} onClick={onZoomOut} aria-label="Zoom out" title="Zoom out (−)">
        <ZoomOutIcon />
      </Button>
      <Button variant="ghost" className="h-8 min-w-14 px-1.5 tabular-nums pointer-coarse:h-10" onClick={onReset} aria-label={`Zoom ${zoom}%: reset to 100%`} title="Reset to 100%">
        {zoom}%
      </Button>
      <Button variant="ghost" size="icon" className={icon} onClick={onZoomIn} aria-label="Zoom in" title="Zoom in (+)">
        <ZoomInIcon />
      </Button>
      <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
      <Button variant="ghost" className="h-8 gap-1.5 px-2 pointer-coarse:h-10 pointer-coarse:min-w-10" onClick={onFit} aria-label="Fit the desk" title="Fit the desk (0)">
        <ScanIcon />
        <span className="hidden sm:inline">Fit</span>
      </Button>
      {onFollow && (
        <Button
          variant={follow ? "secondary" : "ghost"}
          className="h-8 gap-1.5 px-2 pointer-coarse:h-10 pointer-coarse:min-w-10"
          onClick={onFollow}
          aria-pressed={follow}
          aria-label="Follow the work"
          title="Follow the work (f)"
        >
          <LocateFixedIcon className={cn(follow && "text-blue-600 dark:text-blue-400")} />
          <span className="hidden sm:inline">Follow</span>
        </Button>
      )}
    </div>
  )
}
