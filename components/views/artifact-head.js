// 2026-10-26 dev-card-header: the head of an artifact block (ArtifactBlock in components/views/artifact.jsx). A title
// that starts with the artifact's id ("dev — the project the desk changes") repeats it beside the id span, so the shown
// title drops it; `full` keeps the whole title for the span's title=. The brief yields its room before the title does,
// and below sm (2026-10-26 artifact-head-yield) it hides so a phone reads the title whole; its text stays in title=.

export function headParts(a = {}) {
  const id = String(a.id ?? "")
  const full = String(a.title ?? "")
  let title = full
  for (const lead of [`${id} — `, `${id} `]) {
    if (id && full.startsWith(lead) && full.length > lead.length) {
      title = full.slice(lead.length)
      break
    }
  }
  return { id, title, full }
}

export function headClasses() {
  return {
    id: "shrink-0 font-mono text-foreground/80",
    title: "min-w-0 truncate",
    brief: "ml-auto min-w-0 shrink-[999] truncate max-sm:hidden",
  }
}
