'use client'
import Icon from './Icons.jsx'

const surfaces = [
  { id: 'files', label: 'Files', icon: 'files' },
  { id: 'code', label: 'Code', icon: 'code' },
  { id: 'preview', label: 'Preview', icon: 'globe' },
  { id: 'commands', label: 'Commands', icon: 'terminal' },
]

export default function PhoneWorkspaceTabs({ selected, onSelect }) {
  return <div className="phone-workspace-tabs" role="tablist" aria-label="Workspace surface">
    {surfaces.map((surface, index) => <button key={surface.id} id={`phone-tab-${surface.id}`} type="button" role="tab" aria-selected={selected === surface.id} aria-controls="phone-workspace-panel" tabIndex={selected === surface.id ? 0 : -1} onClick={() => onSelect(surface.id)} onKeyDown={event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % surfaces.length : event.key === 'ArrowLeft' ? (index + surfaces.length - 1) % surfaces.length : event.key === 'Home' ? 0 : event.key === 'End' ? surfaces.length - 1 : null
      if (next === null) return
      event.preventDefault()
      onSelect(surfaces[next].id)
      event.currentTarget.parentElement.children[next]?.focus()
    }}><Icon name={surface.icon} size={13}/><span>{surface.label}</span></button>)}
  </div>
}
