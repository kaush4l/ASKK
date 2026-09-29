'use client'

import { useId, useMemo, useState } from 'react'
import Icon from './Icons.jsx'
import { toolPresentationStatus } from './ToolCard.jsx'
import { projectCompletionEvidence } from '../core/completion-evidence.js'
import './agent-team.css'

const LIVE = new Set(['queued', 'starting', 'thinking', 'calling', 'running', 'waiting', 'compacting', 'cancelling', 'verifying', 'unresponsive'])
const LABELS = { queued: 'Queued', starting: 'Starting', thinking: 'Generating reply', calling: 'Using a tool', running: 'Running', waiting: 'Waiting', compacting: 'Organizing context', cancelling: 'Stopping', verifying: 'Verifying', unresponsive: 'Response delayed', done: 'Agent finished', completed: 'Agent finished', verified: 'Agent finished', failed: 'Failed', error: 'Failed', incomplete: 'Incomplete', cancelled: 'Stopped', stopped: 'Stopped', interrupted: 'Interrupted', skipped: 'Skipped', idle: 'Idle', ready: 'Ready' }
const TOOL_LABELS = { running: 'Running', waiting: 'Waiting', awaiting_approval: 'Awaiting approval', done: 'Completed', completed: 'Completed', success: 'Completed', failed: 'Failed', error: 'Failed', interrupted: 'Interrupted', cancelled: 'Stopped', unresolved: 'Outcome not recorded' }
const PROBLEM = new Set(['failed', 'error', 'incomplete', 'interrupted', 'unresponsive'])
const STOP_REASONS = new Map([['step_budget', 'Step limit reached'], ['context_budget', 'Context limit reached'], ['invalid_response', 'Invalid model reply']])
const identityOf = run => run.path || run.agent || ''
const text = value => typeof value === 'string' ? value : ''
const timeOf = run => Number.isFinite(run.at) ? run.at : 0
const activityPreview = value => {
  if (value.length <= 280) return value
  // Avoid splitting a UTF-16 surrogate pair at the visible excerpt boundary.
  const end = /[\uD800-\uDBFF]/.test(value[279]) ? 279 : 280
  return `${value.slice(0, end).trimEnd()}…`
}
const initialCount = { current: 6, recent: 6 }

