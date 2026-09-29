import Icon from './Icons.jsx'

const titles = {
  workspace_environment: 'Inspect environment', workspace_list: 'List workspace files',
  workspace_read: 'Read file', workspace_write: 'Write file', workspace_patch: 'Edit file',
  workspace_run: 'Run command', workspace_build: 'Build application', workspace_check: 'Check application',
  workspace_delete: 'Delete file', workspace_rename: 'Rename file', todo_write: 'Update task plan', todo_read: 'Read task plan',
}
const labels = { running: 'Running', awaiting_approval: 'Awaiting approval', done: 'Completed', completed: 'Completed', success: 'Completed', failed: 'Failed', error: 'Failed', interrupted: 'Interrupted', cancelled: 'Stopped' }
const stringify = value => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value, null, 2)

/** Presentation only: an approval never replaces the recorded tool outcome. */
export function toolPresentationStatus(tool, approvals = []) {
  if (!['running', 'waiting'].includes(tool.status)) return tool.status
  const pending = approvals.some(approval => approval.run === tool.runId && (approval.callId ? approval.callId === tool.id : approval.call === tool.id))
  return pending ? 'awaiting_approval' : tool.status
}

/** Keep recorded tool data available without making a JSON payload the control's name. */
export default function ToolCard({ tool, approvals, fileAvailable, commandAvailable, artifactAvailable, onFile, onCommand, onArtifact }) {
  const title = titles[tool.name] || String(tool.name || 'Tool action').replace(/[_.]/g, ' ').replace(/^\w/, letter => letter.toUpperCase())
  const presentation = toolPresentationStatus(tool, approvals)
  const status = labels[presentation] || presentation || 'Pending'
  const failed = ['failed', 'error'].includes(tool.status)
  const context = tool.path || tool.command || tool.agent
  const result = stringify(tool.summary)
  const args = stringify(tool.args)
  const complete = ['done', 'completed', 'success'].includes(tool.status)
  const pending = ['running', 'waiting', 'awaiting_approval'].includes(presentation)
  return <details className={`tool-card ${presentation || ''}`}>
    <summary aria-label={`${title} · ${status}${context ? ` · ${context}` : ''}`}>
      <span className="tool-icon"><Icon name={tool.path ? 'files' : tool.command ? 'terminal' : tool.artifactId ? 'globe' : 'bolt'} size={16}/></span>
      <span className="tool-copy"><strong>{title}</strong><small>{context || tool.name}</small></span>
      <span className={`tool-status ${failed ? 'failed' : ''}`}>{complete ? <Icon name="check" size={12}/> : failed ? <Icon name="warning" size={12}/> : null}{status}</span>
      <Icon name="down" size={12} className="tool-disclosure"/>
    </summary>
    <div className="tool-details">
      {args && args !== '{}' && <><h4>Input</h4><pre>{args}</pre></>}
      {presentation === 'awaiting_approval' && <p className="tool-approval-note">This call is waiting for your decision. It has not been approved.</p>}
      <h4>{pending ? 'Current call' : result ? 'Recorded result' : 'Result'}</h4><pre>{result || (pending ? 'Waiting for the tool to return…' : 'No result was recorded.')}</pre>
    </div>
    {(fileAvailable || commandAvailable || artifactAvailable) && <div className="tool-links">
      {fileAvailable && <button type="button" onClick={onFile}><Icon name="files" size={12}/>Open file</button>}
      {commandAvailable && <button type="button" onClick={onCommand}><Icon name="terminal" size={12}/>View command</button>}
      {artifactAvailable && <button type="button" onClick={onArtifact}><Icon name="globe" size={12}/>Open preview</button>}
    </div>}
  </details>
}
