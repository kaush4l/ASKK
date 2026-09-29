'use client'

import { useId } from 'react'
import Icon from './Icons.jsx'
import Markdown from './Markdown.jsx'
import ToolCard, { toolPresentationStatus } from './ToolCard.jsx'
import StrategyProgress from './StrategyProgress.jsx'
import { modelStatusLabel, modelRelayAvailable } from './model-ui.js'
import './dashboard.css'

const active = status => ['starting', 'running', 'thinking', 'calling', 'waiting', 'compacting', 'cancelling', 'verifying'].includes(status)
const riskNames = { read: 'Read', net: 'Network', write: 'Write', exec: 'Execute' }
const actionOf = tool => tool?.effectiveAction ?? tool?.action
const riskOf = tool => riskNames[tool?.risk] ? tool.risk : tool?.tier === 'agent' ? 'read' : 'write'
const titleOf = text => String(text || '').replace(/[_.]/g, ' ').replace(/^\w/, letter => letter.toUpperCase())
const textOf = value => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value, null, 2)
const statusOf = row => row.status || row.slot?.status || 'idle'
const labelOf = status => ({ idle: 'Available', ready: 'Ready', starting: 'Starting', thinking: 'Thinking', calling: 'Using a tool', waiting: 'Waiting', compacting: 'Organizing context', running: 'Running', cancelling: 'Stopping', verifying: 'Verifying application', done: 'Completed', verified: 'Verified', completed: 'Completed', failed: 'Failed', incomplete: 'Incomplete', cancelled: 'Stopped', interrupted: 'Interrupted', unresponsive: 'Response delayed' })[status] || titleOf(status)

function Status({ status, children }) {
  return <span className={`dashboard-status ${active(status) ? 'is-active' : ['failed', 'unresponsive', 'error'].includes(status) ? 'is-error' : ''}`}><i aria-hidden="true"/>{children || labelOf(status)}</span>
}

function Capability({ icon, title, value, detail, action, actionLabel }) {
  return <div className="dashboard-capability"><span className="dashboard-capability-icon"><Icon name={icon} size={17}/></span><div><div className="dashboard-capability-title"><strong>{title}</strong><span>{value}</span></div><p>{detail}</p>{action && <button type="button" className="dashboard-inline" onClick={action}>{actionLabel}<Icon name="right" size={12}/></button>}</div></div>
}

export function matchesAgentDefinition(definition, run) {
  const identity = run.path || run.agent
  return identity ? identity === definition.path : run.name === definition.path || run.name === definition.name
}

