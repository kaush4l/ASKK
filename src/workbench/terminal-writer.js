import { terminalOutputDelta } from './terminal-output.js'

/** Feed a bounded command-output snapshot to xterm in small acknowledged writes.
 * xterm yields between chunks using its own parser time budget. Only one chunk
 * is in flight, so a reset never races an old queued write. This is deliberately
 * not a PTY flow-control implementation: interactive streams need upstream ACKs.
 */
export function createTerminalSnapshotWriter(terminal, { chunkSize = 4096, maxPendingCharacters = 1000000 } = {}) {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 2 || !Number.isSafeInteger(maxPendingCharacters) || maxPendingCharacters < chunkSize) throw new RangeError('Invalid terminal delivery limits')
  let previous = ''; let previousLength = 0
  let queue = []; let head = 0; let pendingCharacters = 0; let inFlightCharacters = 0
  let needsReset = false; let disposed = false
  function clear() { queue = []; head = 0; pendingCharacters = 0 }
  function pump() {
    if (disposed || inFlightCharacters) return
    if (needsReset) { needsReset = false; terminal.reset() }
    const entry = queue[head]
    if (!entry) return
    let end = Math.min(entry.offset + chunkSize, entry.text.length)
    // Keep a Unicode scalar together even if a decoder's streaming policy changes.
    if (end < entry.text.length && /[\uD800-\uDBFF]/.test(entry.text[end - 1]) && /[\uDC00-\uDFFF]/.test(entry.text[end])) end--
    const part = entry.text.slice(entry.offset, end)
    entry.offset = end; pendingCharacters -= part.length
    if (end === entry.text.length) {
      head++
      if (head === queue.length) clear()
      else if (head > 32) { queue = queue.slice(head); head = 0 }
    }
    inFlightCharacters = part.length
    terminal.write(part, () => {
      inFlightCharacters = 0
      if (!disposed) pump()
    })
  }
  return {
    update(value, outputLength) {
      if (disposed) return
      const text = String(value)
      if (text.length > maxPendingCharacters) throw new RangeError('Command output snapshot exceeds the terminal delivery limit')
      const delta = terminalOutputDelta(previous, text, { previousLength, outputLength })
      previous = text; previousLength = outputLength
      if (delta.reset || pendingCharacters + delta.text.length > maxPendingCharacters) {
        // A producer that outruns display rendering is rebased to its actual
        // retained snapshot. No invented truncation marker or guessed overlap.
        clear(); needsReset = true
        if (text) { queue.push({ text, offset: 0 }); pendingCharacters = text.length }
      } else if (delta.text) {
        queue.push({ text: delta.text, offset: 0 }); pendingCharacters += delta.text.length
      }
      pump()
    },
    dispose() { disposed = true; clear(); previous = ''; needsReset = false },
    getState() { return { pendingCharacters, inFlightCharacters, needsReset, disposed } },
  }
}
