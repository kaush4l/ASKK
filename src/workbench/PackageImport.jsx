'use client'
import { useEffect, useRef, useState } from 'react'
import Modal from './Modal.jsx'
import Icon from './Icons.jsx'
import { createImportSelection, defaultPackageChoices, packageInstallBindings, readPackageFiles, unsupportedPackageTools } from './package-import.js'
import './package-import.css'

const bytesLabel = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1048576).toFixed(1)} MiB`

export function PackageImportFeedback({ message, error }) {
  return <><div className="package-import-status" role="status" aria-live="polite">{message}</div>{error && <div className="package-import-error" role="alert"><Icon name="warning" size={16}/><span>{error}</span></div>}</>
}

export function PackageImportReview({ preview, choices, onChoices, onInstall, busy = '', disabled = false }) {
  const requested = [...new Set(preview.agents.flatMap(agent => agent.tools || []))]
  const unsupported = unsupportedPackageTools(preview)
  const bindings = packageInstallBindings(preview, choices)
  const locked = Boolean(busy || disabled)
  return <form className="package-review" onSubmit={event => { event.preventDefault(); if (!locked && bindings) onInstall(bindings) }}>
    <div className="package-identity"><div><span className="eyebrow">REVIEW BEFORE INSTALLING</span><h3>{preview.packageId}</h3><p>Version {preview.packageVersion} · {preview.agents.length} {preview.agents.length === 1 ? 'agent' : 'agents'} · {preview.files.length} files</p></div><Icon name="agents" size={25}/></div>
    <label className="package-field">Lead agent<select className="form-input" value={choices.leadAgentId} disabled={locked} onChange={event => onChoices({ ...choices, leadAgentId: event.target.value })}>{preview.agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name || agent.id} · {agent.id}</option>)}</select></label>
    <div className="package-agent-list">{preview.agents.map(agent => <details key={agent.id}><summary>{agent.name || agent.id}<span>{agent.id === choices.leadAgentId ? 'Selected lead' : agent.id}</span></summary><p>{agent.description || 'No description supplied.'}</p><dl><div><dt>Requested tools</dt><dd>{agent.tools?.join(', ') || 'None'}</dd></div><div><dt>Model profile</dt><dd>{agent.modelAlias === '$default' || !agent.modelAlias ? 'Desk default' : agent.modelAlias}</dd></div><div><dt>Delegation targets</dt><dd>{Object.entries(agent.delegates || {}).map(([alias, id]) => `${alias} → ${id}`).join(', ') || 'None'}</dd></div></dl>{agent.notes?.map((note, index) => <p className="package-note" key={index}>{note}</p>)}</details>)}</div>
    {preview.modelAliases.length > 0 && <fieldset className="package-bindings" disabled={locked}><legend>Use your model</legend><p>Profiles refer to your saved connections. Credentials stay outside the package.</p>{preview.modelAliases.map(alias => <label key={alias} className="package-field">{alias === '$default' ? 'Default model' : `Package profile: ${alias}`}<select className="form-input" value={choices.models[alias] || ''} onChange={event => onChoices({ ...choices, models: { ...choices.models, [alias]: event.target.value } })}><option value="">Choose a saved model</option>{preview.availableModels.map(model => <option key={model.id} value={model.id}>{model.label || model.id}</option>)}</select></label>)}{!preview.availableModels.length && <p className="form-error">Configure a model in Settings, then preview this package again.</p>}</fieldset>}
    <fieldset className="package-tool-grants" disabled={locked}><legend>Choose tool access</legend><p>Only checked supported groups are approved. Unsupported groups must be removed from the package before it can be installed.</p>{requested.length ? requested.map(tool => { const available = preview.availableTools.includes(tool); return <label key={tool}><input type="checkbox" checked={choices.tools.includes(tool)} disabled={!available} onChange={event => onChoices({ ...choices, tools: event.target.checked ? [...choices.tools, tool] : choices.tools.filter(value => value !== tool) })}/><span><strong>{tool}</strong><small>{available ? 'Available in this desk' : 'Unavailable in this desk'}</small></span></label> }) : <p>No tools requested.</p>}</fieldset>
    {unsupported.length > 0 && <p className="package-import-error" role="alert">Unsupported tool groups: {unsupported.join(", ")}. Remove these requests from agent.md and select the folder again, or use a desk with a trusted adapter for them. Leaving them unchecked does not make this package installable.</p>}
    <details className="package-inventory"><summary>Package files <span>{bytesLabel(preview.files.reduce((total, file) => total + file.bytes, 0))}</span></summary><ul>{preview.files.map(file => <li key={file.path}><span>{file.path}</span><small>{bytesLabel(file.bytes)}</small></li>)}</ul><p className="package-revision">Revision {preview.revisionDigest}</p></details>
    {preview.notes?.length > 0 && <aside className="package-notes" aria-label="Package notes">{preview.notes.map((note, index) => <p key={index}>{note}</p>)}</aside>}
    <p className="form-help">Install saves this definition and selects its workflow. It does not start an agent task or execute package scripts.</p>
    <div className="package-install-action"><button type="submit" className="button primary" disabled={locked || !bindings}>{busy === 'installing' ? 'Installing…' : 'Install agent'}</button>{!bindings && !unsupported.length && <span>Choose an available model for every profile before installing.</span>}</div>
  </form>
}

/** Files remain local to one async selection; React receives only the bounded review DTO. */
export default function PackageImport({ perform, disabled = false, onClose, onInstalled }) {
  const [preview, setPreview] = useState(null)
  const [choices, setChoices] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const sequence = useRef(createImportSelection())
  const mounted = useRef(true)
  const blocked = useRef(disabled)
  const installPending = useRef(false)
  blocked.current = disabled
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current.cancel() } }, [])
  useEffect(() => { if (disabled && !installPending.current) { sequence.current.cancel(); setBusy('') } }, [disabled])
  const current = ticket => mounted.current && sequence.current.current(ticket)
  const close = () => { sequence.current.cancel(); onClose() }
  async function selectFiles(files, directory) {
    if (blocked.current || installPending.current || !files.length) return
    const ticket = sequence.current.begin()
    setPreview(null); setChoices(null); setError(''); setBusy('reading')
    try {
      const records = await readPackageFiles(files, { directory, isCurrent: () => current(ticket) && !blocked.current })
      if (!current(ticket) || blocked.current) return
      setBusy('validating')
      const next = await perform('previewAgentPackage', records)
      if (!current(ticket) || blocked.current) return
      setPreview(next); setChoices(defaultPackageChoices(next)); setBusy('')
    } catch (error) { if (current(ticket) && error.name !== 'AbortError') { setError(error.message || String(error)); setBusy('') } }
  }
  async function install(bindings) {
    if (blocked.current || installPending.current || !preview || busy) return
    installPending.current = true
    const ticket = sequence.current.begin()
    setBusy('installing'); setError('')
    try {
      const installed = await perform('installAgentPackage', preview.stageId, bindings)
      if (current(ticket)) onInstalled?.(installed)
    } catch (error) { if (current(ticket)) setError(error.message || String(error)) }
    finally { installPending.current = false; if (current(ticket)) setBusy('') }
  }
  const message = busy === 'reading' ? 'Reading selected files…' : busy === 'validating' ? 'Validating package…' : busy === 'installing' ? 'Installing the reviewed definition. Installation may finish after you close this dialog.' : disabled ? 'Finish active work or the model check before importing.' : preview ? 'Package ready to review. Nothing has been installed yet.' : ''
  return <Modal title="Import an agent" onClose={close} focusInput={false}>
    <div className="package-import">
      <p className="modal-description">Bring an agent.md folder into this browser. Review its lead, model and tools before installing.</p>
      <div className="package-file-pickers"><label><span><Icon name="files" size={16}/>Choose an agent folder</span><input aria-label="Choose an agent folder" type="file" webkitdirectory="" multiple disabled={disabled || busy === 'installing'} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; selectFiles(files, true) }}/></label><label><span>Or choose just agent.md</span><input aria-label="Choose a single agent.md file" type="file" accept=".md,text/markdown,text/plain" disabled={disabled || busy === 'installing'} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; selectFiles(files, false) }}/></label></div>
      <p className="form-help">Up to 256 source files, 8 MiB per file and 32 MiB total. A single agent.md works when it has no supporting file references. No scripts are installed.</p>
      <PackageImportFeedback message={message} error={error}/>
      {preview && choices && <PackageImportReview preview={preview} choices={choices} onChoices={setChoices} onInstall={install} busy={busy} disabled={disabled}/>}
      <div className="package-close"><button className="button subtle" type="button" onClick={close}>{busy === 'installing' ? 'Close' : 'Cancel'}</button></div>
    </div>
  </Modal>
}
