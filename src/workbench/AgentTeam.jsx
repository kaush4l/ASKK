'use client'

import { useId, useMemo, useState } from 'react'
import Icon from './Icons.jsx'
import './agent-team.css'

const LIVE = new Set(['queued', 'starting', 'thinking', 'calling', 'running', 'waiting', 'compacting', 'cancelling', 'verifying', 'unresponsive'])
const LABELS = { queued: 'Queued', starting: 'Starting', thinking: 'Thinking', calling: 'Using a tool', running: 'Running', waiting: 'Waiting', compacting: 'Organizing context', cancelling: 'Stopping', verifying: 'Verifying application', unresponsive: 'Response delayed', done: 'Completed', completed: 'Completed', verified: 'Verified', failed: 'Failed', error: 'Failed', incomplete: 'Incomplete', cancelled: 'Stopped', stopped: 'Stopped', interrupted: 'Interrupted', skipped: 'Skipped', idle: 'Idle', ready: 'Ready' }
const SUCCESS = new Set(['done', 'completed', 'verified'])
const PROBLEM = new Set(['failed', 'error', 'incomplete', 'interrupted', 'unresponsive'])
const identityOf = run => run.path || run.agent || ''
const text = value => typeof value === 'string' ? value : ''
const timeOf = run => Number.isFinite(run.at) ? run.at : 0
const activityPreview = value => {
  if (value.length <= 280) return value
  // Avoid splitting a UTF-16 surrogate pair at the visible excerpt boundary.
  const end = /[\uD800-\uDBFF]/.test(value[279]) ? 279 : 280
  return `${value.slice(0, end).trimEnd()}…`
}
const initialCount = { live: 8, recent: 6 }

/** Only recorded identities establish membership; names and descriptions never do. */
export function projectAgentTeam({ runs = [], definitions = [], approvals = [], activeRunId } = {}) {
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
    const pending = live ? approvals.filter(approval => (approval.runId ?? approval.run) === run.id).length : 0
    const parent = index.get(run.parent)
    const status = pending && !['cancelling', 'unresponsive'].includes(run.status) ? 'Awaiting your approval' : LABELS[run.status] || 'Status unavailable'
    return { run, name: nameOf(run), identity: identityOf(run), live, status, pending, selected: belongs(run), parentName: parent ? nameOf(parent) : '', parentAvailable: Boolean(parent), parentLabel: parent?.kind === 'strategy' || run.stageId || run.kind === 'strategy-role' ? 'Parent run' : 'Delegated by', tone: PROBLEM.has(run.status) ? 'problem' : SUCCESS.has(run.status) ? 'complete' : live ? 'live' : 'neutral' }
  })
  // Creation order keeps live cards still as their tools/status change. Only an
  // actual terminal transition moves a card from live instances to recent runs.
  const byTime = direction => (a, b) => direction * (timeOf(a.run) - timeOf(b.run)) || String(a.run.id).localeCompare(String(b.run.id))
  return { live: items.filter(item => item.live).sort(byTime(1)), recent: items.filter(item => !item.live).sort(byTime(-1)), selectedCount: items.filter(item => item.selected).length, total: items.length }
}

