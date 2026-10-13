"use client"

import * as React from "react"
import { EllipsisVerticalIcon, SparklesIcon, Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useEngineState } from "@/hooks/use-engines"

// Memory options for the active engine: summarize (a single-call agent
// replaces the log with a summary) or clear (after confirmation).
export function MemoryMenu({ engine }) {
  const state = useEngineState(engine)
  const [confirmClear, setConfirmClear] = React.useState(false)
  if (!engine || !state) return null

  const busy = state.status === "running"
  const empty = state.messages.length === 0
  // Errors are recorded in engine state and shown by the chat.
  const ignore = () => {}

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="size-11 shrink-0 rounded-full"
              aria-label={`Memory options for ${engine.name}`}
            />
          }
        >
          <EllipsisVerticalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Memory · {engine.name}</DropdownMenuLabel>
            <DropdownMenuItem
              disabled={busy || empty}
              onClick={() => engine.summarizeMemory().catch(ignore)}
            >
              <SparklesIcon /> Summarize memory
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              disabled={busy || empty}
              onClick={() => setConfirmClear(true)}
            >
              <Trash2Icon /> Clear memory
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear {engine.name}&apos;s memory?</DialogTitle>
            <DialogDescription>
              This deletes {state.messages.length === 1 ? "the only message" : `all ${state.messages.length} messages`}{" "}
              and empties {engine.memory.path}. It cannot be undone. Summarize instead to keep a short
              record.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                engine.clearMemory().catch(ignore)
                setConfirmClear(false)
              }}
            >
              Clear memory
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
