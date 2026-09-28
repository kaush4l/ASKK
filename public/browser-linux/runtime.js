/** Trusted same-origin runtime frame. Generated application code never executes here. */
import { verifiedAsset, createDownloadProgress } from './assets.js'
import { acquireWorkspace } from './ownership.js'
import { installIDBFSSymlinks } from './idbfs-links.js'
import { browserRequestOptions } from './network-policy.js'
let port, projectId, base, runtime, booting
let fs, pollTimer, syncing = Promise.resolve()
let polling = false, restoreError
let releaseWorkspace
let networkRelay = null
const pending = new Map()
const checking = new Map()
let downloads
const emit = (event) => port?.postMessage({ event: event.type === 'runtime.progress' && downloads ? { ...event, progress: downloads.snapshot() } : event })
let consoleBuffer = '', consoleTimer
const consoleOut = (data) => { consoleBuffer += String(data); consoleTimer ??= setTimeout(() => { emit({ type: 'runtime.console', data: consoleBuffer }); consoleBuffer = ''; consoleTimer = undefined }, 20) }
const reply = (id, ok, result) => port.postMessage(ok ? { id, ok, result } : { id, ok, error: { code: result.code ?? 'RUNTIME_ERROR', message: result.message } })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const readJSON = (path) => JSON.parse(fs.readFile(path, { encoding: 'utf8' }))
addEventListener('error', (event) => emit({ type: 'runtime.error', error: event.error?.stack || `${event.message || 'The browser guest worker failed'} (${event.filename}:${event.lineno}:${event.colno})` }))
addEventListener('unhandledrejection', (event) => emit({ type: 'runtime.error', error: event.reason?.message || String(event.reason) }))

addEventListener('message', (event) => {
  if (port || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'askk-browser-linux' || !event.ports[0]) return
  port = event.ports[0]; projectId = event.data.projectId; base = event.data.base
  if (!/^[a-zA-Z0-9_.-]{1,120}$/.test(projectId)) return
  port.onmessage = async ({ data }) => {
    try {
      if (data.method === 'runtime.networkRelay') {
        networkRelay = data.params
        reply(data.id, true, { network: networkRelay ? 'companion-network-relay' : 'browser-fetch-cors' })
      } else if (data.method === 'runtime.prepare') {
        booting ??= boot()
        reply(data.id, true, await booting)
      } else {
        if (!fs) throw new Error('Guest is not ready')
        const result = await guest(data.id, data.method, data.params)
        if (['fs.write', 'fs.remove', 'fs.rename', 'fs.snapshot', 'runtime.shutdown'].includes(data.method)) await persist()
        if (data.method === 'runtime.shutdown') { releaseWorkspace?.(); releaseWorkspace = null }
        reply(data.id, true, result)
      }
    } catch (error) { reply(data.id, false, error) }
  }
  port.start()
})

async function verified(entry, assets) {
  emit({ type: 'runtime.progress', phase: 'Downloading', message: entry.name })
  let announced = downloads.snapshot().received
  const result = await verifiedAsset(entry, assets, {
    onProgress(bytes, name) { downloads.add(bytes); const received = downloads.snapshot().received; if (received - announced > 4 * 1024 * 1024) { announced = received; emit({ type: 'runtime.progress', phase: 'Downloading', message: name }) } },
    onVerifying(name) { emit({ type: 'runtime.progress', phase: 'Verifying', message: name }) },
  })
  emit({ type: 'runtime.progress', phase: 'Verifying', message: entry.name })
  return result
}

