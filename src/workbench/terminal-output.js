/** Snapshots are bounded tails; total UTF-16 character counts identify new bytes
 * even when a repeated log produces an identical retained string. */
export function terminalOutputDelta(previous, next, { previousLength, outputLength } = {}) {
  const counted = Number.isSafeInteger(previousLength) && previousLength >= 0 && Number.isSafeInteger(outputLength) && outputLength >= 0
  if (!counted) return previous === next ? { reset: false, text: '' } : { reset: true, text: next }
  const added = outputLength - previousLength
  if (added === 0) return previous === next ? { reset: false, text: '' } : { reset: true, text: next }
  if (added < 0 || added > next.length || outputLength < next.length || previousLength < previous.length) return { reset: true, text: next }
  const text = next.slice(-added)
  // A discontinuous replacement may preserve the counter but cannot preserve
  // the exact previously retained bytes. Reset to the actual snapshot in that case.
  if ((previous + text).slice(-next.length) !== next) return { reset: true, text: next }
  return { reset: false, text }
}