/** Only recorded identities establish membership; names and descriptions never do. */
export function projectAgentTeam({ runs = [], definitions = [], approvals = [], tools = [], activeRunId } = {}) {
  const latestTools = new Map()
  for (const tool of tools) if (tool?.runId && tool?.id) latestTools.set(tool.runId, tool)
  const index = new Map(runs.filter(run => run?.id).map(run => [run.id, run]))
  const records = [...index.values()].filter(run => run.kind !== 'strategy')
  const selected = index.get(activeRunId)
  const selectedTask = selected?.taskId || activeRunId
  function belongs(run) {
    if (!activeRunId) return false
    if (run.id === activeRunId || selectedTask && run.taskId === selectedTask || selected?.trace && run.trace === selected.trace) return true
    const seen = new Set([run.id])
    let parent = run.parent
    while (parent && !seen.has(parent)) {
      if (parent === activeRunId) return true
      seen.add(parent); parent = index.get(parent)?.parent
    }
    return false
  }
  function nameOf(run) {
    const identity = identityOf(run)
    const definition = identity ? definitions.find(item => item.path === identity) : definitions.find(item => item.name === run.name)
    return text(definition?.name) || text(run.name) || (identity ? identity.split('/').at(-1).replace(/[_-]/g, ' ') : 'Agent')
  }
  const items = records.map(run => {
    const live = LIVE.has(run.status)
    const decisions = live ? approvals.filter(approval => (approval.runId ?? approval.run) === run.id) : []
    const pending = decisions.length
    const parent = index.get(run.parent)
    const needsDecision = pending > 0 && !['cancelling', 'unresponsive'].includes(run.status)
    const stopReason = ['failed', 'incomplete'].includes(run.status) ? STOP_REASONS.get(run.terminationReason) : null
    const status = needsDecision ? 'Needs your decision' : `${LABELS[run.status] || 'Status unavailable'}${stopReason ? ` · ${stopReason}` : ''}`
    const tone = PROBLEM.has(run.status) ? 'problem' : needsDecision ? 'decision' : live ? 'live' : 'neutral'
    const icon = run.status === 'cancelling' ? 'stop' : tone === 'problem' || needsDecision ? 'warning' : run.status === 'calling' ? 'bolt' : null
    return { run, tool: latestTools.get(run.id), toolStatus: latestTools.has(run.id) ? toolPresentationStatus(latestTools.get(run.id), approvals) : null, name: nameOf(run), identity: identityOf(run), definitionAvailable: definitions.some(definition => definition.path === identityOf(run)), live, status, pending, decisions, selected: belongs(run), parentName: parent ? nameOf(parent) : '', parentAvailable: Boolean(parent), parentLabel: parent?.kind === 'strategy' || run.stageId || run.kind === 'strategy-role' ? 'Parent run' : 'Delegated by', tone, icon }
  })
  // Selected-task slots survive terminal transitions. Selection and the current
  // roster are the only sources of membership; no old task is retained in state.
  const byTime = direction => (a, b) => direction * (timeOf(a.run) - timeOf(b.run)) || String(a.run.id).localeCompare(String(b.run.id))
  const current = items.filter(item => item.live || item.selected).sort(byTime(1))
  return { current, live: items.filter(item => item.live).sort(byTime(1)), recent: items.filter(item => !item.live && !item.selected).sort(byTime(-1)), attention: current.filter(item => item.pending || item.tone === 'problem'), selectedCount: items.filter(item => item.selected).length, total: items.length }
}

