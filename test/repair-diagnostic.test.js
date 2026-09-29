import { expect, test } from 'bun:test'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { extractFixture, SOURCE_RECEIPT, sha256 } from '../scripts/evals/repair-diagnostic/fixture.js'
import { counter, boundModel, evidenceRecorder, executionAssessment } from '../scripts/evals/repair-diagnostic/limits.js'
import { reviewReceipt } from '../scripts/evals/repair-diagnostic/review.js'
import { runDiagnostic } from '../scripts/evals/repair-diagnostic/runner.js'
import { verifySource } from '../scripts/evals/repair-diagnostic/source.js'
import { modelCatalogue } from '../scripts/evals/repair-diagnostic/profile.js'
import { resolve } from '../src/core/models.js'

test('fixture recovers all five exact historical source reads and keeps the failed assertion, not the incorrect summary', async () => {
  const bytes = await readFile(new URL(`../${SOURCE_RECEIPT}`, import.meta.url))
  const fixture = extractFixture(bytes)
  expect(fixture.files).toHaveLength(5)
  for (const file of fixture.files) expect(sha256(file.content)).toBe(file.rev)
  expect(fixture.originalFailure.ok).toBe(false)
  expect(fixture.originalFailure.results).toHaveLength(15)
  expect(fixture.originalFailure.assertions[15]).toEqual({ action: 'assertText', selector: '.task-title', value: 'Buy groceries' })
  expect(fixture.auditAnchor.filter).toBe('Active')
  expect(fixture.auditAnchor.actualTextProvenance).toContain('Source-derived')
  expect(fixture.provenance.originalPrivateReceiptSha256).toMatch(/^[a-f0-9]{64}$/)
  const altered = JSON.parse(String(bytes)); altered.runs.find(run => run.id === 'rmulp44n21').prompts[0].snapshot.messages = [{ role: 'user', content: 'observation: workspace_read({"path":"app/page.js"}) -> {"path":"app/page.js","content":"changed","rev":"unmatched"}' }]
  expect(() => extractFixture(JSON.stringify(altered))).toThrow('content/revision mismatch')
})

test('request and inspection budgets reserve before concurrent work; exhausted limits never call the transport', async () => {
  const budget = counter(2, 'Inspection'), accepted = []
  await Promise.allSettled(Array.from({ length: 4 }, async (_, index) => { budget.take(); await Promise.resolve(); accepted.push(index) }))
  expect(accepted).toEqual([0, 1]); expect(budget.count).toBe(2)
  let calls = 0
  const model = boundModel({ async *stream() { calls++; yield { kind: 'text', text: 'fixture only' } } }, counter(6, 'Main request'))
  for (let index = 0; index < 6; index++) for await (const ignored of model.stream()) {}
  await expect((async () => { for await (const ignored of model.stream()) {} })()).rejects.toMatchObject({ code: 'eval_budget' })
  expect(calls).toBe(6)
})

test('evidence freezes exact calls and snapshots without retaining streamed reasoning', () => {
  const recorder = evidenceRecorder(), event = { kind: 'call', args: { assertions: [{ action: 'click', selector: '#actual' }] } }
  recorder.record('main', 'main', event)
  recorder.record('main', 'main', { kind: 'reasoning', value: 'not retained' })
  event.args.assertions[0].selector = '#changed'
  const saved = recorder.snapshot()
  expect(saved).toHaveLength(1); expect(saved[0].args.assertions[0].selector).toBe('#actual')
  expect(() => saved.push({})).toThrow()
})

