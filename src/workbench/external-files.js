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
