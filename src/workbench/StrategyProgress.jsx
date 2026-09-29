import Icon from './Icons.jsx'

const labels = { queued: 'Queued', running: 'Running', cancelling: 'Stopping', verifying: 'Verifying application', interrupted: 'Interrupted', done: 'Completed', failed: 'Failed', incomplete: 'Incomplete', cancelled: 'Stopped', skipped: 'Skipped' }
const text = value => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value)
const nameOf = node => node?.label || node?.id || node?.nodeId || 'Role'
const waitingLabel = waiting => {
  if (!waiting) return ''
  if (waiting.approvalIds?.length || ['approval', 'approvals', 'human'].includes(waiting.kind)) return 'Awaiting approval'
  return ({ dependency: 'Waiting for dependencies', dependencies: 'Waiting for dependencies', tool: 'Waiting for tool', agent: 'Waiting for agent', agents: 'Waiting for agents', question: 'Waiting for an answer', provider: 'Waiting for model response', model: 'Waiting for model', runtime: 'Environment response delayed' })[waiting.kind] || 'Waiting'
}

/** Configured roles and actual runner receipts; never infers stages from text or tool batches. */
export default function StrategyProgress({ task, definition, agents = [], onInspectRun }) {
  const spec = task?.definition || definition
  if (!spec?.nodes?.length && !task?.nodes?.length) return null
  const configured = spec?.nodes || []
  const definitions = new Map(configured.map(node => [node.id, node]))
  const snapshots = new Map((task?.nodes || []).map(node => [node.nodeId, node]))
  const nodes = [...configured.map(node => ({ configured: node, actual: snapshots.get(node.id) })), ...(task?.nodes || []).filter(node => !definitions.has(node.nodeId)).map(actual => ({ configured: { id: actual.nodeId, agent: actual.agent, dependsOn: actual.dependsOn }, actual }))]
  const completed = (task?.nodes || []).filter(node => node.status === 'done').length
  const activeCount = (task?.nodes || []).filter(node => ['running', 'cancelling'].includes(node.status)).length
  const currentStatus = task ? labels[task.status] || task.status : 'Not started'
  const maxParallel = spec?.limits?.maxParallel
  return <section className="strategy-progress" aria-label={task ? 'Current role strategy' : 'Configured role strategy'}>
    <div className="strategy-heading"><div><span className="dashboard-eyebrow">{task ? 'TASK STRATEGY' : 'CONFIGURED STRATEGY'}</span><h2>{spec?.label || spec?.id || task?.definitionId || 'Role graph'}</h2></div><span className={`strategy-state state-${task?.status || 'planned'}`} role="status">{currentStatus}</span></div>
    {spec?.description && <p className="strategy-description">{spec.description}</p>}
    <div className="strategy-facts">{task ? <><span>{completed}/{nodes.length} roles completed</span>{activeCount > 0 && <span>{activeCount} active {activeCount === 1 ? 'role' : 'roles'}</span>}</> : <span>{nodes.length} configured roles</span>}{Number.isInteger(maxParallel) && <span>Up to {maxParallel} at once</span>}<span>Fresh agent workers</span></div>
    {task?.status === 'cancelling' && <p className="strategy-notice" role="status">Stopping active roles. Their outcomes remain pending until the workers respond.</p>}
    {task?.status === 'verifying' && <p className="strategy-notice" role="status">Role outputs have returned. Application verification is still in progress.</p>}
    {task?.reason && <p className="strategy-notice">{text(task.reason)}</p>}
    <ol className="strategy-nodes">{nodes.map(({ configured: node, actual }) => {
      const status = actual?.status || 'planned'
      const wait = ['running', 'queued'].includes(status) ? waitingLabel(actual?.waiting) : ''
      const agent = agents.find(row => row.path === (actual?.agent || node.agent))
      const dependencies = actual?.dependsOn || node.dependsOn || []
      const runId = actual?.result?.outputRef?.runId || actual?.runId
      const output = node.id === (task?.outputNode || spec?.output)
      const reason = actual?.result?.reason || actual?.reason
      return <li className={`strategy-node node-${status}`} key={actual?.attemptId || node.id}>
        <div className="strategy-node-title"><span className="strategy-node-icon"><Icon name={status === 'done' ? 'check' : ['failed', 'incomplete', 'interrupted'].includes(status) ? 'warning' : status === 'cancelled' ? 'stop' : 'agents'} size={15}/></span><div><h3>{nameOf(node)}</h3><span>{agent?.name || actual?.agent || node.agent}</span></div>{output && <span className="strategy-output">Final output</span>}</div>
        <p className="strategy-dependencies">{dependencies.length ? <>After {dependencies.map(id => nameOf(definitions.get(id) || { id })).join(', ')}</> : 'No dependencies'}</p>
        <div className="strategy-node-status"><span>{wait || labels[status] || 'Not started'}</span>{actual?.waiting?.approvalIds?.length > 0 && <span>{actual.waiting.approvalIds.length} pending {actual.waiting.approvalIds.length === 1 ? 'decision' : 'decisions'}</span>}</div>
        {reason && <p className="strategy-node-reason">{text(reason)}</p>}
        {actual?.cancellationError && <p className="strategy-node-reason">Stop request could not be confirmed: {text(actual.cancellationError)}</p>}
        {runId && onInspectRun && <button type="button" className="dashboard-inline" onClick={() => onInspectRun(runId)}>{actual.result?.outputRef ? 'Inspect result' : 'Inspect run'}<Icon name="right" size={12}/></button>}
      </li>
    })}</ol>
  </section>
}
