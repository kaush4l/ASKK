/** Save the drafts visible at admission, then reject any edit made during saving. */
export function acknowledgeSavedDraft(current, submitted, revision) {
  const incoming = current.incoming
  // A successful CAS save resolves the reviewed base as well as its own receipt.
  // Keep a different incoming revision: another writer may have committed meanwhile.
  const resolved = incoming && (incoming.rev === submitted.baseRev || incoming.rev === revision)
  return { ...current, baseContent: submitted.content, baseRev: revision, incoming: resolved ? null : incoming }
}

/** Keep new editor typing; otherwise retain the submitted draft or merge attempt. */
export function draftForConflict(current, submitted, contentAtAdmission) {
  return current && current.content !== contentAtAdmission ? current.content : submitted.content
}

export async function saveAllDrafts(readDocuments, save) {
  const drafts = Object.entries(readDocuments()).filter(([, doc]) => doc.content !== doc.baseContent).map(([path, doc]) => [path, { ...doc }])
  for (const [path, draft] of drafts) {
    if (!await save(path, draft)) throw new Error(`Build paused: resolve the save for ${path} first.`)
    if (readDocuments()[path]?.content !== draft.content) throw new Error('A draft changed while saving. Review your edits, then save all and build again.')
  }
  if (Object.values(readDocuments()).some(doc => doc.incoming)) throw new Error('Committed changes need review before building. Resolve the file conflicts first.')
  if (Object.values(readDocuments()).some(doc => doc.content !== doc.baseContent)) throw new Error('New unsaved changes arrived while saving. Review them, then save all and build again.')
}
