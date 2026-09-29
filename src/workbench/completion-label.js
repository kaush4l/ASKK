/** Shared presentation for the desk's registered completion adapters. */
export function completionCheckLabel(check) {
  if (check.capability === 'workspace.artifact') return `Workspace artifact${check.options?.requireFresh ? ' · new build from this task' : ''}${check.options?.requireInteraction ? ' · interaction evidence required' : ''}`
  if (check.capability === 'workspace.command') return `Successful command${check.options?.requireFresh ? ' · current source checked in this task' : ''} · functional correctness needs task-specific checks`
  return `Unsupported check: ${check.capability}`
}
