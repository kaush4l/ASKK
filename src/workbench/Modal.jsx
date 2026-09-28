'use client'
import { useEffect, useId, useRef } from 'react'
import { IconButton } from './Icons.jsx'

export default function Modal({ title, children, onClose, wide = false, focusInput = true }) {
  const dialog = useRef(null)
  const titleId = useId()
  // Capture before React mounts autoFocus children inside the dialog.
  const returnFocus = useRef(typeof document === 'undefined' ? null : document.activeElement)
  useEffect(() => {
    const element = dialog.current
    const previous = returnFocus.current
    element.showModal()
    if (focusInput) element.querySelector('input:not([readonly]), textarea:not([readonly])')?.focus()
    return () => {
      element.close()
      queueMicrotask(() => {
        const current = document.activeElement
        if (previous?.isConnected && previous !== document.body && (current === document.body || current === element || element.contains(current))) previous.focus({ preventScroll: true })
      })
    }
  }, [])
  return <dialog ref={dialog} className={`modal ${wide ? 'modal-wide' : ''}`} onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === dialog.current) onClose() }} aria-labelledby={titleId}>
    <div className="modal-content"><div className="modal-heading"><h2 id={titleId}>{title}</h2><IconButton icon="close" label="Close dialog" onClick={onClose}/></div><div className="modal-body">{children}</div></div>
  </dialog>
}
