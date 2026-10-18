// A stream of the workbench open only while its tab is visible (term/stream, fs/watch; tested in term-stream.test.js).
// 2026-10-17: a browser holds at most 6 connections per host over HTTP/1.1 and a workbench tab streams 3 (team,
// term, fs/watch), so two hidden tabs' streams were enough to stall every fetch. Visible again, the stream reopens and
// starts with a snapshot, so nothing is lost but the time hidden.
//
//   const stop = whileVisible(open, close, document)   open() now if visible; close() on hide, open() on show

export function whileVisible(open, close, doc = globalThis.document) {
  if (!doc?.addEventListener) {
    open()
    return () => close()
  }
  const sync = () => (doc.visibilityState === "hidden" ? close() : open())
  sync()
  doc.addEventListener("visibilitychange", sync)
  return () => {
    doc.removeEventListener("visibilitychange", sync)
    close()
  }
}
