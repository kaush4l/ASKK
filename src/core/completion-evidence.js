/** Small dashboard projection. Exact receipts remain in run inspection. */
export function projectCompletionEvidence(run = {}) {
  const configured = Array.isArray(run.completion?.checks) ? run.completion.checks : null
  const receipts = Array.isArray(run.completionReceipts) ? run.completionReceipts : []
  const receipt = receipts.at(-1)
  if (!receipt) return { outcome: 'unknown', label: configured ? configured.length ? 'No completion checks recorded' : 'No completion checks configured' : 'Completion configuration not recorded' }
  const checks = Array.isArray(receipt.checks) ? receipt.checks : []
  const prefix = `Latest recorded check${checks.length === 1 ? '' : 's'}: `
  if (receipt.ok === false || checks.some(check => check.ok === false)) return { outcome: 'failed', label: `${prefix}did not pass` }
  if (!checks.length) return { outcome: 'unknown', label: `${prefix}no checks performed` }
  if (receipt.ok !== true || checks.some(check => check.ok !== true)) return { outcome: 'unknown', label: `${prefix}outcome not recorded` }
  const capabilities = checks.map(check => check.capability)
  const scope = capabilities.every(capability => capability === 'workspace.command') ? 'Command check passed · behavior not verified'
    : capabilities.every(capability => capability === 'workspace.commands') ? 'Required command checks passed · behavior not verified'
      : 'Scoped checks passed · only recorded requirements checked'
  return { outcome: 'passed', label: `Latest recorded: ${scope}` }
}
