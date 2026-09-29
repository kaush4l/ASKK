/** Shared presentation for the desk's registered completion adapters. */
export function completionCheckLabel(check) {
  if (check.capability === 'workspace.artifact') return `Workspace artifact${check.options?.requireFresh ? ' · new build from this task' : ''}${check.options?.requireInteraction ? ' · interaction evidence required' : ''}`
  if (check.capability === 'workspace.commands') return `Required commands against current saved source: ${(check.options?.commands ?? []).map(command => JSON.stringify(command.length > 120 ? command.slice(0, 120) + '…' : command)).join(', ')} · proves only their configured assertions`
  if (check.capability === 'workspace.command') return `Successful command${check.options?.requireFresh ? ' · current source checked in this task' : ''} · functional correctness needs task-specific checks`
  return `Unsupported check: ${check.capability}`
}
