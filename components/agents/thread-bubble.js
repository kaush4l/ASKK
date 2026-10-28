// A thread message's classes (2026-10-26 thread-bubble-375): the row may shrink below its content (min-w-0) and the
// avatar never gives way (shrink-0), so at 375 the bubble keeps its 85% and its text wraps whole instead of clipping
// mid-line. Plain text breaks a long word or URL anywhere it must; a step's calls keep their mono break-all.
export function bubbleClasses({ isUser = false, step = false } = {}) {
  return {
    row: isUser ? "flex min-w-0 gap-3 flex-row-reverse" : "flex min-w-0 gap-3",
    avatar: "size-8 shrink-0",
    text: step ? "whitespace-pre-wrap font-mono text-xs break-all" : "whitespace-pre-wrap break-words [overflow-wrap:anywhere]",
  }
}

// The Show full step control's words (2026-10-26 full-step-failed-note): while the row loads, "Loading…"; when the load
// failed (the thread moved, or `older` refused), a line in the destructive tone instead of a silent revert; else the offer.
export function stepLoadLabel({ loading = false, failed = false } = {}) {
  if (loading) return { text: "Loading…", className: "" }
  if (failed) return { text: "Not loaded: the thread moved — reload", className: "text-destructive" }
  return { text: "Show full step", className: "" }
}

// A capped message's edge (2026-10-26 bubble-scroll-fade): it overflows when its content is taller than its box, and it is
// at its end when the box's bottom reaches the content's (1px slack for fractional scroll positions).
export function capEdge({ scrollHeight = 0, clientHeight = 0, scrollTop = 0 } = {}) {
  return {
    overflowing: scrollHeight > clientHeight + 1,
    atEnd: scrollTop + clientHeight >= scrollHeight - 1,
  }
}

// The cap's classes: half the viewport at most, scrolling inside; while more text waits below, its last 2rem fade out.
export function capClasses({ overflowing = false, atEnd = true } = {}) {
  const cap = "max-h-[50svh] overflow-y-auto overscroll-contain"
  return overflowing && !atEnd ? `${cap} [mask-image:linear-gradient(to_bottom,black_calc(100%-2rem),transparent)]` : cap
}