async function boot() {
  if (!crossOriginIsolated) throw Object.assign(new Error('Browser Linux requires cross-origin isolation'), { code: 'ISOLATION_REQUIRED' })
  // Otherwise the browser releases this lock when the owning frame is destroyed.
  releaseWorkspace = await acquireWorkspace(navigator.locks, projectId)
  const published = new URL('generated/', base)
  const response = await fetch(new URL('manifest.json', published), { cache: 'no-cache' })
  if (!response.ok) throw Object.assign(new Error('Browser Linux image is not installed. Run bun scripts/browser-linux/build.js and publish.js.'), { code: 'IMAGE_NOT_INSTALLED' })
  const manifest = await response.json()
  if (manifest.version !== 1 || !Array.isArray(manifest.files) || !/^[a-zA-Z0-9_.-]+$/.test(manifest.id) || manifest.files.some((file) => !/^[a-zA-Z0-9_.-]+$/.test(file.name))) throw new Error('Invalid runtime manifest')
  const assets = new URL(`${manifest.id}/`, published)
  const required = new Set(['qemu-system-aarch64.wasm', 'out.js', 'arg-module.js', 'load.js', 'network.js', 'network-worker.js', 'pty.js', 'network.wasm.gz', 'supervisor.js'])
  downloads = createDownloadProgress(manifest.files.filter((file) => required.has(file.name) || file.name.endsWith('.data')).reduce((total, file) => total + file.bytes, 0))
  const file = (name) => { const entry = manifest.files.find((f) => f.name === name); if (!entry) throw new Error(`Missing runtime asset ${name}`); return entry }
  emit({ type: 'runtime.progress', phase: 'Downloading', imageId: manifest.id })
  const wasmName = 'qemu-system-aarch64.wasm'
  const wasm = await verified(file(wasmName), assets)
  // Execute the exact verified bytes, including the URL passed to pthread imports.
  const executable = new Map()
  for (const name of ['out.js', 'arg-module.js', 'load.js', 'network.js', 'network-worker.js', 'pty.js']) executable.set(name, URL.createObjectURL(new Blob([await verified(file(name), assets)], { type: 'text/javascript' })))
  const networkWasm = URL.createObjectURL(new Blob([await verified(file('network.wasm.gz'), assets)], { type: 'application/gzip' }))
  const supervisorSource = new Uint8Array(await verified(file('supervisor.js'), assets))
  const { openpty } = await import(executable.get('pty.js'))
  const { master, slave } = openpty()
  const consoleDecoder = new TextDecoder()
  master.onWrite(([bytes, consumed]) => { consoleOut(consoleDecoder.decode(bytes, { stream: true })); consumed() })
  const workspace = `/workspaces/${projectId}`
  const module = { preRun: [], pty: slave, wasmBinary: wasm, mainScriptUrlOrBlob: executable.get('out.js'), locateFile: (name) => new URL(name, assets).href,
    print: (text) => consoleOut(`${text}\n`), printErr: (text) => consoleOut(`${text}\n`),
    onAbort: (error) => emit({ type: 'runtime.error', error: String(error) }), onRuntimeInitialized: () => emit({ type: 'runtime.progress', phase: 'Booting' }) }
  globalThis.Module = module
  const dataPackages = new Map()
  for (const entry of manifest.files.filter((file) => file.name.endsWith('.data'))) dataPackages.set(entry.name, await verified(entry, assets))
  module.getPreloadedPackage = (name) => { const key = name.split('/').at(-1); const data = dataPackages.get(key); dataPackages.delete(key); return data }
  module.preRun.push((mod) => {
    fs = mod.FS
    installIDBFSSymlinks(fs, mod.IDBFS)
    fs.mkdirTree(workspace)
    fs.mount(mod.IDBFS, {}, workspace)
    fs.mkdirTree('/harness-control/inbox'); fs.mkdirTree('/harness-control/outbox'); fs.mkdirTree('/harness-control/events')
    fs.writeFile('/harness-control/supervisor.js', supervisorSource)
    emit({ type: 'runtime.progress', phase: 'Restoring files' })
    mod.addRunDependency('restore-workspace')
    fs.syncfs(true, (error) => {
      if (error) restoreError = error
      else emit({ type: 'runtime.progress', phase: 'Booting' })
      mod.removeRunDependency('restore-workspace')
    })
  })
  // Use the nonblocking readiness adapter supplied by container2wasm's QEMU example.
  const readableCallbacks = []
  slave.onReadable(() => { for (const callback of readableCallbacks.splice(0)) callback() })
  module.preRun.push((mod) => {
    mod.TTY.stream_ops.poll = (_stream, _timeout, callback) => {
      if (slave.readable) return 1
      if (callback) { callback.registerCleanupFunc(() => { const index = readableCallbacks.indexOf(callback); if (index !== -1) readableCallbacks.splice(index, 1) }); readableCallbacks.push(callback) }
      return 0
    }
  })
  const { createContainerQEMUWasm, setBrowserFetch } = await import(executable.get('network.js'))
  setBrowserFetch(guestFetch)
  emit({ type: 'runtime.progress', phase: 'Compiling' })
  runtime = await createContainerQEMUWasm(module, executable.get('out.js'), '', executable.get('network-worker.js'), networkWasm, executable.get('arg-module.js'), executable.get('load.js'), (name) => new URL(name, assets).href, {
    extraInfo: `m:workspaces/${projectId}\nm:harness-control\ne:node\nc:/harness-control/supervisor.js\nenv:HARNESS_WORKSPACE=${workspace}\nenv:NODE_EXTRA_CA_CERTS=/.wasmenv/proxy.crt\nenv:NODE_OPTIONS=--use-env-proxy\n`,
    log: consoleOut,
  })
  if (restoreError) throw new Error(`Workspace restore failed: ${restoreError.message}`)
  if (!fs.analyzePath('/pack/info').exists) throw new Error('Guest configuration was not mounted into the packed filesystem')
  const deadline = Date.now() + 600000
  while (Date.now() < deadline) {
      let ready
      try {
        const failed = readJSON('/harness-control/failed.json')
        throw Object.assign(new Error(failed.error ?? 'Linux guest initialization failed'), { code: failed.code ?? 'GUEST_BOOT_FAILED' })
      } catch (error) { if (error.errno !== 44 && error.code !== 'ENOENT') throw error }
      try { ready = readJSON('/harness-control/ready.json') }
      catch (error) { if (error.errno !== 44 && error.code !== 'ENOENT') throw error; await sleep(100); continue }
      if (ready.version !== 1) throw new Error('Guest protocol version mismatch')
      pollTimer = setInterval(poll, 20)
      emit({ type: 'runtime.progress', phase: 'Checking tools' })
      const checkId = `check-${crypto.randomUUID()}`
      let finish
      const checked = new Promise((resolve) => { finish = resolve })
      checking.set(checkId, { resolve: finish, stdout: '', stderr: '' })
      const check = await guest(crypto.randomUUID(), 'job.start', { id: checkId, program: 'node', args: ['--version'], cwd: '.' })
      emit({ type: 'runtime.progress', phase: 'Checking tools', message: `Node version check started${check.pid ? ` (process ${check.pid})` : ''}` })
      const tools = await checked
      if (tools.code !== 0 || tools.stdout.trim() !== `v${ready.node}`) throw new Error(`Guest Node command check failed: ${tools.stderr || tools.stdout}`)
      emit({ type: 'runtime.progress', phase: 'Checking tools', message: 'Node command completed; checking shared files and persistence' })
      const testPath = `.harness-ready-${crypto.randomUUID()}`
      await guest(crypto.randomUUID(), 'fs.write', { path: testPath, content: checkId, expectedRevision: 0 })
      const read = await guest(crypto.randomUUID(), 'fs.read', { path: testPath })
      if (read.content !== checkId) throw new Error('Guest shared filesystem check failed')
      await guest(crypto.randomUUID(), 'fs.remove', { path: testPath, expectedRevision: read.revision })
      await persist()
      emit({ type: 'runtime.progress', phase: 'Ready' })
      return { ...ready, imageId: manifest.id, preparedTemplate: manifest.source?.preparedTemplate ?? null, network: networkRelay ? 'companion-network-relay' : 'browser-fetch-cors' }
  }
  throw new Error('Node guest did not complete its readiness handshake')
}

