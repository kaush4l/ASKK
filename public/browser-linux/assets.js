/** Reassemble immutable runtime assets from individually verified hosting-sized parts. */
export function createDownloadProgress(total) {
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('Invalid runtime download total')
  let received = 0
  return {
    add(bytes) {
      if (!Number.isSafeInteger(bytes) || bytes < 0 || received + bytes > total) throw new Error('Invalid runtime download progress')
      received += bytes
    },
    snapshot: () => ({ received, total }),
  }
}

export async function verifiedAsset(entry, base, { fetch: fetcher = globalThis.fetch, onProgress = () => {}, onVerifying = () => {}, onRetry = () => {} } = {}) {
  if (!entry || !/^[a-zA-Z0-9_.-]+$/.test(entry.name) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > 1024 ** 3 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid runtime asset descriptor')
  const parts = entry.parts ?? [entry]
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > 32 || parts.reduce((sum, part) => sum + part.bytes, 0) !== entry.bytes) throw new Error('Invalid runtime asset parts')
  if (parts.length === 1 && parts[0].sha256 !== entry.sha256) throw new Error('Runtime asset part identity does not match its asset')
  const assembled = new Uint8Array(entry.bytes)
  let offset = 0
  for (const part of parts) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(part.name) || !Number.isSafeInteger(part.bytes) || part.bytes < 0 || !/^[a-f0-9]{64}$/.test(part.sha256)) throw new Error('Invalid runtime asset part')
    // Count each asset byte once, even when a corrupt cached part is downloaded again.
    let credited = 0
    const credit = (received) => { if (received > credited) { const delta = received - credited; credited = received; onProgress(delta, part.name) } }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetcher(new URL(part.name, base), attempt ? { cache: 'reload' } : undefined)
        if (!response.ok) throw new Error(`Runtime asset unavailable: ${response.status} ${part.name}`)
        const reader = response.body?.getReader()
        let received = 0
        if (reader) {
          try {
            while (true) {
              const { value, done } = await reader.read()
              if (done) break
              if (received + value.byteLength > part.bytes) throw corrupt(`Runtime asset size exceeded: ${part.name}`)
              assembled.set(value, offset + received); received += value.byteLength; credit(received)
            }
          } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
        } else {
          const bytes = new Uint8Array(await response.arrayBuffer())
          if (bytes.length !== part.bytes) throw corrupt(`Runtime asset size mismatch: ${part.name}`)
          assembled.set(bytes, offset); received = bytes.length; credit(received)
        }
        if (received !== part.bytes) throw corrupt(`Runtime asset size mismatch: ${part.name}`)
        onVerifying(part.name)
        if (await sha256(assembled.subarray(offset, offset + received)) !== part.sha256) throw corrupt(`Runtime asset failed integrity verification: ${part.name}`)
        offset += received
        break
      } catch (error) {
        // Retry only a rejected payload, once, from the same URL with HTTP-cache bypass.
        // Network/HTTP failures and a second bad payload remain explicit failures.
        if (attempt || error?.code !== 'RUNTIME_ASSET_CORRUPT') throw error
        onRetry(part.name)
      }
    }
  }
  if (parts.length > 1 && await sha256(assembled) !== entry.sha256) throw new Error(`Reassembled runtime asset failed integrity verification: ${entry.name}`)
  return assembled.buffer
}

function corrupt(message) { return Object.assign(new Error(message), { code: 'RUNTIME_ASSET_CORRUPT' }) }
async function sha256(bytes) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('') }
