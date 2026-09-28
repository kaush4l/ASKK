/** Reassemble immutable runtime assets from individually verified hosting-sized parts. */
export async function verifiedAsset(entry, base, { fetch: fetcher = globalThis.fetch, onProgress = () => {}, onVerifying = () => {} } = {}) {
  if (!entry || !/^[a-zA-Z0-9_.-]+$/.test(entry.name) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > 1024 ** 3 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid runtime asset descriptor')
  const parts = entry.parts ?? [entry]
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > 32 || parts.reduce((sum, part) => sum + part.bytes, 0) !== entry.bytes) throw new Error('Invalid runtime asset parts')
  const assembled = new Uint8Array(entry.bytes)
  let offset = 0
  for (const part of parts) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(part.name) || !Number.isSafeInteger(part.bytes) || part.bytes < 0 || !/^[a-f0-9]{64}$/.test(part.sha256)) throw new Error('Invalid runtime asset part')
    const response = await fetcher(new URL(part.name, base))
    if (!response.ok) throw new Error(`Runtime asset unavailable: ${response.status} ${part.name}`)
    const reader = response.body?.getReader()
    let received = 0
    if (reader) {
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          if (received + value.byteLength > part.bytes) throw new Error(`Runtime asset size exceeded: ${part.name}`)
          assembled.set(value, offset + received); received += value.byteLength; onProgress(value.byteLength, part.name)
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    } else {
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.length !== part.bytes) throw new Error(`Runtime asset size mismatch: ${part.name}`)
      assembled.set(bytes, offset); received = bytes.length; onProgress(received, part.name)
    }
    if (received !== part.bytes) throw new Error(`Runtime asset size mismatch: ${part.name}`)
    onVerifying(part.name)
    if (await sha256(assembled.subarray(offset, offset + received)) !== part.sha256) throw new Error(`Runtime asset failed integrity verification: ${part.name}`)
    offset += received
  }
  if (parts.length > 1 && await sha256(assembled) !== entry.sha256) throw new Error(`Reassembled runtime asset failed integrity verification: ${entry.name}`)
  return assembled.buffer
}

async function sha256(bytes) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('') }
