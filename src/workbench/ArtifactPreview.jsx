'use client'
import { useEffect, useRef, useState } from 'react'
import { ARTIFACT_SANDBOX, attachArtifact, mountArtifactFrame } from '../workspace/artifacts.js'
import Icon from './Icons.jsx'

export default function ArtifactPreview({ artifact, projectId, size = 'fit' }) {
  const frame = useRef(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    setReady(false); setError('')
    if (!frame.current || !artifact?.html) return
    let session
    let timer
    try {
      session = attachArtifact(frame.current, artifact, { storageKey: projectId || 'default', onReady: () => { clearTimeout(timer); setReady(true) } })
      mountArtifactFrame(frame.current, artifact)
      timer = setTimeout(() => setError('The preview has not connected yet. Refresh it to try again.'), 20000)
    } catch (error) { setError(error.message) }
    return () => { clearTimeout(timer); session?.dispose() }
  }, [artifact?.id, artifact?.html, artifact?.reload, projectId])
  return <><div className="preview-frame-wrap"><iframe ref={frame} title={artifact.name || 'Generated application preview'} sandbox={ARTIFACT_SANDBOX} referrerPolicy="no-referrer" style={{ width: size === 'fit' ? '100%' : `${size}px` }}/></div><div className={`preview-evidence ${artifact.stale ? 'preview-stale' : ''}`}><Icon name={error ? 'warning' : ready ? 'check' : 'refresh'} size={12}/><span>{error || (ready ? artifact.stale ? 'Earlier build · source has changed' : artifact.verified ? 'Verified build' : 'Preview connected · not yet verified' : 'Connecting preview…')}{artifact.revision != null ? ` · revision ${artifact.revision}` : ''}{artifact.buildId ? ` · ${String(artifact.buildId).slice(0, 16)}` : ''}</span></div></>
}