/** Projection only: the owner supplies live state and all operations. No runtime starts here. */
export default function Dashboard({ state = {}, goal = '', onGoalChange, onSubmit, onOpenWorkspace, onOpenSettings, onSelectWorkflow, onToolPolicyChange, onApprove, onStopRun, onStopAgent, onInspectAgent, onInspectRun, onOpenTool, onImportAgent, importDisabled = false, busy = false }) {
  const formId = useId()
  const definitions = state.agentDefinitions || []
  const runs = (state.agents || []).filter(run => run.kind !== 'strategy')
  const workflows = state.workflows || []
  const workflow = workflows.find(row => row.id === state.selectedWorkflowId)
  const selectedAgent = definitions.find(row => row.path === workflow?.agent)
  const graph = workflow?.strategy?.nodes?.length ? workflow.strategy : null
  const roleGroups = graph ? graph.nodes.map(node => ({ id: node.id, label: node.label || node.id, definition: definitions.find(row => row.path === node.agent), agent: node.agent })) : [{ id: 'selected', definition: selectedAgent, agent: workflow?.agent }]
  const task = state.task
  const policy = state.toolPolicy || {}
  const disabled = new Set(policy.disabledTools || [])
  const approvalRisks = new Set(policy.approvalRisks || [])
  const approvals = state.approvals || []
  const graphRunning = ['queued', 'running', 'cancelling', 'verifying'].includes(task?.status) || Boolean(graph && active(state.run?.status))
  const working = graphRunning || active(state.run?.status) || runs.some(run => active(statusOf(run)))
  const policyLocked = state.packageInstalling || working || Boolean(busy) || !state.ready
  const runtime = state.runtime || {}
  const model = state.model || {}
  const companion = state.companion || {}
  const capabilities = new Set(companion.status === 'connected' ? companion.capabilities || [] : [])
  const tools = roleGroups.flatMap(group => group.definition?.tools || [])
  const toolEnabled = tool => tool.available !== false && tool.selected !== false && actionOf(tool) !== 'deny' && !disabled.has(tool.name) && (tool.tier !== 'agent' || !graph && Boolean(policy.allowDelegation))
  const allTools = new Map(definitions.flatMap(agent => (agent.tools || []).map(tool => [tool.name, tool])))
  const activity = (state.messages || []).flatMap(message => (message.tools || []).map(tool => ({ ...tool, at: message.at }))).slice(-6).reverse()
  const answer = [...(state.messages || [])].reverse().find(message => message.role === 'assistant' && textOf(message.content).trim())
  const activeRuns = runs.filter(run => active(statusOf(run)))
  const advertisedBrowser = ['browser', 'browser-control'].some(cap => capabilities.has(cap)) && tools.some(tool => toolEnabled(tool) && /^(browser[._]|host_browser)/.test(tool.name))
  const fetchAvailable = capabilities.has('fetch')
  const delayed = runtime.status === 'unresponsive' && workflow?.workspace
  const canSubmit = !state.packageInstalling && !workflow?.disabled && model.status !== 'checking' && !graphRunning && state.ready && Boolean(workflow) && Boolean(goal.trim()) && !busy && (!delayed || working) && (!graph || policy.allowDelegation || working)
  const setPolicy = patch => onToolPolicyChange?.(patch)
  const submit = event => { event.preventDefault(); if (canSubmit) onSubmit?.() }
  const matches = matchesAgentDefinition
  const unmatched = runs.filter(run => !definitions.some(definition => matches(definition, run)))
  const notice = workflow?.workspace ? state.executionNotices?.[runtime.target] : null

  return <main className="agent-dashboard" aria-label="Agent dashboard">
    <div className="dashboard-content">
      <header className="dashboard-intro"><div><span className="dashboard-eyebrow">YOUR AGENT WORKSPACE</span><h1>What needs doing?</h1><p>Set a goal. Choose the tools. Keep the work in view.</p></div><div className="dashboard-intro-actions">{onImportAgent && <button type="button" className="dashboard-import-button" disabled={importDisabled || policyLocked || model.status === 'checking'} onClick={onImportAgent}><Icon name="plus" size={15}/>Import agent</button>}<button type="button" className="dashboard-workspace-link" onClick={onOpenWorkspace}><Icon name="code" size={17}/><span>Open coding workspace</span><Icon name="right" size={14}/></button></div></header>
      {state.packageInstalling && <p className="dashboard-notice" role="status">Installing the reviewed agent definition. Starting tasks, changing workflows and importing another package are paused until it finishes.</p>}
      {state.error && <div className="dashboard-global-error" role="alert"><Icon name="warning" size={17}/><p>{textOf(state.error)}</p></div>}

      <div className="dashboard-layout">
        <div className="dashboard-main">
          <section className="dashboard-launch" aria-label="Start or steer a task">
            <div className="dashboard-section-heading"><h2>Choose a workflow</h2><span>{workflow ? `Lead: ${selectedAgent?.name || workflow.label}` : 'Loading configuration'}</span></div>
            <div className="dashboard-workflows" role="group" aria-label="Workflow">
              {workflows.map(item => <button key={item.id} type="button" aria-pressed={item.id === state.selectedWorkflowId} disabled={policyLocked || item.disabled} onClick={() => onSelectWorkflow?.(item.id)}><Icon name={item.workspace ? 'code' : 'spark'} size={17}/><span><strong>{item.label}</strong><small>{item.disabled ? item.unavailableReason || 'Unavailable · saved definition preserved' : item.description}</small></span>{item.id === state.selectedWorkflowId && <Icon name="check" size={14}/>}</button>)}
              {!workflows.length && <p className="dashboard-empty">{state.ready ? 'No workflows are configured.' : 'Loading your workflows…'}</p>}
            </div>
            {state.ready && state.selectedWorkflowId && !workflow && <p className="dashboard-error" role="status">The saved workflow is unavailable. Choose a workflow explicitly; your goal has been kept.</p>}
            {workflow?.package && <p className="dashboard-agent-model">Agent model: <strong>{workflow.leadModel || 'Binding unavailable'}</strong><span>Connection checks below apply to the desk default profile.</span></p>}
            {workflow?.disabled && <p className="dashboard-error" role="status">{workflow.unavailableReason || 'This workflow is unavailable. Its saved definition has been preserved.'}</p>}
            <form className="dashboard-composer" onSubmit={submit}>
              <label htmlFor="dashboard-goal">Dashboard goal</label>
              <textarea id="dashboard-goal" value={goal} onChange={event => onGoalChange?.(event.target.value)} placeholder={graphRunning ? 'Draft a goal for the next run…' : working ? 'Add a note to the current task…' : 'Describe the result you want…'} rows={4} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); if (canSubmit) onSubmit?.() } }}/>
              <div className="dashboard-composer-footer"><span>{state.packageInstalling ? 'Installation is in progress. Your goal remains editable.' : model.status === 'checking' ? 'Model check in progress. Finish or cancel it in Model settings before starting a task.' : graphRunning ? 'Role inputs are fixed for this run. Stop the workflow to change the goal.' : working ? 'Your note steers the current task.' : 'Your goal stays here when you open the workspace.'}</span><div>{working && <button className="dashboard-stop" type="button" onClick={onStopRun}><Icon name="stop" size={13}/>{graphRunning ? 'Stop workflow' : 'Stop'}</button>}<button className="dashboard-submit" type="submit" disabled={!canSubmit}>{state.packageInstalling ? 'Installing agent…' : busy ? 'Please wait…' : model.status === 'checking' ? 'Checking model…' : graphRunning ? 'Run in progress' : working ? 'Send note' : 'Start task'}<Icon name="arrow" size={16}/></button></div></div>
            </form>
            {notice && <aside className="dashboard-notice" role="note"><strong>{notice.title}</strong><span>{notice.body}</span></aside>}
            {delayed && <p className="dashboard-error" role="status">Environment response delayed. Existing operations stay open while their outcomes are reconciled.</p>}
          </section>

          {approvals.length > 0 && <section className="dashboard-approvals" aria-label="Actions awaiting your approval"><div className="dashboard-section-heading"><h2>Your decision is needed</h2><span>{approvals.length} pending</span></div>{approvals.map(approval => <article key={approval.id} className="dashboard-approval"><div className="dashboard-approval-title"><Icon name="warning" size={16}/><h3>{titleOf(approval.tool || approval.call)}</h3><span>{riskNames[approval.risk] || 'Action'}</span></div><p>{approval.agent} · {approval.reason || 'This action requires your approval.'}</p><details><summary>Review exact input</summary><pre>{textOf(approval.args)}</pre></details><div className="dashboard-approval-actions"><button type="button" onClick={() => onApprove?.(approval.id, false)}>Deny</button><button type="button" onClick={() => onApprove?.(approval.id, true)}>Approve once</button></div></article>)}</section>}

          <StrategyProgress task={task} definition={graph} agents={definitions} onInspectRun={onInspectRun}/>

          {answer && <section className="dashboard-answer" aria-label="Latest agent answer"><div className="dashboard-section-heading"><h2>Latest answer</h2><span>{answer.agent || 'Agent'}</span></div><Markdown text={textOf(answer.content)}/></section>}

          <section className="dashboard-team" aria-label="Agents"><div className="dashboard-section-heading"><h2>Your agents</h2><span>{activeRuns.length ? `${activeRuns.length} active` : `${definitions.length} configured`}</span></div><div className="dashboard-agent-grid">
            {definitions.map(definition => {
              const actual = runs.filter(run => matches(definition, run))
              const latest = actual.find(run => active(statusOf(run))) || actual.at(-1)
              const status = definition.broken || definition.error ? 'failed' : latest ? statusOf(latest) : 'idle'
              return <article className={`dashboard-agent ${active(status) ? 'is-active' : ''}`} key={definition.path}><div className="dashboard-agent-title"><span className="dashboard-agent-avatar"><Icon name={definition.path === workflow?.agent ? 'spark' : 'agents'} size={18}/></span><div><h3>{definition.name || definition.path}</h3><Status status={status}/></div></div><p>{definition.description || definition.path}</p><div className="dashboard-agent-footer"><span>{definition.tools?.length || 0} tools{definition.peers?.length ? ` · ${definition.peers.length} peers` : ''}</span><button type="button" className="dashboard-inline" onClick={() => onInspectAgent?.(definition.path)}>View instructions<Icon name="right" size={12}/></button></div>{actual.filter(run => active(statusOf(run))).map(run => <div className="dashboard-agent-run" key={run.id}><span>{run.description || run.query || labelOf(statusOf(run))}</span><button type="button" aria-label={`Stop ${definition.name || definition.path} task`} onClick={() => onStopAgent?.(run.id)}><Icon name="stop" size={12}/>Stop</button></div>)}</article>
            })}
            {unmatched.map(run => <article className="dashboard-agent" key={run.id || run.name}><div className="dashboard-agent-title"><span className="dashboard-agent-avatar"><Icon name="agents" size={18}/></span><div><h3>{run.agent || run.name || 'Agent'}</h3><Status status={statusOf(run)}/></div></div><p>{run.description || run.query || 'Recorded agent task'}</p>{active(statusOf(run)) && <button type="button" className="dashboard-inline" onClick={() => onStopAgent?.(run.id)}><Icon name="stop" size={12}/>Stop task</button>}</article>)}
            {!definitions.length && !unmatched.length && <p className="dashboard-empty">{state.ready ? 'No agent definitions are available.' : 'Reading agent definitions…'}</p>}
          </div></section>

          <section className="dashboard-activity" aria-label="Recent tool activity"><div className="dashboard-section-heading"><h2>Work in motion</h2><span>Latest {activity.length || 'actions'}</span></div>{activity.length ? activity.map((tool, index) => {
            const run = runs.find(row => row.id === tool.runId)
            const metadata = (run && definitions.find(definition => matches(definition, run))?.tools?.find(item => item.name === tool.name)) || allTools.get(tool.name)
            const risk = tool.risk || (metadata ? riskOf(metadata) : null)
            const pending = toolPresentationStatus(tool, approvals) === 'awaiting_approval'
            return <div className="dashboard-tool-event" key={tool.id || index}><div className="dashboard-tool-event-meta"><span>{riskNames[risk] || 'Tool action'}</span><span>{pending ? 'Approval needed' : actionOf(metadata) === 'ask' ? 'Approval policy applies' : 'Recorded action'}</span>{onOpenTool && <button type="button" className="dashboard-inline" onClick={() => onOpenTool(tool)}>Inspect action<Icon name="right" size={12}/></button>}</div><ToolCard tool={tool} approvals={approvals}/></div>
          }) : <div className="dashboard-activity-empty"><Icon name="bolt" size={19}/><p>Tool calls will appear here as they happen.<span>Inputs, outcomes, and approval requests stay inspectable.</span></p></div>}</section>
        </div>

        <aside className="dashboard-sidebar" aria-label="Task controls and connections">
          <section className="dashboard-connections"><div className="dashboard-section-heading"><h2>Connections</h2><Icon name="globe" size={15}/></div>
            <Capability icon="box" title="Browser harness" value={state.ready ? 'Loaded' : 'Loading'} detail="Agent loops and bundled tools run in your browser."/>
            <Capability icon="spark" title={workflow?.package ? "Desk default model" : "Model"} value={modelStatusLabel(model)} detail={model.id ? <>{model.id}<br/>{model.via === 'bridge' ? `Through HTTPS companion${modelRelayAvailable(companion) ? '' : ' · relay unavailable'}` : 'Direct from this browser'}</> : 'Connect an OpenAI-compatible model endpoint.'} action={() => onOpenSettings?.('model')} actionLabel="Configure model"/>
            <Capability icon="laptop" title="Optional companion" value={companion.status === 'connected' ? 'Connected' : 'Not connected'} detail={companion.status === 'connected' ? `${capabilities.size} advertised capabilities. Permissions are scoped to this connection.` : 'Enable selected network or host tools by pairing a companion.'} action={() => onOpenSettings?.('runtime')} actionLabel="Manage connection"/>
            <dl className="dashboard-capability-facts"><div><dt>Host fetch relay</dt><dd>{fetchAvailable ? 'Advertised' : 'Unavailable'}</dd></div><div><dt>Browser control</dt><dd>{advertisedBrowser ? 'Advertised' : 'Unavailable'}</dd></div><div><dt>Command execution</dt><dd>{runtime.status === 'ready' ? (runtime.target === 'local' ? 'Local Bun ready' : 'Browser Linux ready') : labelOf(runtime.status || 'idle') === 'Available' ? 'Not started' : labelOf(runtime.status)}</dd></div></dl><p className="dashboard-footnote">Web research needs an available fetch tool or relay. Model access alone does not enable host commands or browser control.</p>
          </section>

          <section className="dashboard-controls"><div className="dashboard-section-heading"><h2>How this task runs</h2><span>Owner controls</span></div><fieldset disabled={policyLocked}><legend>Agent loop</legend><div className="dashboard-loop-options"><label><input type="radio" name={`${formId}-loop`} checked={!graph && !policy.allowDelegation} disabled={Boolean(graph)} onChange={() => setPolicy({ allowDelegation: false })}/><span><strong>Single agent</strong><small>{graph ? 'Choose a single-agent workflow to use this mode.' : 'Keep the task with the selected agent.'}</small></span></label><label><input type="radio" name={`${formId}-loop`} checked={Boolean(policy.allowDelegation)} onChange={() => setPolicy({ allowDelegation: true })}/><span><strong>{graph ? 'Enable role graph' : 'Allow delegation'}</strong><small>{graph ? 'Configured roles use fresh workers. Nested delegation is disabled.' : 'Let available peer agents take part.'}</small></span></label></div></fieldset>
            <fieldset disabled={policyLocked}><legend>Ask before</legend><div className="dashboard-risk-options">{Object.entries(riskNames).map(([risk, label]) => <label key={risk}><input type="checkbox" checked={approvalRisks.has(risk)} onChange={event => setPolicy({ approvalRisks: event.target.checked ? [...approvalRisks, risk] : [...approvalRisks].filter(value => value !== risk) })}/>{label}</label>)}</div></fieldset>
            {graph && !policy.allowDelegation && <p className="dashboard-error" role="status">Enable the role graph to start this workflow.</p>}
            <details className="dashboard-tools"><summary><span>{graph ? 'Tools by role' : 'Available tools'}</span><span>{tools.filter(toolEnabled).length}/{tools.length}</span><Icon name="down" size={13}/></summary>
              {roleGroups.map(group => <div className="dashboard-role-tools" key={group.id}>
                {graph && <div className="dashboard-role-tools-heading"><strong>{group.label}</strong><span>{group.definition?.name || group.agent}</span></div>}
                <fieldset disabled={policyLocked}><legend className="dashboard-sr-only">Tools for {group.label || group.definition?.name || 'selected agent'}</legend>
                  {(group.definition?.tools || []).map(tool => <label className="dashboard-tool-toggle" key={tool.name}><input type="checkbox" checked={toolEnabled(tool)} disabled={tool.available === false || tool.tier === 'agent' && (graph || !policy.allowDelegation) || actionOf(tool) === 'deny' && !disabled.has(tool.name)} onChange={event => setPolicy({ disabledTools: event.target.checked ? [...disabled].filter(name => name !== tool.name) : [...disabled, tool.name] })}/><span><strong>{titleOf(tool.name)}</strong><small>{tool.description || tool.name}{tool.available === false ? ' · Unavailable' : tool.tier === 'agent' && graph ? ' · Nested delegation is disabled' : tool.tier === 'agent' && !policy.allowDelegation ? ' · Delegation is off' : disabled.has(tool.name) ? ' · Disabled by you' : actionOf(tool) === 'deny' ? ' · Blocked by current policy' : actionOf(tool) === 'ask' ? ' · Approval required' : ''}</small></span><em>{riskNames[riskOf(tool)]}</em></label>)}
                  {!group.definition?.tools?.length && <p className="dashboard-empty">No tools advertised for this role.</p>}
                </fieldset>
                {group.definition?.unavailable?.length > 0 && <div className="dashboard-unavailable"><strong>Unavailable tools</strong>{group.definition.unavailable.map(tool => <p key={tool.name}>{titleOf(tool.name)}<span>{Array.isArray(tool.missing) ? tool.missing.join(', ') : tool.missing || 'Required capability is missing'}</span></p>)}</div>}
              </div>)}
              {graph && <p className="dashboard-footnote">Disabling a tool name disables it for every role. Each agent's own permissions still apply.</p>}
            </details>
            <p className="dashboard-footnote">{working ? 'Workflow and tool controls are locked while a task is active.' : 'These controls apply to the next task. Runtime permissions can still require approval or deny an action.'}</p>
          </section>
        </aside>
      </div>
    </div>
  </main>
}
