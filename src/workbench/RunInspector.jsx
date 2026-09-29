'use client'
import { useMemo, useState } from 'react'
import Modal from './Modal.jsx'
import ToolCard from './ToolCard.jsx'
import { projectRunTools } from './run-evidence.js'
import './run-inspector.css'

const textOf = value => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value, null, 2)
const labelOf = status => ({ queued: 'Queued', starting: 'Starting', thinking: 'Thinking', calling: 'Using a tool', waiting: 'Waiting', compacting: 'Organizing context', running: 'Running', verifying: 'Verifying application', interrupted: 'Interrupted', incomplete: 'Incomplete', cancelled: 'Stopped', cancelling: 'Stopping', done: 'Completed', completed: 'Completed', failed: 'Failed' })[status] || status || 'Not recorded'

/** Large records mount only after a deliberate expansion. */
function Record({ title, value }) {
  const [open, setOpen] = useState(false)
  return <details className="run-record" onToggle={event => setOpen(event.currentTarget.open)}><summary>{title}</summary>{open && <pre>{textOf(value)}</pre>}</details>
}
function Records({ title, records, label, empty }) {
  const [limit, setLimit] = useState(12)
  return <section className="run-record-section"><h3>{title} <span>{records.length}</span></h3>{records.length ? <>{records.slice(0, limit).map((record, index) => <Record key={index} title={label(record, index)} value={record}/>)}{records.length > limit && <button type="button" className="button subtle small" onClick={() => setLimit(previous => previous + 12)}>Show more {title.toLowerCase()}</button>}</> : <p>{empty}</p>}</section>
}

export default function RunInspector({ details, onClose, onRefresh, onInspectRun, onExport }) {
  const [toolLimit, setToolLimit] = useState(12)
  const [action, setAction] = useState('')
  const [error, setError] = useState('')
  const { tools, unpaired } = useMemo(() => projectRunTools(details), [details])
  const prompts = details.prompts || []
  const runError = details.error || details.slot?.error
  async function perform(name, callback) {
    if (action) return
    setAction(name); setError('')
    try { await callback() } catch (failure) { setError(failure.message || String(failure)) }
    finally { setAction('') }
  }
  return <Modal wide title={`${details.name || details.agent || 'Agent'} · Recorded run`} onClose={onClose}>
    <p className="modal-description">A snapshot of this instance’s recorded work. Inspect instructions, tool receipts, and results; refresh to read newer records.</p>
    <div className="run-inspector-actions">
      {onRefresh && <button type="button" className="button subtle small" disabled={Boolean(action)} onClick={() => perform('refresh', onRefresh)}>{action === 'refresh' ? 'Refreshing…' : 'Refresh snapshot'}</button>}
      {onExport && <button type="button" className="button subtle small" disabled={Boolean(action)} onClick={() => perform('export', onExport)}>{action === 'export' ? 'Exporting…' : 'Export this trace'}</button>}
    </div>
    {error && <p className="run-inspector-error" role="alert">{error}</p>}
    <div className="agent-inspector run-inspector" key={details.id}>
      <dl className="run-identity"><div><dt>Status</dt><dd>{labelOf(details.slot?.status || details.status)}</dd></div><div><dt>Instance</dt><dd>{details.id}</dd></div>{details.trace && <div><dt>Task trace</dt><dd>{details.trace}</dd></div>}{details.stageId && <div><dt>Configured role</dt><dd>{details.stageId}</dd></div>}{details.parent && <div><dt>Parent run</dt><dd>{onInspectRun ? <button type="button" className="dashboard-inline" onClick={() => perform('parent', () => onInspectRun(details.parent))} disabled={Boolean(action)}>{details.parent}</button> : details.parent}</dd></div>}</dl>
      {details.package && <Record title="Pinned agent package" value={details.package}/>}
      <h3>Assigned task</h3><pre>{textOf(details.query) || 'No task was recorded.'}</pre>
      {runError && <><h3>Recorded error</h3><pre>{textOf(runError)}</pre></>}
      <h3>Recorded result</h3><pre>{details.result == null ? 'No result was recorded.' : textOf(details.result)}</pre>
      <section className="run-record-section"><h3>Tool activity <span>{tools.length}</span></h3>
        <p>Results pair only with their recorded call identities. A parent link identifies a run relationship, not a message delivery acknowledgement.</p>
        {tools.length ? tools.slice(0, toolLimit).map((tool, index) => <div className="run-recorded-tool" key={`${tool.id}:${index}`}><ToolCard tool={tool}/><Record title="Exact tool records" value={tool.raw}/></div>) : <p>No tool calls were recorded for this instance.</p>}
        {tools.length > toolLimit && <button type="button" className="button subtle small" onClick={() => setToolLimit(previous => previous + 12)}>Show more tool calls</button>}
      </section>
      {unpaired.length > 0 && <Records title="Unpaired tool records" records={unpaired} label={(_, index) => `Unpaired record ${index + 1}`} empty=""/>}
      <Records title="Recorded guidance" records={details.notes || []} label={(_, index) => `Received note ${index + 1}`} empty="No received notes were recorded in this run’s history."/>
      <Records title="Historical prompts" records={prompts} label={(prompt, index) => `Prompt ${index + 1}${prompt.step != null ? ` · Step ${prompt.step}` : ''}${prompt.attempt != null ? ` · Attempt ${prompt.attempt}` : ''}`} empty="No prompt records are available for this run."/>
      <p>Prompt records show the model input at that time. Provider requests below keep retries separate and redact transport secrets.</p>
      <Records title="Provider requests" records={details.requests || []} label={(_, index) => `Request ${index + 1}`} empty="No provider request records are available."/>
      <Records title="Provider completions" records={details.completions || []} label={(_, index) => `Completion ${index + 1}`} empty="No provider completion records are available."/>
    </div>
  </Modal>
}