async function guestFetch(url, options = {}) {
  const relay = networkRelay
  if (!relay) {
    try { return await fetch(url, browserRequestOptions(url, options)) }
    catch (error) {
      // The upstream network shim converts rejected Fetch promises into503.
      // Keep the actual browser failure visible without logging private paths,
      // queries, or authentication headers. A failed request does not crash VM.
      consoleOut(`Browser network request failed for ${new URL(url).origin} (${error.name || 'Error'}); check this origin's CORS support or explicitly configure a network relay.\n`)
      throw error
    }
  }
  let bodyBase64
  if (options.body != null) {
    const bytes = new Uint8Array(await new Response(options.body).arrayBuffer())
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
    bodyBase64 = btoa(binary)
  }
  // The access token lives only in this trusted frame, never in the Linux guest.
  return fetch(`${relay.url}/network/fetch`, { method: 'POST', credentials: 'omit', signal: options.signal,
    headers: { Authorization: `Bearer ${relay.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, method: options.method ?? 'GET', headers: Object.fromEntries(new Headers(options.headers)), bodyBase64, stream: true }) })
}

function guest(id, method, params) {
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    const temp = `/harness-control/inbox/${id}.tmp`
    fs.writeFile(temp, JSON.stringify({ version: 1, id, method, params }))
    fs.rename(temp, `/harness-control/inbox/${id}.json`)
  })
}

async function poll() {
  if (polling) return
  polling = true
  try {
    for (const name of fs.readdir('/harness-control/outbox').filter((name) => name.endsWith('.json'))) {
      const path = `/harness-control/outbox/${name}`
      const response = readJSON(path); fs.unlink(path)
      const request = pending.get(response.id)
      if (request) { pending.delete(response.id); response.ok ? request.resolve(response.result) : request.reject(Object.assign(new Error(response.error.message), { code: response.error.code })) }
    }
    for (const name of fs.readdir('/harness-control/events').filter((name) => name.endsWith('.json')).sort()) {
      const path = `/harness-control/events/${name}`
      const event = readJSON(path); fs.unlink(path)
      if (event.type === 'job.exit') await persist()
      if (checking.has(event.jobId)) {
        const check = checking.get(event.jobId)
        if (event.type === 'job.output') check[event.stream === 'stderr' ? 'stderr' : 'stdout'] += new TextDecoder().decode(Uint8Array.from(atob(event.data), (c) => c.charCodeAt(0)))
        if (event.type === 'job.error') check.stderr += event.error
        if (event.type === 'job.exit') { check.resolve({ ...event, stdout: check.stdout, stderr: check.stderr }); checking.delete(event.jobId) }
      } else emit(event)
    }
  } catch (error) { clearInterval(pollTimer); emit({ type: 'runtime.error', error: error.message }) }
  finally { polling = false }
}

function persist() {
  // Reject the failed operation, but allow a later explicit save to retry storage.
  syncing = syncing.catch(() => {}).then(() => new Promise((resolve, reject) => fs.syncfs(false, (error) => error ? reject(error) : resolve())) )
  return syncing
}