export function AgentInstance({ item, instanceId, detailsOpen = false, onToggleDetails, onInspectRun, onInspectAgent, onStopAgent, onReviewApproval, onOpenTool }) {
  const { run, tool, toolStatus, name, identity, definitionAvailable, live, status, pending, decisions, selected, parentName, parentAvailable, parentLabel, tone, icon } = item
  const toolLabel = tool ? String(tool.name || 'Tool action').replace(/[_.]/g, ' ').replace(/^\w/, letter => letter.toUpperCase()) : ''
  const toolOutcome = TOOL_LABELS[toolStatus] || toolStatus || 'Outcome not recorded'
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => [...part][0]).join('').toLocaleUpperCase()
  const activity = activityPreview(text(run.current).trim() || text(run.description).trim())
  const completionEvidence = run.completionEvidence || projectCompletionEvidence(run)
  const hasResult = run.result !== undefined && run.result !== null && run.result !== ''
  const descriptionId = instanceId || `agent-run-${encodeURIComponent(run.id)}`
  return <li className={`agent-instance tone-${tone}`} data-run-id={run.id}>
    <button className="agent-instance-open" type="button" onClick={() => onInspectRun?.(run.id)} disabled={!onInspectRun} aria-label={`Inspect ${name} run ${run.id}`} aria-describedby={`${descriptionId}-status ${descriptionId}-activity ${descriptionId}-completion`}>
      <span className="agent-instance-avatar" aria-hidden="true">{initials || <Icon name="agents" size={17}/>}<i/></span>
      <span className="agent-instance-identity"><strong>{name}</strong><span className="agent-instance-status" id={`${descriptionId}-status`}>{icon ? <Icon name={icon} size={13}/> : <i aria-hidden="true"/>}{status}</span></span>
      <Icon className="agent-instance-chevron" name="right" size={14}/>
      <span className="agent-instance-task" id={`${descriptionId}-activity`}>{activity || (live ? 'No activity detail recorded yet.' : hasResult ? 'Recorded result available to inspect.' : 'No activity detail recorded.')}</span>
    </button>
    <p id={`${descriptionId}-completion`} className={`agent-instance-completion${completionEvidence.outcome === 'failed' ? ' is-failed' : ''}`}>{completionEvidence.label}{live && completionEvidence.outcome === 'passed' ? ' · current run still in progress' : ''}</p>
    <div className="agent-instance-tags"><span className="agent-instance-suffix" title={run.id}>#{String(run.id).slice(-8)}</span>{selected && <span>Selected task</span>}</div>
    <div className="agent-instance-attention">{pending > 0 && (onReviewApproval && decisions[0]?.id ? <button type="button" onClick={() => onReviewApproval(decisions[0].id)} aria-label={`Review ${pending} pending ${pending === 1 ? 'decision' : 'decisions'} for ${name} run ${run.id}`}><Icon name="warning" size={13}/>{pending} pending {pending === 1 ? 'decision' : 'decisions'}<Icon name="right" size={12}/></button> : <span><Icon name="warning" size={13}/>{pending} pending {pending === 1 ? 'decision' : 'decisions'}</span>)}{!pending && tool && (onOpenTool ? <button className="agent-instance-tool" type="button" onClick={() => onOpenTool(tool)} aria-label={`Inspect latest tool ${toolLabel} · ${toolOutcome} for ${name} run ${run.id}`} title={`${toolLabel} · ${toolOutcome}`}><Icon name="bolt" size={13}/><span>{toolLabel}</span><small>{toolOutcome}</small><Icon name="right" size={12}/></button> : <span className="agent-instance-tool" title={`${toolLabel} · ${toolOutcome}`}><Icon name="bolt" size={13}/><span>{toolLabel}</span><small>{toolOutcome}</small></span>)}</div>
    <details className="agent-instance-details" open={detailsOpen}>
      <summary onClick={event => { if (onToggleDetails) { event.preventDefault(); onToggleDetails(run.id, !detailsOpen) } }}>Run details &amp; actions<Icon name="down" size={13}/></summary>
      <div className="agent-instance-evidence">
        <span className="agent-instance-id">Run {run.id}</span>
        <div className="agent-instance-relation">
          {run.parent ? <><Icon name="changes" size={13}/><span>{parentLabel} {parentAvailable && onInspectRun ? <button type="button" onClick={() => onInspectRun(run.parent)} aria-label={`Inspect parent ${parentName} run ${run.parent}`}>{parentName}</button> : parentAvailable ? parentName : <span className="agent-instance-missing">parent record unavailable</span>}<span className="agent-instance-parent-id">{run.parent}</span></span></> : <><Icon name="agents" size={13}/><span>No parent recorded</span></>}
        </div>
        <span className="agent-instance-result">{hasResult && !live ? 'Result recorded' : ''}</span>
        <div className="agent-instance-actions">
          {identity && definitionAvailable && onInspectAgent && <button type="button" onClick={() => onInspectAgent(identity)}>Instructions<Icon name="right" size={12}/></button>}
          {identity && !definitionAvailable && <span className="agent-instance-saved">Definition unavailable</span>}
          {(live || selected) && onStopAgent && <button type="button" className="agent-instance-stop" aria-disabled={!live || run.status === 'cancelling'} onClick={() => { if (live && run.status !== 'cancelling') onStopAgent(run.id) }} aria-label={`${!live ? 'Run ended for' : 'Stop'} ${name} run ${run.id}`}><Icon name="stop" size={12}/>{!live ? 'Run ended' : run.status === 'cancelling' ? 'Stopping…' : 'Stop run'}</button>}
        </div>
      </div>
    </details>
  </li>
}

