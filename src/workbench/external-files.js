/** Only an initialized, authoritative listing may classify a recovered draft as missing. */
export function reconcileMissingDocuments(documents, files, { ready = false, hydrated = false, saving = new Set(), openPaths = [] } = {}) {
  if (!ready || !hydrated) return { documents, closedPaths: [] }
  const present = new Set(files.map(file => file.path))
  let next = documents
  const closedPaths = []
  for (const [path, doc] of Object.entries(documents)) {
    if (present.has(path)) continue
    if (next === documents) next = { ...documents }
    if (doc.content !== doc.baseContent || saving.has(path)) {
      next[path] = doc.incoming?.deleted ? doc : { ...doc, incoming: { deleted: true, rev: 0, content: '' } }
    } else {
      delete next[path]
      closedPaths.push(path)
    }
  }
  for (const path of new Set(openPaths)) if (!present.has(path) && !next[path] && !closedPaths.includes(path)) closedPaths.push(path)
  // An unchanged deletion marker must not trigger a render/effect loop.
  if (!closedPaths.length && Object.keys(next).every(path => next[path] === documents[path])) next = documents
  return { documents: next, closedPaths }
}

/** Recheck after a delayed read, before installing a clean document in the editor. */
export function mayOpenFile(path, documents, files, ready) {
  const doc = documents[path]
  return !ready || files.some(file => file.path === path) || !!doc && doc.content !== doc.baseContent
}

function listedVersion(path, snapshot) {
  const file = snapshot.files.find(file => file.path === path)
  return { ready: !!snapshot.ready, present: !!file, revision: file ? String(file.rev) : null }
}

/** Install synchronously at admission, so no promise boundary can admit a stale read. */
export async function readEditorDocument({ path, read, snapshot, isCurrent, install }) {
  const staleRevisions = new Set()
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!isCurrent()) return false
    const beforeSnapshot = snapshot()
    if (beforeSnapshot.documents[path]) return true
    const before = listedVersion(path, beforeSnapshot)
    let file
    try { file = await read(path) }
    catch (error) { if (!isCurrent()) return false; throw error }
    if (!isCurrent()) return false
    const current = snapshot()
    // Another view or restored draft owns any document that arrived during IO.
    if (current.documents[path]) return true
    const after = listedVersion(path, current)
    if (!file || after.ready && !after.present) throw new Error(`${path} no longer exists.`)
    const revision = String(file.rev)
    const listingChanged = before.ready && after.ready && (before.present !== after.present || before.revision !== after.revision)
    // An unchanged listing may lag this fresh read. Only retry known stale data
    // or a contradiction observed while this read was in flight.
    const matchesListing = after.ready && after.present && revision === after.revision
    if (!matchesListing && (listingChanged || staleRevisions.has(revision))) {
      staleRevisions.add(revision)
      continue
    }
    return install(file) !== false
  }
  throw new Error(`${path} kept changing while opening. Try opening it again; no older version was loaded.`)
}
