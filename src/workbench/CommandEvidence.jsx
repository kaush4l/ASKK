export function commandStatusLabel(command) {
  if (command.stage === 'outcome-unknown') return 'Outcome unknown · exit unconfirmed'
  if (command.timedOut === true) return `Time limit reached${Number.isInteger(command.exitCode) ? ` · exit code ${command.exitCode}` : ''}${command.stage === 'reconciliation-failed' ? ' · workspace sync failed' : ''}`
  if (command.stage === 'reconciliation-failed') return `${Number.isInteger(command.exitCode) ? `Exited with code ${command.exitCode}` : 'Exit recorded'} · workspace sync failed`
  return `${command.status}${command.exitCode != null ? ` (${command.exitCode})` : ''}`
}

export default function CommandEvidence({ command }) {
  if (!command || command.timedOut !== true && !['outcome-unknown', 'reconciliation-failed'].includes(command.stage)) return null
  const error = typeof command.error === 'string' ? command.error : command.error?.message || ''
  const detail = String(error).slice(0, 500)
  return <p className="composer-hint" role="status" aria-label="Command outcome">{commandStatusLabel(command)}.{detail && <> {detail}{String(error).length > 500 ? '…' : ''}</>}</p>
}
