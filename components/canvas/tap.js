// A tap on the canvas: how far a press may move before it is a drag (a finger jitters more than a mouse), and the
// classes that make a card a target a finger can hit (40px at least, TAP_MIN from lib/tap-target.js).
import { TAP_MIN } from "../../lib/tap-target.js"

const MOUSE_SLOP = 5 // px a mouse press moves before it is a drag (else a click)
const TOUCH_SLOP = 10 // px for a finger or a pen

export const slopFor = (pointerType) => (pointerType === "mouse" ? MOUSE_SLOP : TOUCH_SLOP)

export const cardTapClasses = () => `${TAP_MIN} cursor-pointer`

// An agent's box keeps its near height at every level, while far and mid its card is shorter and its artifacts move
// up under it (canvas-layout.js placeAt): the box lets a tap through, only the card takes it.
export const agentBoxClasses = () => ({ box: "pointer-events-none absolute", card: "pointer-events-auto" })

// A card's status line up close: one line ending in an ellipsis (the full text in its title), never a cut glyph.
export const nearStatusClasses = () => "block min-w-0 truncate"

// A mid card's brief: two lines ending in an ellipsis (three overflow the card's height and cut a glyph).
export const midBriefClasses = () => "line-clamp-2 min-w-0 break-words text-xs"

// The zoom toolbar: top right; below sm, the bottom edge (clear of the top card), above the phone's home bar.
export const toolbarClasses = () => "absolute top-3 right-3 z-10 max-sm:top-auto max-sm:bottom-3 max-sm:mb-[env(safe-area-inset-bottom)]"

// The follow line: bottom left; below sm, a full-width top row (the toolbar keeps the bottom one, the dev badge the
// bottom-left corner), opaque so no card's text shows through it.
export const followPillClasses = () =>
  "pointer-events-none absolute bottom-3 left-3 z-10 max-w-[calc(100%-1.5rem)] max-sm:top-3 max-sm:bottom-auto max-sm:left-3 max-sm:max-w-[calc(100%-1.5rem)] max-sm:bg-background/90 glass truncate rounded-full border px-3 py-1 text-xs text-muted-foreground"

// Screen px the floating controls take along the top and bottom edges, so Fit keeps them clear: the toolbar on
// top and the follow line below; below sm (640px) the follow line takes the top row (12px off the edge, a 26px pill,
// a margin) and the toolbar the bottom one (a 48px toolbar at most, 12px off the edge, a margin).
const INSET = { top: 56, bottom: 40 }
const INSET_SM = { top: 48, bottom: 64 }

export const insetFor = (width) => (width && width < 640 ? INSET_SM : INSET)

// The follow line at the bottom: who the camera follows, or what it shows (an agent focused, an artifact opened, and Fit
// the way back), or that Follow is off.
export const followLabel = ({ follow, target, focused, opened }) => {
  if (follow) return target ? `Following ${target}` : "Follow: waiting for work"
  if (focused) return `Focused on ${focused}`
  if (opened) return `Showing ${opened} · Fit to go back`
  return "Follow off"
}
