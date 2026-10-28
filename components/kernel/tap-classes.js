import { PHONE_TAP } from "../../lib/tap-target.js"
import { cn } from "../../lib/utils.js"

// The desk cards' small controls (2026-10-26 tap-helper-home): each keeps its dense look from sm up and is a 40px
// target below sm on any pointer (PHONE_TAP), so a phone with a fine pointer still gets a finger-sized tap.
export const TILE_HEAD = cn("flex min-h-8 min-w-0 items-center gap-1.5 text-left text-[11px] text-muted-foreground hover:text-foreground pointer-coarse:min-h-10", PHONE_TAP)

export const CHIP_BTN = cn("rounded border px-1.5 font-mono text-[11px] leading-5 text-muted-foreground hover:text-foreground pointer-coarse:min-h-10", PHONE_TAP)

export const DECIDE_BTN = cn("h-6 px-2 text-[11px] pointer-coarse:h-10 pointer-coarse:min-w-10", PHONE_TAP)
