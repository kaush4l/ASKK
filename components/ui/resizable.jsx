"use client"

import * as React from "react"
import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "@/lib/utils"

// shadcn's resizable on react-resizable-panels v4 (Group / Panel / Separator, `orientation`), by hand: the CLI's copy
// targets v4 too, this keeps the file plain JSX. A layout persists per `id` through useResizableLayout.

function ResizablePanelGroup({ className, ...props }) {
  return <ResizablePrimitive.Group data-slot="resizable-panel-group" className={cn("flex h-full w-full aria-[orientation=vertical]:flex-col", className)} {...props} />
}

function ResizablePanel(props) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

// A 1px border line with a wider invisible grab area; on touch devices the library widens the hit target itself.
function ResizableHandle({ withHandle, className, ...props }) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "relative flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2 hover:bg-primary/60 focus-visible:bg-primary focus-visible:outline-hidden data-[separator=active]:bg-primary aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-2 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90",
        className
      )}
      {...props}
    >
      {withHandle && <div className="z-10 flex h-6 w-1 shrink-0 rounded-lg bg-border" />}
    </ResizablePrimitive.Separator>
  )
}

// localStorage that never throws (private windows, blocked storage) and reads nothing outside the browser.
const storage = {
  getItem(key) {
    try {
      return typeof window === "undefined" ? null : window.localStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem(key, value) {
    try {
      window.localStorage.setItem(key, value)
    } catch {}
  },
}

// {defaultLayout, onLayoutChanged} for a Group: the owner's last layout of this `id`, saved as it changes.
function useResizableLayout(id) {
  const { defaultLayout, onLayoutChanged } = ResizablePrimitive.useDefaultLayout({ id: `askk.layout.${id}`, storage })
  return { defaultLayout, onLayoutChanged }
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup, useResizableLayout }