test('machine success requires human review; unchanged plans, failed compaction and denied mutations cannot pass', () => {
  const originalPlan = [{ action: 'assertText', selector: '#title', value: 'wrong' }]
  const facts = { baseline: { ok: false, results: Array.from({ length: 15 }), errors: ['Expected text "Buy groceries"; actual text "Write report"'] }, repaired: { ok: true, assertions: [{ action: 'assertText', selector: '#title', value: 'correct' }], results: [{}] }, originalPlan, compactions: 1, main: { status: 'done' }, counts: { main: 3, compactor: 1, inspections: 2 }, forbidden: [] }
  const ready = executionAssessment(facts)
  expect(ready.status).toBe('needs-independent-review'); expect(ready.passed).toBe(false)
  expect(executionAssessment({ ...facts, compactions: 0 }).status).toBe('failed')
  expect(executionAssessment({ ...facts, forbidden: [{ op: 'workspace.write' }] }).status).toBe('failed')
  expect(executionAssessment({ ...facts, repaired: { ...facts.repaired, assertions: originalPlan } }).status).toBe('failed')
  const baselinePlan = [...Array.from({ length: 15 }, () => ({ action: 'assertText', selector: '#fixture', value: 'fixture' })), ...originalPlan]
  const common = { artifactId: 'fixture-artifact', buildId: 'fixture-build', revision: 26, interactionMode: 'programmatic-dom' }
  const baseline = { ...common, ...facts.baseline, assertions: baselinePlan, results: baselinePlan.slice(0, 15).map((step, index) => ({ index, action: step.action, frame: 0, ok: true })) }
  const repaired = { ...common, ...facts.repaired, errors: [], results: [{ index: 0, action: 'assertText', frame: 0, ok: true }] }
  const original = { ...baseline, errors: ['Historical generic diagnostic'] }
  const recorded = { version: 1, evaluation: 'immutable-repair-v1', error: '', assessment: ready, fixture: { originalFailure: original, originalFailureSha256: sha256(JSON.stringify(original)) }, checks: [{ phase: 'baseline', receipt: baseline }, { phase: 'main', receipt: repaired }], forbidden: [], counts: facts.counts, main: facts.main, compactor: { status: 'done', compactions: 1, source: 'source fixture', summary: 'summary fixture' }, events: [{ kind: 'request', agent: 'compactor' }, ...Array.from({ length: 3 }, () => ({ kind: 'request', agent: 'main' }))] }
  const bytes = JSON.stringify(recorded)
  const review = { reviewer: 'unit-test fixture', summaryEvidence: 'compactor.summary and original anchor were compared', coverageEvidence: 'fixture only, not browser proof', limits: 'No model or browser was executed by this test', summaryFaithful: true, stableIdentity: true, activeCompletedReloadCovered: true, noOwnerSteering: true, receiptSha256: 'cannot override' }
  expect(reviewReceipt(bytes, review).receiptSha256).toBe(sha256(bytes))
  expect(reviewReceipt(bytes, { ...review, summaryFaithful: false }).passed).toBe(false)
  expect(() => reviewReceipt(bytes, { ...review, coverageEvidence: '' })).toThrow('coverageEvidence')
  expect(() => reviewReceipt(JSON.stringify({ evaluation: 'immutable-repair-v1', assessment: { status: 'needs-independent-review', checks: {} } }), review)).toThrow('Incomplete machine evidence')
  expect(() => reviewReceipt(JSON.stringify({ ...recorded, checks: [{ phase: 'baseline', receipt: baseline }, { phase: 'main', receipt: { ...repaired, assertions: [], results: [] } }] }), review)).toThrow('Malformed artifact evidence')
  expect(() => reviewReceipt(JSON.stringify({ ...recorded, events: [] }), review)).toThrow('Request counts')
  expect(reviewReceipt(JSON.stringify({ ...recorded, counts: { main: 0, compactor: 1, inspections: 2 }, events: [{ kind: 'request', agent: 'compactor' }] }), review).passed).toBe(false)
})

test('diagnostic cannot start even baseline inspection without explicit inference authorization', async () => {
  await expect(runDiagnostic({})).rejects.toThrow('Inference is disabled')
})

test('evaluation explicitly pins authorized Qwen settings while retaining the production compactor output override', () => {
  const catalogue = modelCatalogue()
  expect(resolve({}, catalogue)).toMatchObject({ model: 'Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp', baseUrl: 'http://127.0.0.1:8873/v1', maxOutputTokens: 8192, contextLength: 32768, temperature: 0, requestParams: { chat_template_kwargs: { enable_thinking: false } } })
  expect(resolve({ maxOutputTokens: 2048 }, catalogue).maxOutputTokens).toBe(2048)
  catalogue.models['repair-evaluation'].request_params.chat_template_kwargs.enable_thinking = true
  expect(modelCatalogue().models['repair-evaluation'].request_params.chat_template_kwargs.enable_thinking).toBe(false)
})

test('added build inputs fail source preservation even when recorded file hashes still match', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'askk-repair-source-'))
  try {
    await writeFile(join(directory, 'page.js'), 'original')
    const files = [{ path: 'page.js', rev: sha256('original') }]
    await verifySource(directory, files)
    await writeFile(join(directory, '.env'), 'ALTERED_BUILD=true')
    await expect(verifySource(directory, files)).rejects.toThrow('Unexpected source input')
    await rm(join(directory, '.env'))
    await writeFile(join(directory, 'page.js'), 'modified')
    await expect(verifySource(directory, files)).rejects.toThrow('Source changed')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
