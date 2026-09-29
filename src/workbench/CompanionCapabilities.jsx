'use client'

import { useId } from 'react'
import './companion-capabilities.css'

const labels = {
  fs: 'Host files', exec: 'Host commands', terminal: 'Host terminal', fetch: 'Web fetch',
  'model-relay': 'Model relay', 'network-relay': 'Guest network relay', 'browser-control': 'Browser control',
}

function ScopeDetails({ scope }) {
  if (!scope || typeof scope !== 'object') return null
  const fields = ['kind', 'root', 'cwd', 'endpoint', 'endpoints', 'protocols', 'filesystemIsolation']
  return fields.flatMap(key => {
    const value = scope[key]
    const display = typeof value === 'string' || typeof value === 'boolean' ? String(value)
      : Array.isArray(value) && value.every(item => typeof item === 'string') ? value.join(', ') : null
    return display === null ? [] : <div key={key}><dt>{key}</dt><dd><code>{display}</code></dd></div>
  })
}

/** Discovery describes support and grants; it is never a successful operation receipt. */
export default function CompanionCapabilities({ companion = {} }) {
  const headingId = useId()
  const connected = companion.status === 'connected'
  const manifest = companion.capabilityManifest
  const reported = manifest?.protocol?.name === 'askk-capabilities' && manifest.protocol.version === 1 && Array.isArray(manifest.capabilities)
  return <section className="companion-capabilities" aria-labelledby={headingId}>
    <h3 id={headingId}>Companion capabilities</h3>
    {!connected ? <p>Connect a companion to see its current capability details. Previous connection grants do not apply.</p>
      : !reported ? <p>Capability details unreported. This companion does not provide a supported capability manifest. Pairing alone does not verify its tools.</p>
        : <>
          <p>Built-in support, connection grants and successful checks are separate. These details describe the paired companion; agent permissions still apply. Model reply checks are shown separately for the selected model.</p>
          <ul className="companion-capabilities-list">{manifest.capabilities.map(row => <li className="companion-capability" key={row.id}>
            <strong>{labels[row.id] || row.id}</strong>
            <dl>
              <div><dt>Built in</dt><dd>{row.supported === true ? 'Yes' : 'No'}</dd></div>
              <div><dt>Connection grant</dt><dd>{row.grant === 'allowed' ? 'Allowed' : 'Not granted'}</dd></div>
              <div><dt>Check status</dt><dd>Not checked</dd></div>
            </dl>
            {row.availability === 'scope-required' && <p>Configure an allowed scope on the companion before using this capability.</p>}
            {row.availability === 'unsupported' && <p>This companion does not implement this capability.</p>}
          </li>)}</ul>
          <details><summary>Developer details</summary>
            <dl className="companion-capability-metadata">
              <div><dt>Protocol</dt><dd><code>{manifest.protocol.name} v{manifest.protocol.version}</code></dd></div>
              <div><dt>Instance</dt><dd><code>{manifest.instanceId}</code></dd></div>
              <div><dt>Platform</dt><dd>{manifest.platform?.os} {manifest.platform?.arch}</dd></div>
              <div><dt>Runtime</dt><dd>{manifest.runtime?.kind} {manifest.runtime?.version}</dd></div>
            </dl>
            {manifest.capabilities.map(row => <div key={row.id}><strong><code>{row.id}</code></strong><dl className="companion-capability-metadata">
              <div><dt>Adapter</dt><dd><code>{row.adapter || 'None'}</code></dd></div>
              <div><dt>Configuration</dt><dd>{row.availability}</dd></div>
              <div><dt>Dependencies</dt><dd>Not checked</dd></div>
              <ScopeDetails scope={row.scope}/>
            </dl></div>)}
          </details>
        </>}
  </section>
}
