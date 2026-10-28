// The bottom strip's agent entry: a 40px target below sm, dense from sm up, and the agent's name with a readable cut
// ("Planner", "Develop…") at 375 instead of its initials.
// The footer around it: 40px below sm on any pointer so those entries sit inside it unclipped, 28px and dense from sm up;
// below sm its left side is padded clear of the Next dev badge (bottom-left), so the first agent dot and name read whole.
export const footerClasses = () => "h-10 sm:h-7 max-sm:pl-16"

export const stripNameClasses = () => ({
  // Below sm the last entry may shrink (every StatusItem is shrink-0), so its name truncates with an ellipsis instead
  // of overflowing into a mid-letter cut; its right padding keeps that ellipsis clear of the left group's edge fade.
  item: "min-h-10 sm:min-h-0 max-sm:last:shrink max-sm:last:pr-6",
  name: "min-w-0 max-w-[9ch] truncate sm:max-w-24",
  // The "Running n calls…" text (and the right group holding it) gives way first, so at 375 the names keep their width
  // and cut with an ellipsis ("plann…") instead of being clipped mid-letter by the left group.
  running: "min-w-0 shrink-[999] truncate",
  // Below sm the running text is read by screen readers only (its aria-live is kept), so it leaves no empty gap; the
  // running agent's pulsing strip dot is the visible cue, and the entry's title names its state.
  activity: "max-sm:px-0",
  runningText: "truncate max-sm:sr-only",
})

// The strip's right group (desk log, running text, model): from sm up it gives way first like the running text; below
// sm the running text is sr-only, so the group keeps its full width and the model's "default" reads whole.
export const rightClasses = () => "flex items-stretch justify-end min-w-0 shrink-[999] truncate max-sm:min-w-fit max-sm:shrink-0"

// The strip's model chip: below sm a chip icon (the model's name stays in its title and aria-label, and for screen
// readers), so the left group keeps room for the last agent name; from sm up it reads "default".
export const modelClasses = () => ({ label: "max-w-32 truncate max-sm:sr-only", icon: "size-3.5 shrink-0 sm:hidden" })

// The strip's left group (host and agents): it scrolls sideways, and below sm its right edge fades out, so a last name
// that does not fit fades at the edge instead of a hard mid-letter cut.
export const leftClasses = () =>
  "flex min-w-0 items-stretch overflow-x-auto max-sm:[mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)]"

// The strip's host entry: a server icon and "desk <name>" (not the plain dot and bare name), so it never reads as the
// dev agent ("dev dev" at 1280, a lone dot at 375); null until the host is known.
export const hostParts = (host) => {
  if (!host) return null
  if (host.mode === "local") {
    const name = host.desk?.name ?? host.root.split(/[\\/]/).filter(Boolean).at(-1)
    return {
      label: `desk ${name}`,
      title: `Desk ${name} on this computer · ${host.root}`,
      aria: `Desk ${name} on this computer, workspace ${host.root}`,
      icon: "size-3.5 shrink-0 text-emerald-500",
    }
  }
  if (host.mode === "browser") {
    return {
      label: "This browser",
      title: "An agent runs in this browser",
      aria: "An agent runs in this browser",
      icon: "size-3.5 shrink-0 text-emerald-500",
    }
  }
  return {
    label: "No desk",
    title: "No desk server",
    aria: "No desk server",
    icon: "size-3.5 shrink-0 text-amber-500",
  }
}
