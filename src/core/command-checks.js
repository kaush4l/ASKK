import { snapshot } from './prompt.js'

/** Select evidence only; configured commands never execute through this helper.
 * Records are ordered oldest to newest. Each required exact command gets its
 * latest owned receipt, even when that receipt failed after an earlier success.
 */
export function selectRequiredCommands(records, required, owns) {
  return snapshot(required.map(command => records.findLast(record => record?.command === command && owns(record)) ?? null))
}

/** A bounded diagnostic for a receipt rejected by the trusted completion adapter. */
export function requiredCommandReason(command, receipt) {
  const label = JSON.stringify(command)
  if (!receipt) return `This task has no receipt for required command ${label}. Run it using the available permitted tools.`
  const details = receipt.cancelled ? 'was cancelled' : receipt.timedOut ? 'timed out' : receipt.exitCode !== 0 ? `exited with ${receipt.exitCode ?? 'no recorded exit code'}` : `has status ${receipt.status ?? 'unknown'} and stage ${receipt.stage ?? 'unknown'}`
  const output = typeof receipt.output === 'string' ? receipt.output.slice(-1000).trim() : ''
  return `Required command ${label} ${details}. Run it successfully against the current saved files.${output ? `\n${output}` : ''}`
}
