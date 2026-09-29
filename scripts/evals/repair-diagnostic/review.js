/** Creates a separate, receipt-hash-bound assessment; never edits machine evidence. */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sha256 } from './fixture.js'
import { executionAssessment } from './limits.js'

function validatedAssessment(receipt) {
  if (receipt.version !== 1 || !Array.isArray(receipt.checks) || receipt.checks.length !== 2 || receipt.checks[0].phase !== 'baseline' || receipt.checks[1].phase !== 'main' || !Array.isArray(receipt.forbidden) || !receipt.main || !receipt.counts || !receipt.compactor || typeof receipt.error !== 'string') throw new Error('Incomplete machine evidence')
  const [baseline, repaired] = receipt.checks.map(row => row.receipt)
  const original = receipt.fixture?.originalFailure
  if (!original || sha256(JSON.stringify(original)) !== receipt.fixture.originalFailureSha256 || !Array.isArray(original.assertions)) throw new Error('Original failure anchor is missing or changed')
  if (JSON.stringify(baseline.assertions) !== JSON.stringify(original.assertions)) throw new Error('Baseline differs from the original failed plan')
  for (const result of [baseline, repaired]) {
    if (!result || !Array.isArray(result.assertions) || !result.assertions.length || !Array.isArray(result.results) || result.results.length > result.assertions.length || !Array.isArray(result.errors) || result.interactionMode !== 'programmatic-dom' || !Number.isSafeInteger(result.revision) || typeof result.artifactId !== 'string' || !result.artifactId || typeof result.buildId !== 'string' || !result.buildId) throw new Error('Malformed artifact evidence')
    let frame = 0
    for (const [index, step] of result.results.entries()) { if (result.assertions[index].action === 'reload') frame++; if (step.index !== index || step.action !== result.assertions[index].action || step.frame !== frame || step.ok !== true) throw new Error('Artifact step evidence is not ordered and complete') }
  }
  if (repaired.errors.length || ['artifactId', 'buildId', 'revision'].some(key => baseline[key] !== repaired[key])) throw new Error('Repair is failed or refers to a different artifact')
  const requests = receipt.events?.filter(event => event.kind === 'request')
  if (!requests || requests.filter(event => event.agent === 'main').length !== receipt.counts.main || requests.filter(event => event.agent === 'compactor').length !== receipt.counts.compactor) throw new Error('Request counts do not match recorded transport events')
  const result = executionAssessment({ baseline, repaired, originalPlan: original.assertions, compactions: receipt.compactor.compactions, main: receipt.main, counts: receipt.counts, forbidden: receipt.forbidden })
  if (receipt.error || receipt.compactor.status !== 'done' || typeof receipt.compactor.summary !== 'string' || !receipt.compactor.summary.trim() || typeof receipt.compactor.source !== 'string' || !receipt.compactor.source.trim()) result.status = 'failed'
  return result
}

export function reviewReceipt(bytes, review) {
  const receipt = JSON.parse(String(bytes))
  if (receipt.evaluation !== 'immutable-repair-v1') throw new Error('Not a repair diagnostic receipt')
  for (const key of ['reviewer', 'summaryEvidence', 'coverageEvidence', 'limits']) if (typeof review[key] !== 'string' || !review[key].trim()) throw new Error(`Independent review requires ${key}`)
  for (const key of ['summaryFaithful', 'stableIdentity', 'activeCompletedReloadCovered', 'noOwnerSteering']) if (typeof review[key] !== 'boolean') throw new Error(`Independent review requires boolean ${key}`)
  // Recompute from recorded observations. An empty or edited assessment object
  // can never promote missing source/transport/inspection evidence to a pass.
  const assessment = validatedAssessment(receipt)
  const executionPassed = assessment.status === 'needs-independent-review'
  const fields = Object.fromEntries(['reviewer', 'summaryEvidence', 'coverageEvidence', 'limits', 'summaryFaithful', 'stableIdentity', 'activeCompletedReloadCovered', 'noOwnerSteering'].map(key => [key, review[key]]))
  return { version: 1, evaluation: receipt.evaluation, receiptSha256: sha256(bytes), reviewedAt: new Date().toISOString(), assessment, ...fields, passed: executionPassed && ['summaryFaithful', 'stableIdentity', 'activeCompletedReloadCovered', 'noOwnerSteering'].every(key => review[key]), scope: 'One verification-repair diagnostic. Not fresh generation, general model reliability, real-pointer interaction, or browser Linux build proof.' }
}
if (import.meta.main) {
  const [receiptPath, reviewPath] = Bun.argv.slice(2)
  if (!receiptPath || receiptPath === '--help' || !reviewPath) console.log('bun scripts/evals/repair-diagnostic/review.js PRIVATE_RECEIPT.json INDEPENDENT_REVIEW.json\nWrites receipt.json.review.json exclusively. Required review fields are documented in README.md. Does not contact a model.')
  else {
    const bytes = await readFile(resolve(receiptPath)), review = JSON.parse(await readFile(resolve(reviewPath)))
    const result = reviewReceipt(bytes, review)
    await writeFile(`${resolve(receiptPath)}.review.json`, JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 })
    console.log(JSON.stringify({ passed: result.passed, receiptSha256: result.receiptSha256 }))
    if (!result.passed) process.exitCode = 1
  }
}