/** Run-instance projection only. No agent execution, inferred messages or idle catalogue entries. */
export default function AgentTeam({ runs = [], definitions = [], approvals = [], tools = [], activeRunId, onInspectRun, onInspectAgent, onStopAgent, onReviewApproval, onOpenTool }) {
  const heading = useId()
  const [visible, setVisible] = useState(initialCount)
  const [view, setView] = useState('goal')
  const [expanded, setExpanded] = useState({})
  const team = useMemo(() => projectAgentTeam({ runs, definitions, approvals, tools, activeRunId }), [runs, definitions, approvals, tools, activeRunId])
  const callbacks = { onOpenTool, onInspectRun, onInspectAgent, onStopAgent, onReviewApproval, onToggleDetails: (id, open) => setExpanded(value => ({ ...value, [id]: open })) }
  function renderGroup(group) {
    const items = team[group]
    if (!items.length) return null
    const count = Math.min(visible[group], items.length)
    const listId = `${heading}-${group}`
    return <div className="agent-team-group">
      <div className="agent-team-group-heading"><h3>{group === 'current' ? team.selectedCount ? 'Selected task & active runs' : 'Live instances' : 'Recorded runs'}</h3><span>{count} of {items.length}</span></div>
      <ul className="agent-team-grid" id={listId}>{items.slice(0, count).map(item => <AgentInstance key={item.run.id} item={item} instanceId={`${heading}-run-${encodeURIComponent(item.run.id)}`} detailsOpen={expanded[item.run.id] ?? view === 'evidence'} {...callbacks}/>)}</ul>
      {count < items.length && <button className="agent-team-more" type="button" aria-controls={listId} onClick={() => setVisible(value => ({ ...value, [group]: value[group] + initialCount[group] }))}>Show {Math.min(initialCount[group], items.length - count)} more {group === 'current' ? 'task runs' : 'recent runs'}<Icon name="down" size={13}/></button>}
    </div>
  }
  return <section className={`agent-team view-${view}`} aria-labelledby={heading}>
    <header className="agent-team-heading"><div><span className="agent-team-eyebrow">AGENTS AT WORK</span><h2 id={heading}>Your live team</h2></div><span className="agent-team-count" role="status">{team.live.length ? `${team.live.length} active` : 'No active runs'}</span></header>
    <p className="agent-team-description">Actual runs, current activity and recorded outcomes.{team.selectedCount > 0 && <span>{team.selectedCount} {team.selectedCount === 1 ? 'instance belongs' : 'instances belong'} to the selected task.</span>}</p>
    <div className="agent-team-toolbar">
      <div className="agent-team-view" role="group" aria-label="Live team detail level">{['goal', 'evidence'].map(mode => <button type="button" key={mode} aria-pressed={view === mode} onClick={() => setView(mode)}>{mode === 'goal' ? 'Goal' : 'Evidence'}</button>)}</div>
      <details className={`agent-team-attention${team.attention.length ? ' has-attention' : ''}`}>
        <summary><Icon name={team.attention.length ? 'warning' : 'check'} size={14}/><span role="status">{team.attention.length ? `${team.attention.length} ${team.attention.length === 1 ? 'run needs' : 'runs need'} attention` : 'No runs need attention'}</span><Icon name="down" size={12}/></summary>
        <ul>{team.attention.length ? team.attention.map(item => <li key={item.run.id}><button type="button" onClick={() => item.pending && onReviewApproval && item.decisions[0]?.id ? onReviewApproval(item.decisions[0].id) : onInspectRun?.(item.run.id)} disabled={!onInspectRun && !(item.pending && onReviewApproval && item.decisions[0]?.id)} aria-label={`Review ${item.name} run ${item.run.id}`}><strong>{item.name} · #{String(item.run.id).slice(-8)}</strong><span>{item.status}{item.pending ? ` · ${item.pending} pending ${item.pending === 1 ? 'decision' : 'decisions'}` : ''}</span></button></li>) : <li>No pending decisions or recorded problems in the current team.</li>}</ul>
      </details>
    </div>
    {!team.total && <div className="agent-team-empty"><span><Icon name="agents" size={21}/></span><div><strong>Your team will appear here.</strong><p>Start a task to see its lead and any agents it actually calls.</p></div></div>}
    {renderGroup('current')}
    {team.recent.length > 0 && <details className="agent-team-recent"><summary>Recent runs<span>{team.recent.length} recorded</span><Icon name="down" size={13}/></summary>{renderGroup('recent')}</details>}
  </section>
}