export function AgentInstance({ item, onInspectRun, onInspectAgent, onStopAgent }) {
  const { run, name, identity, live, status, pending, selected, parentName, parentAvailable, parentLabel, tone } = item
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => [...part][0]).join('').toLocaleUpperCase()
  const activity = activityPreview(text(run.current).trim() || text(run.description).trim())
  const hasResult = run.result !== undefined && run.result !== null && run.result !== ''
  return <li className={`agent-instance tone-${tone}`} data-run-id={run.id}>
    <button className="agent-instance-open" type="button" onClick={() => onInspectRun?.(run.id)} disabled={!onInspectRun} aria-label={`Inspect ${name} run ${run.id}`}>
      <span className="agent-instance-avatar" aria-hidden="true">{initials || <Icon name="agents" size={17}/>}<i/></span>
      <span className="agent-instance-identity"><strong>{name}</strong><span className="agent-instance-status"><i aria-hidden="true"/>{status}</span></span>
      <Icon className="agent-instance-chevron" name="right" size={14}/>
      <span className="agent-instance-task">{activity || (live ? 'No activity detail recorded yet.' : hasResult ? 'Recorded result available to inspect.' : 'No activity detail recorded.')}</span>
      <span className="agent-instance-id" title={run.id}>Run {run.id}</span>
    </button>
    <div className="agent-instance-relation">
      {run.parent ? <><Icon name="changes" size={13}/><span>{parentLabel} {parentAvailable && onInspectRun ? <button type="button" onClick={() => onInspectRun(run.parent)} aria-label={`Inspect parent ${parentName} run ${run.parent}`}>{parentName}</button> : parentAvailable ? parentName : <span className="agent-instance-missing">parent record unavailable</span>}</span></> : <><Icon name="agents" size={13}/><span>No parent recorded</span></>}
    </div>
    <div className="agent-instance-tags">{selected && <span>Selected task</span>}{pending > 0 && <span className="agent-instance-approval">{pending} pending {pending === 1 ? 'decision' : 'decisions'}</span>}{hasResult && !live && <span>Result recorded</span>}</div>
    <div className="agent-instance-actions">
      {identity && onInspectAgent && <button type="button" onClick={() => onInspectAgent(identity)}>Instructions<Icon name="right" size={12}/></button>}
      {live && onStopAgent && <button type="button" className="agent-instance-stop" disabled={run.status === 'cancelling'} onClick={() => onStopAgent(run.id)} aria-label={`Stop ${name} run ${run.id}`}><Icon name="stop" size={12}/>{run.status === 'cancelling' ? 'Stopping…' : 'Stop run'}</button>}
    </div>
  </li>
}

/** Run-instance projection only. No agent execution, inferred messages or idle catalogue entries. */
export default function AgentTeam({ runs = [], definitions = [], approvals = [], activeRunId, onInspectRun, onInspectAgent, onStopAgent }) {
  const heading = useId()
  const [visible, setVisible] = useState(initialCount)
  const team = useMemo(() => projectAgentTeam({ runs, definitions, approvals, activeRunId }), [runs, definitions, approvals, activeRunId])
  const callbacks = { onInspectRun, onInspectAgent, onStopAgent }
  return <section className="agent-team" aria-labelledby={heading}>
    <header className="agent-team-heading"><div><span className="agent-team-eyebrow">PEOPLE IN THE LOOP · AGENTS AT WORK</span><h2 id={heading}>Your live team</h2></div><span className="agent-team-count" role="status">{team.live.length ? `${team.live.length} active` : 'No active runs'}</span></header>
    <p className="agent-team-description">Each card is one run. Open it for recorded prompts, tool receipts and results.{team.selectedCount > 0 && <span>{team.selectedCount} {team.selectedCount === 1 ? 'instance belongs' : 'instances belong'} to the selected task.</span>}</p>
    {!team.total && <div className="agent-team-empty"><span><Icon name="agents" size={21}/></span><div><strong>Your team will appear here.</strong><p>Start a task to see its lead and any agents it actually calls.</p></div></div>}
    {(['live', 'recent']).map(group => {
      const items = team[group]
      if (!items.length) return null
      const count = Math.min(visible[group], items.length)
      const listId = `${heading}-${group}`
      return <div className="agent-team-group" key={group}>
        <div className="agent-team-group-heading"><h3>{group === 'live' ? 'Live instances' : 'Recent runs'}</h3><span>{count} of {items.length}</span></div>
        <ul className="agent-team-grid" id={listId}>{items.slice(0, count).map(item => <AgentInstance key={item.run.id} item={item} {...callbacks}/>)}</ul>
        {count < items.length && <button className="agent-team-more" type="button" aria-controls={listId} onClick={() => setVisible(value => ({ ...value, [group]: value[group] + initialCount[group] }))}>Show {Math.min(initialCount[group], items.length - count)} more {group === 'live' ? 'active runs' : 'recent runs'}<Icon name="down" size={13}/></button>}
      </div>
    })}
  </section>
}
