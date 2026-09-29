import { useState } from 'react'
import Modal from './Modal.jsx'

const text = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2)

export default function AgentInspector({ details, onClose }) {
  const [section, setSection] = useState('instructions')
  const prompt = details.latestPrompt
  const context = Array.isArray(details.context) ? details.context : Object.entries(details.context || {}).map(([name, configuration]) => `${name}: ${text(configuration)}`)
  return <Modal wide title={`${details.name || details.path} · Definition`} onClose={onClose}>
    <p className="modal-description">{details.description}</p>
    <div className="settings-tabs inspector-tabs">{[['instructions', 'Static instructions'], ['context', 'Dynamic inputs'], ['prompt', 'Recorded prompt']].map(([id, label]) => <button key={id} aria-pressed={section === id} className={section === id ? 'active' : ''} onClick={() => setSection(id)}>{label}</button>)}</div>
    <div className="agent-inspector">
      {section === 'instructions' && <><h3>Soul</h3><pre>{details.soul || 'No soul fragment configured.'}</pre><h3>Agent instructions</h3><pre>{details.instructions || 'No instructions configured.'}</pre></>}
      {section === 'context' && <><p>These inputs are assembled for each model request. Tool availability and approvals also depend on the selected run policy and connected capabilities.</p><h3>Context providers</h3><div className="capability-chips">{context.map(name => <span key={name}>{name}</span>)}</div><h3>Response contract</h3><pre>{text({ format: details.responseFormat, version: details.contractVersion, stepLimit: details.maxSteps })}</pre><h3>Configured template</h3><pre>{text(details.promptTemplate) || 'Default engine template'}</pre><h3>Configured tool descriptions</h3>{(details.tools || []).map(tool => <details key={tool.name}><summary>{tool.name} · {tool.risk || 'unspecified effect'}</summary><p>{tool.description}</p><pre>{text(tool.parameters)}</pre></details>)}</>}
      {section === 'prompt' && (prompt ? <><p>This is a recorded input from this agent’s latest captured request. It is historical evidence; current settings may differ.</p><pre>{text(prompt)}</pre></> : <p>No model request has been recorded for this agent in this session. Starting a task will produce its exact prompt snapshot.</p>)}
    </div>
  </Modal>
}
