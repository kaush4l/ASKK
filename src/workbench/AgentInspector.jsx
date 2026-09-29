import { useState } from 'react'
import Modal from './Modal.jsx'

const text = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2)

export function RecordedModelInput({ prompt }) {
  if (!prompt) return <p>No compiled model input has been recorded for this agent.</p>
  return <><p>This is this agent’s latest recorded compiled input. It is historical evidence; current settings may differ. It does not establish that a provider request was transmitted. Inspect the run’s provider requests for transmission and retry records.</p>{prompt.nativeTools !== undefined && <p>Native function definitions are supplied separately from messages and appear in nativeTools below. Available tools are not evidence of tool execution; inspect the run’s tool activity for recorded calls and results.</p>}<pre>{text(prompt)}</pre></>
}

export default function AgentInspector({ details, onClose, onCustomize }) {
  const [section, setSection] = useState('instructions')
  const [copying, setCopying] = useState(false)
  const prompt = details.latestPrompt
  const context = Array.isArray(details.context) ? details.context : Object.entries(details.context || {}).map(([name, configuration]) => `${name}: ${text(configuration)}`)
  return <Modal wide title={`${details.name || details.path} · Definition`} onClose={onClose}>
    <p className="modal-description">{details.description}</p>
    {details.package && onCustomize && <div className="settings-form"><button type="button" className="button" disabled={copying} onClick={async () => { if (copying) return; setCopying(true); try { await onCustomize(details.path) } finally { setCopying(false) } }}>{copying ? 'Copying folder…' : 'Customize a copy'}</button><p className="form-help">Copies the entire agent folder, including its other roles and supporting files, into Agent studio. Existing agents, runs and tool grants stay unchanged.</p></div>}
    <div className="settings-tabs inspector-tabs">{[['instructions', 'Static instructions'], ['context', 'Dynamic inputs'], ['prompt', 'Recorded model input']].map(([id, label]) => <button key={id} aria-pressed={section === id} className={section === id ? 'active' : ''} onClick={() => setSection(id)}>{label}</button>)}</div>
    <div className="agent-inspector">
      {section === 'instructions' && <><h3>Soul</h3><pre>{details.soul || 'No soul fragment configured.'}</pre><h3>Agent instructions</h3><pre>{details.instructions || 'No instructions configured.'}</pre></>}
      {section === 'context' && <><p>These inputs are assembled for each model request. Tool availability and approvals also depend on the selected run policy and connected capabilities.</p><h3>Context providers</h3><div className="capability-chips">{context.map(name => <span key={name}>{name}</span>)}</div><h3>Response contract</h3><pre>{text({ protocol: details.responseProtocol ?? 'envelope', format: details.responseFormat, version: details.contractVersion, stepLimit: details.maxSteps })}</pre><h3>Configured template</h3><pre>{text(details.promptTemplate) || 'Default engine template'}</pre><h3>Configured tool descriptions</h3>{(details.tools || []).map(tool => <details key={tool.name}><summary>{tool.name} · {tool.risk || 'unspecified effect'}</summary><p>{tool.description}</p><pre>{text(tool.parameters)}</pre></details>)}</>}
      {section === 'prompt' && <RecordedModelInput prompt={prompt}/>}
    </div>
  </Modal>
}
