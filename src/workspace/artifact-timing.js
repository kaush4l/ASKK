export const ARTIFACT_TIMING = Object.freeze({ bootMs: 15000, settleMs: 1250, settleDelayMs: 500, drainMs: 12000, storageMs: 10000, overheadMs: 2000, maximumMs: 240000 })

export const artifactSegmentMs = count => Math.max(12000, 4000 + count * 1250)

/** The validated plan gets one finite ledger; reloads pay for another boot and drain. */
export function artifactInspectionBudget(plan) {
  const segments = []; let count = 0; let reloads = 0
  for (const step of plan) {
    if (step.action === 'reload') { if (count) segments.push(artifactSegmentMs(count)); count = 0; reloads++ }
    else count++
  }
  if (count) segments.push(artifactSegmentMs(count))
  const frames = reloads + 1
  const totalMs = frames * (ARTIFACT_TIMING.bootMs + ARTIFACT_TIMING.settleMs + ARTIFACT_TIMING.drainMs) + segments.reduce((sum, value) => sum + value, 0) + ARTIFACT_TIMING.overheadMs
  if (totalMs > ARTIFACT_TIMING.maximumMs) throw new Error('Artifact check exceeds the 240-second time budget. Split it into smaller checks.')
  return Object.freeze({ totalMs, frames, segments: Object.freeze(segments) })
}

export const artifactClock = () => ({ now: performance.now.bind(performance), setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) })

/** Serialized into the opaque bootstrap too: injected operations are captured before app code. */
export async function settleArtifactStorage({ hasPending, sleep, now, timeoutMs }) {
  const deadline = now() + timeoutMs
  let quiet = 0
  while (now() < deadline) {
    await sleep(80)
    if (now() >= deadline) return false
    quiet = hasPending() ? 0 : quiet + 1
    if (quiet === 2) return true
  }
  return false
}
