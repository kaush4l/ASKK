// The snapshot's compact artifacts (snapshot-artifact-views, 2026-10-26 owner speed order: the snapshot ≤ 500 KB, nothing
// the UI shows lost): the stream snapshot carries the two largest artifacts as their latest view, with the count left
// out, and a card holding a count fetches the full view once (agent call `artifact` [id]). Live patches send the full
// view (team-core's view(id)), which carries no count.
//   files: every change, but only the newest change keeps its diff → diffsSkipped; the tree rides as its count →
//          treeSkipped (snapshot-files-lean: ≤ 800 rows, drawn only once a card or the Live Files pane opens)
//   goal:  the newest TAIL progress entries and ledger notes → entriesSkipped (both together); each done milestone as
//          one line without its check and evidence → milestonesCut (snapshot-goal-lean); a kept note's text and
//          evidence and an open milestone's check and evidence over ENTRY_TEXT cut → notesCut, milestonesCut (goal-under-30)
//   any other artifact passes through unchanged

export const TAIL = 15

const newestIndex = (rows) => rows.reduce((n, m, i) => (n < 0 || String(m?.at) >= String(rows[n]?.at) ? i : n), -1)

function tailFiles(view) {
  const modified = view.state.modified ?? []
  const tree = view.state.tree ?? []
  const newest = newestIndex(modified)
  let skipped = 0
  const rows = modified.map((m, i) => {
    if (i === newest || m?.diff == null) return m
    skipped++
    const { diff, ...rest } = m
    return rest
  })
  if (!skipped && !tree.length) return view
  return {
    ...view,
    state: { ...view.state, modified: rows, tree: [] },
    ...(skipped ? { diffsSkipped: skipped } : {}),
    ...(tree.length ? { treeSkipped: tree.length } : {}),
  }
}

export const DONE_TEXT = 120

// A done milestone as one line (snapshot-goal-lean): its check and evidence wait for the full fetch.
const doneLine = ({ id, text, status, by, at }) => ({
  id,
  text: String(text ?? "").length > DONE_TEXT ? `${String(text).slice(0, DONE_TEXT)}…` : text,
  status,
  by,
  at,
  done: true,
  doneCut: true,
})

export const ENTRY_TEXT = 300

export const FRAMES_TAIL = 3

// A kept progress entry with each string field over ENTRY_TEXT cut (goal-lean-ledger): the whole text waits for the full fetch.
const entryLine = (e) => {
  const long = Object.entries(e ?? {}).filter(([, v]) => typeof v === "string" && v.length > ENTRY_TEXT)
  if (!long.length) return e
  return { ...e, ...Object.fromEntries(long.map(([k, v]) => [k, `${v.slice(0, ENTRY_TEXT)}…`])), entryCut: true }
}

// A copy of a row with each named string field over ENTRY_TEXT cut, marked cut: true (goal-under-30): a kept ledger
// note's text and evidence, an open milestone's check and evidence. The row itself when none is long.
const cutFields = (row, keys) => {
  const long = keys.filter((k) => typeof row?.[k] === "string" && row[k].length > ENTRY_TEXT)
  if (!long.length) return row
  return { ...row, ...Object.fromEntries(long.map((k) => [k, `${row[k].slice(0, ENTRY_TEXT)}…`])), cut: true }
}

function tailGoal(view) {
  const entries = view.state.entries ?? []
  const ledger = view.state.ledger ?? []
  const milestones = view.state.milestones ?? []
  const kept = entries.slice(-TAIL).map(entryLine)
  const entriesCut = kept.filter((e) => e?.entryCut).length
  const tail = ledger.slice(-TAIL)
  const notes = tail.map((n) => cutFields(n, ["text", "evidence"]))
  const notesCut = notes.filter((n, i) => n !== tail[i]).length
  const skipped = Math.max(0, entries.length - TAIL) + Math.max(0, ledger.length - TAIL)
  const rows = milestones.map((m) => (m?.status === "done" ? doneLine(m) : cutFields(m, ["check", "evidence"])))
  const cut = rows.filter((m, i) => m !== milestones[i]).length
  const frames = view.state.frames ?? []
  const framesSkipped = Math.max(0, frames.length - FRAMES_TAIL)
  if (!skipped && !cut && !entriesCut && !notesCut && !framesSkipped) return view
  return {
    ...view,
    ...(entriesCut ? { entriesCut } : {}),
    ...(notesCut ? { notesCut } : {}),
    state: {
      ...view.state,
      entries: kept,
      ledger: notes,
      milestones: rows,
      ...(framesSkipped ? { frames: frames.slice(-FRAMES_TAIL) } : {}),
    },
    ...(skipped ? { entriesSkipped: skipped } : {}),
    ...(cut ? { milestonesCut: cut } : {}),
    ...(framesSkipped ? { framesSkipped } : {}),
  }
}

// The bytes of JSON.stringify of each state key of a goal view, with its top-level fields as "rest" (goal-30-diagnose):
// which part to cut is measured, not guessed.
export function goalSplit(view) {
  const { state, ...top } = view ?? {}
  const split = Object.fromEntries(Object.entries(state ?? {}).map(([k, v]) => [k, JSON.stringify(v ?? null).length]))
  return { ...split, rest: JSON.stringify(top).length }
}

export function tailArtifact(id, view) {
  if (!view?.state) return view
  if (view.view === "files") return tailFiles(view)
  if (view.view === "goal") return tailGoal(view)
  return view
}

export const tailArtifacts = (artifacts) => Object.fromEntries(Object.entries(artifacts ?? {}).map(([id, v]) => [id, tailArtifact(id, v)]))

// What a card holding the compact view still has to fetch (0: it is whole).
export const skippedOf = (view) => (view?.diffsSkipped ?? 0) + (view?.entriesSkipped ?? 0) + (view?.entriesCut ?? 0) + (view?.notesCut ?? 0) + (view?.treeSkipped ?? 0) + (view?.milestonesCut ?? 0) + (view?.framesSkipped ?? 0)
