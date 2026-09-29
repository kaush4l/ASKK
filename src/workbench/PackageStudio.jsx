'use client'
import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Modal from './Modal.jsx'
import DiffView from './DiffView.jsx'
import { PackageImportFeedback, PackageImportReview } from './PackageImport.jsx'
import { defaultPackageChoices } from './package-import.js'
import { draftChanged, draftChanges, readDraftBackup, studioFilePath } from './package-studio.js'
import './package-studio.css'

const Editor = dynamic(() => import('./Editor.jsx'), { ssr: false, loading: () => <p>Opening source editor…</p> })

export default function PackageStudio({ perform, disabled = false, theme = 'dark', onClose, onInstalled, initialDraftId }) {
  const [drafts, setDrafts] = useState([])
  const [draft, setDraft] = useState(null)
  const [saved, setSaved] = useState(null)
  const [path, setPath] = useState('agent.md')
  const [mode, setMode] = useState('source')
  const [wizard, setWizard] = useState({ label: '', description: '', instructions: '' })
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState('loading')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState(null)
  const [choices, setChoices] = useState(null)
  const [fileAction, setFileAction] = useState(null)
  const [fileName, setFileName] = useState('')
  const [pending, setPending] = useState(null)
  const mounted = useRef(true)
  const operating = useRef(true)
  const restoreInput = useRef(null)
  const dirty = draftChanged(saved, draft)
  const wizardDirty = creating && Object.values(wizard).some(Boolean)
  const file = draft?.files.find(item => item.path === path)
  const soul = draft?.files.find(item => item.path === 'soul.md')
  const changes = draftChanges(saved?.files, draft?.files)
  function openRecord(record) {
    setDraft(record); setSaved(record); setPath(record.files.some(file => file.path === 'agent.md') ? 'agent.md' : record.files[0]?.path || ''); setCreating(false); setPreview(null); setChoices(null); setFileAction(null); setMode('source')
  }
  useEffect(() => {
    mounted.current = true
    ;(async () => {
      try {
        const rows = await perform('listAgentDrafts')
        if (!mounted.current) return
        setDrafts(rows)
        if (initialDraftId) { const record = await perform('readAgentDraft', initialDraftId); if (mounted.current) openRecord(record) }
      } catch (failure) { if (mounted.current) setError(failure.message) }
      finally { operating.current = false; if (mounted.current) setBusy('') }
    })()
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    if (!dirty && !wizardDirty) return
    const warn = event => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, wizardDirty])
  async function run(label, action) {
    if (operating.current) return false
    operating.current = true
    setBusy(label); setError(''); setMessage('')
    try { await action(); return true } catch (failure) { if (mounted.current) setError(failure.message || String(failure)); return false }
    finally { operating.current = false; if (mounted.current) setBusy('') }
  }
  function request(action) { if (operating.current) return; if (dirty || wizardDirty) setPending(() => action); else action() }
  function change(patch) { setDraft(previous => ({ ...previous, ...patch })); setPreview(null); setChoices(null); setMessage('') }
  function changeFile(content, target = path) { change({ files: draft.files.map(file => file.path === target ? { ...file, content } : file) }) }
  async function save() {
    return run('saving', async () => {
      const result = creating
        ? await perform('createAgentDraft', wizard)
        : await perform('saveAgentDraft', draft.id, { label: draft.label, files: draft.files, expectedVersion: saved.version })
      if (!mounted.current) return
      if (creating) openRecord(result)
      else { setSaved(result); setDraft(result); setPreview(null) }
      setDrafts(previous => [result, ...previous.filter(row => row.id !== result.id)])
      setMessage('Draft saved in this browser. Saving does not install or run it.')
    })
  }
  async function review() {
    if (dirty || disabled || !draft) return
    await run('reviewing', async () => {
      setPreview(null); setChoices(null)
      const result = await perform('previewAgentDraft', draft.id)
      if (!mounted.current) return
      if (result.draftVersion !== saved.version) throw new Error('This draft changed in another view. Reopen it before reviewing.')
      setPreview(result); setChoices(defaultPackageChoices(result)); setMessage('Saved draft validated. Review model and tool access before installing.')
    })
  }
  async function downloadBackup() {
    if (dirty || !draft) return
    await run('preparing backup', async () => {
      const result = await perform('exportAgentDraft', draft.id, { expectedVersion: saved.version })
      if (!mounted.current) return
      const url = URL.createObjectURL(new Blob([result.text], { type: result.mimeType }))
      const link = document.createElement('a')
      link.href = url; link.download = result.filename; document.body.append(link)
      try { link.click() } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000) }
      setMessage(`Backup download requested for saved version ${saved.version}. Keep the file to restore this draft in another browser.`)
    })
  }
  function selectBackup(event) {
    const selected = event.target.files?.[0]
    event.target.value = ''
    if (!selected) return
    request(() => run('restoring backup', async () => {
      const text = await readDraftBackup(selected, { isCurrent: () => mounted.current })
      const result = await perform('restoreAgentDraft', text)
      if (!mounted.current) return
      openRecord(result)
      setDrafts(previous => [result, ...previous.filter(row => row.id !== result.id)])
      setMessage('Backup restored as a new draft in this browser. Review it when ready to install. Nothing was installed or started.')
    }))
  }
  async function install(bindings) {
    if (disabled || dirty || !preview) return
    await run('installing', async () => {
      const result = await perform('installAgentDraft', draft.id, { expectedVersion: preview.draftVersion, stageId: preview.stageId, bindings })
      if (mounted.current) { setPreview(null); setMessage('Installed as a new agent. Existing agents and runs keep their original definitions.'); onInstalled?.(result) }
    })
  }
  function applyFile(event) {
    event.preventDefault(); setError('')
    try {
      if (fileAction === 'delete') {
        const files = draft.files.filter(file => file.path !== path); change({ files }); setPath(files[0]?.path || '')
      } else {
        const next = studioFilePath(fileName, draft.files, fileAction === 'rename' ? path : undefined)
        change({ files: fileAction === 'rename' ? draft.files.map(file => file.path === path ? { ...file, path: next } : file) : [...draft.files, { path: next, content: '' }] }); setPath(next)
      }
      setFileAction(null)
    } catch (failure) { setError(failure.message) }
  }
  function beginCreate() { setCreating(true); setDraft(null); setSaved(null); setPreview(null); setWizard({ label: '', description: '', instructions: '' }); setError(''); setMessage('') }
  return <Modal title="Agent studio" wide focusInput={false} onClose={() => request(onClose)}>
    <div className="package-studio" aria-busy={Boolean(busy)}>
      <p className="modal-description">Create and edit agent folders. Drafts are saved only in this browser; download a backup to keep them elsewhere or move them to another device. Install a reviewed version when it is ready.</p>
      <fieldset className="studio-picker" disabled={Boolean(busy) || Boolean(pending)}><label>Saved drafts<select className="form-input" aria-label="Saved drafts" value={draft?.id || ''} onChange={event => { const id = event.target.value; if (id) request(() => run('loading', async () => { const record = await perform('readAgentDraft', id); if (mounted.current) openRecord(record) })) }}><option value="">Choose a draft…</option>{drafts.map(row => <option key={row.id} value={row.id}>{row.label || 'Untitled agent'}</option>)}</select></label><button className="button" type="button" onClick={() => request(beginCreate)}>Create agent</button></fieldset>
      <div className="studio-backup"><button type="button" className="button" disabled={Boolean(busy) || Boolean(pending)} onClick={() => restoreInput.current?.click()}>Restore draft backup</button><input ref={restoreInput} type="file" accept=".json,application/json" aria-label="Choose draft backup" hidden onChange={selectBackup}/><p className="form-help">Restore creates a new draft and keeps existing saved drafts. It does not install or run an agent.</p></div>
      <PackageImportFeedback message={busy ? `${busy[0].toUpperCase()}${busy.slice(1)}…` : message || (dirty || wizardDirty ? 'Unsaved changes' : draft ? `Saved draft · version ${saved.version}` : '')} error={error}/>
      {pending && <section className="studio-unsaved" role="alert" aria-label="Unsaved draft"><strong>Save your changes before leaving?</strong><p>Discard removes only changes since your last save.</p><div><button className="button primary" disabled={Boolean(busy) || creating && !wizard.label.trim()} onClick={async () => { const next = pending; if (await save()) { setPending(null); next() } }}>Save and continue</button><button className="button" disabled={Boolean(busy)} onClick={() => { const next = pending; setPending(null); if (draft) setDraft(saved); setWizard({ label: '', description: '', instructions: '' }); next() }}>Discard changes</button><button className="button" disabled={Boolean(busy)} onClick={() => setPending(null)}>Keep editing</button></div></section>}
      <fieldset className="studio-content" disabled={Boolean(busy) || Boolean(pending)}>
        {creating && <form className="studio-create" onSubmit={event => { event.preventDefault(); save() }}><label>Agent name<input className="form-input" required value={wizard.label} onChange={event => setWizard({ ...wizard, label: event.target.value })}/></label><label>Purpose<input className="form-input" value={wizard.description} onChange={event => setWizard({ ...wizard, description: event.target.value })} placeholder="What should this agent help with?"/></label><label>Instructions<textarea className="form-input" rows={7} value={wizard.instructions} onChange={event => setWizard({ ...wizard, instructions: event.target.value })} placeholder="Describe how the agent should work."/></label><p className="form-help">Starts with the desk model and no tool grants. You can edit every source file before installation.</p><button className="button primary" disabled={!wizard.label.trim()}>Create saved draft</button></form>}
        {draft && <>
          <label className="studio-label">Draft name<input className="form-input" value={draft.label} onChange={event => change({ label: event.target.value })}/><small>This label organizes drafts. The agent’s displayed name is defined in agent.md.</small></label>
          <div className="studio-modes" role="group" aria-label="Editing view"><button type="button" className="button" aria-pressed={mode === 'source'} onClick={() => setMode('source')}>Source files</button>{soul && <button type="button" className="button" aria-pressed={mode === 'instructions'} onClick={() => setMode('instructions')}>Instructions</button>}</div>
          {mode === 'instructions' && soul ? <label className="studio-instructions">Instructions · soul.md<textarea className="form-input" rows={12} value={soul.content} onChange={event => changeFile(event.target.value, 'soul.md')}/><small>Edits the exact soul.md source. Other prompt files remain available in Source files.</small></label> : <>
            <div className="studio-file-toolbar"><label>File<select className="form-input" value={path} onChange={event => { setPath(event.target.value); setFileAction(null) }}>{draft.files.map(file => <option key={file.path} value={file.path}>{file.path}</option>)}</select></label><div><button type="button" className="button" onClick={() => { setFileAction('add'); setFileName('') }}>Add file</button><button type="button" className="button" disabled={!file} onClick={() => { setFileAction('rename'); setFileName(path) }}>Rename</button><button type="button" className="button" disabled={!file} onClick={() => setFileAction('delete')}>Delete</button></div></div>
            {fileAction && <form className="studio-file-action" onSubmit={applyFile}>{fileAction === 'delete' ? <p>Delete {path} from this draft? References may need updating before installation.</p> : <label>{fileAction === 'add' ? 'New file path' : 'Rename file'}<input className="form-input" autoFocus required value={fileName} onChange={event => setFileName(event.target.value)} placeholder="skills/research.md"/></label>}<button className="button" type="submit">{fileAction === 'delete' ? 'Delete file' : 'Apply'}</button><button className="button" type="button" onClick={() => setFileAction(null)}>Cancel</button></form>}
            {file ? <div className="studio-editor"><Editor key={draft.id} path={path} value={file.content} theme={theme} scope={`package:${draft.id}`} onChange={changeFile} onSave={save} readOnly={Boolean(busy) || Boolean(pending)}/></div> : <p>No files in this draft. Add agent.md to make an installable folder.</p>}
          </>}
          {changes.length > 0 && <details className="studio-changes"><summary>Review {changes.length} changed {changes.length === 1 ? 'file' : 'files'} since last save</summary>{changes.map(change => <details key={change.path}><summary>{change.kind}: {change.path}</summary><DiffView {...change}/></details>)}</details>}
          <div className="studio-actions"><button type="button" className="button" disabled={!dirty} onClick={save}>Save draft</button><button type="button" className="button" disabled={dirty} onClick={downloadBackup} aria-describedby="studio-backup-help">Download draft backup</button><button type="button" className="button primary" disabled={dirty || disabled} onClick={review}>Review saved draft</button></div>
          <p className="form-help" id="studio-backup-help">{dirty ? 'Save changes before downloading a backup. ' : `Backup includes saved version ${saved.version}. `}It contains the draft name and exact source files, including unfinished edits in saved source. Connections, tool approvals, and run history are not included. Any sensitive text you put in source is included.</p>
          <p className="form-help">Invalid source can be saved. Installation requires a valid folder. Existing agents and runs are never changed.</p>
          {disabled && <p className="form-help">You can keep editing. Finish active work or connection checks before reviewing and installing.</p>}
        </>}
      </fieldset>
      {preview && choices && !dirty && <PackageImportReview preview={preview} choices={choices} onChoices={setChoices} onInstall={install} busy={busy} disabled={disabled || Boolean(pending)} actionLabel="Install as new agent" helpText="Installs this saved version as a new agent and selects its direct lead workflow. Existing agents and runs stay unchanged. No task starts automatically." unsupportedHelp="Edit these requests in Source files, save the draft, then review again."/>}
      <div className="studio-close"><button type="button" className="button subtle" disabled={Boolean(busy)} onClick={() => request(onClose)}>Close studio</button></div>
    </div>
  </Modal>
}
