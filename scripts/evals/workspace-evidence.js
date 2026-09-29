import { selectRequiredCommands, requiredCommandReason } from '../../src/core/command-checks.js'
import { normalizeCompletion } from '../../src/core/completion.js'
const AGENT_COMMAND_TIMEOUT_SECONDS = 30
/** Real execution receipts for evaluations; no model text can create completion evidence. */
export function createEvaluationWorkspace(execution) {
  const commands = []
  const bound = execution.describeCapabilities()
  let running = 0, writing = 0, epoch = 0
  const assertRuntime = () => {
    const current = execution.describeCapabilities()
    if (!bound.runtimeId || current.runtimeId !== bound.runtimeId || current.root !== bound.root) throw new Error('Evaluation execution binding changed')
  }
  async function revision() {
    assertRuntime()
    const snapshot = await execution.snapshot('')
    assertRuntime()
    if (typeof snapshot.revision !== 'string' || !snapshot.revision) throw new Error('Workspace snapshot has no revision')
    return snapshot.revision
  }
  return {
    commands, revision,
    async write(args) {
      writing++; epoch++
      try { assertRuntime(); return await execution.write(args) }
      finally { writing--; epoch++ }
    },
    async run(command, run) {
      const id = crypto.randomUUID(), inputEpoch = epoch
      let output = ''
      running++
      const receipt = { id, command, runId: run.id, trace: run.trace ?? run.id, runtimeId: bound.runtimeId, stage: 'starting', startedAt: Date.now() }
      commands.push(receipt)
      try {
        receipt.inputRevision = await revision()
        if (writing || epoch !== inputEpoch) throw new Error('Source changed while preparing the command; run it again')
        receipt.stage = 'running'
        const result = await execution.startJob({ id, program: '/bin/sh', args: ['-c', command], timeout: AGENT_COMMAND_TIMEOUT_SECONDS, onOutput: event => { output += event.data ?? event.text ?? '' } })
        if (result.runtimeId !== bound.runtimeId) throw new Error('Command receipt came from a different execution runtime')
        const completedRevision = await revision()
        Object.assign(receipt, result, { id, output, completedRevision, completedEpoch: epoch, finishedAt: Date.now(), sourceUnchanged: !writing && epoch === inputEpoch && receipt.inputRevision === completedRevision, stage: 'complete' })
        return { ...receipt }
      } catch (error) {
        Object.assign(receipt, { stage: 'failed', output, error: error.message })
        throw error
      } finally { running-- }
    },
    async checkRequired(options, run) {
      const required = normalizeCompletion({ checks: [{ capability: 'workspace.commands', options }] }).checks[0].options.commands
      const reject = reason => ({ ok: false, reason })
      if (running || writing) return reject('Wait for commands and writes to finish before checking required commands.')
      const owns = row => row.trace === (run.trace ?? run.id)
      const selected = selectRequiredCommands(commands, required, owns)
      for (const [index, command] of selected.entries()) {
        if (!command || command.stage !== 'complete' || command.code !== 0 || command.cancelled || command.timedOut) return reject(requiredCommandReason(required[index], command ? { ...command, exitCode: command.code } : null))
      }
      const before = epoch, currentRevision = await revision()
      const latest = selectRequiredCommands(commands, required, owns)
      if (running || writing || before !== epoch || selected.some((command, index) => latest[index]?.id !== command.id || !command.sourceUnchanged || command.completedEpoch !== epoch || command.completedRevision !== currentRevision)) return reject('Required commands must all pass against the current saved source; rerun them after edits.')
      return { ok: true, reason: 'All configured command receipts passed; this proves only their assertions.', evidence: { sourceRevision: currentRevision, commands: selected.map(command => ({ commandId: command.id, command: command.command, exitCode: command.code, runtimeId: command.runtimeId, sourceRevision: command.completedRevision })) } }
    },
    async check({ requireFresh = true } = {}, run) {
      const reject = reason => ({ ok: false, reason })
      if (running || writing) return reject('Wait for commands and writes to finish before completing.')
      const command = commands.findLast(row => row.trace === (run.trace ?? run.id))
      if (!command || command.stage !== 'complete' || command.code !== 0 || command.cancelled || command.timedOut) return reject('This task needs a completed command with a recorded zero exit code.')
      const before = epoch, currentRevision = await revision()
      if (running || writing || before !== epoch || commands.findLast(row => row.trace === (run.trace ?? run.id)) !== command) return reject('The workspace changed during completion checks; run the checks again.')
      if (requireFresh && (!command.sourceUnchanged || command.completedEpoch !== epoch || command.completedRevision !== currentRevision)) return reject('Run the checks again against the current saved files; the source changed during or after the previous command.')
      return { ok: true, commandId: command.id, sourceRevision: currentRevision, reason: 'A task-owned command exited zero against this source snapshot. Functional correctness requires the independent checks.', evidence: { commandId: command.id, command: command.command, runId: command.runId, trace: command.trace, runtimeId: bound.runtimeId, inputRevision: command.inputRevision, completedRevision: command.completedRevision, completedEpoch: epoch, finishedAt: Date.now(), sourceUnchanged: command.sourceUnchanged, matchesAtCompletion: command.completedRevision === currentRevision && command.completedEpoch === epoch } }
    },
  }
}

/** Benchmark's explicit declared-script invocation; never parse arbitrary shell prose as evidence. */
export function ranDeclaredTests(commands, run, revision) {
  const command = commands.findLast(row => row.trace === (run.trace ?? run.id) && /^bun(?: --bun)? run test$/.test(row.command?.trim() ?? ''))
  return Boolean(command && /^bun(?: --bun)? run test$/.test(command.command?.trim() ?? '') && command.stage === 'complete' && command.code === 0 && !command.cancelled && !command.timedOut && command.sourceUnchanged === true && command.completedRevision === revision)
}

/** Read the pinned Bun reporter's top-level counts, not printed test output. */
export function bunTestReport(xml) {
  const header = /^\s*(?:<\?xml[^?]*\?>\s*)?<testsuites\b([^>]*)>/.exec(xml)
  if (!header || !/<\/testsuites>\s*$/.test(xml)) return { passed: false, reason: 'Missing complete Bun JUnit report' }
  const fields = Object.fromEntries([...header[1].matchAll(/([a-z]+)="([^"]*)"/g)].map(match => [match[1], match[2]]))
  const counts = Object.fromEntries(['tests', 'skipped', 'failures'].map(key => [key, /^\d+$/.test(fields[key] ?? '') ? Number(fields[key]) : NaN]))
  if (Object.values(counts).some(value => !Number.isSafeInteger(value)) || counts.skipped > counts.tests) return { passed: false, reason: 'Invalid Bun JUnit counts' }
  const executed = counts.tests - counts.skipped
  return { ...counts, executed, passed: executed > 0 && counts.failures === 0 && (!fields.errors || fields.errors === '0') }
}
