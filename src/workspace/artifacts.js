import { parse, serialize } from 'parse5'
import { snapshot } from '../core/prompt.js'
import { ARTIFACT_TIMING, artifactClock, artifactInspectionBudget, artifactSegmentMs, settleArtifactStorage } from './artifact-timing.js'

// Form events are needed for client-side React handlers. Native submissions
// remain forbidden by the artifact's form-action 'none' CSP. Never add
// allow-same-origin: generated code must retain its opaque origin.
export const ARTIFACT_SANDBOX = 'allow-scripts allow-forms'

const text = bytes => new TextDecoder().decode(bytes)
const unbase64 = value => Uint8Array.from(atob(value), char => char.charCodeAt(0))
const encode = bytes => { let value = ''; for (const byte of bytes) value += String.fromCharCode(byte); return btoa(value) }
const attribute = (node, name) => node.attrs?.find(attr => attr.name === name)?.value
const putAttribute = (node, name, value) => { node.attrs ??= []; node.attrs = node.attrs.filter(attr => attr.name !== name); node.attrs.push({ name, value }) }
const scriptSafe = value => String(value).replace(/<\/script/gi, '<\\/script')
const nodeText = (node, value) => { node.childNodes = [{ nodeName: '#text', value, parentNode: node }] }

// This deliberately accepts a small CSS asset grammar. Unhandled URL-bearing
// syntax must fail packaging instead of producing a preview with missing assets.
function packageCSS(source, resolve) {
  let result = ''; let cursor = 0
  const stringEnd = start => {
    const quote = source[start]; let end = start + 1
    for (; end < source.length; end++) {
      if (source[end] === '\\') { end++; continue }
      if (source[end] === quote) return end + 1
      if (source[end] === '\n' || source[end] === '\r') break
    }
    throw new Error('Unterminated CSS string in artifact')
  }
  while (cursor < source.length) {
    const start = cursor
    if (source.startsWith('/*', cursor)) {
      const end = source.indexOf('*/', cursor + 2)
      if (end === -1) throw new Error('Unterminated CSS comment in artifact')
      cursor = end + 2; result += source.slice(start, cursor); continue
    }
    if (source[cursor] === '"' || source[cursor] === "'") {
      cursor = stringEnd(cursor); result += source.slice(start, cursor); continue
    }
    if (source[cursor] === '\\') throw new Error('Escaped CSS identifiers are outside the single-page artifact profile')
    const word = /^[a-z_-][\w-]*/i.exec(source.slice(cursor))?.[0]
    if (!word) { result += source[cursor++]; continue }
    cursor += word.length
    const name = word.toLowerCase()
    if (source[start - 1] === '@' && name === 'import') throw new Error('CSS @import is unsupported; include local stylesheets with link elements')
    let opening = cursor
    while (/\s/.test(source[opening] ?? '') && opening < source.length) opening++
    if (source[opening] !== '(') { result += word; continue }
    if (name === 'image-set' || name === '-webkit-image-set' || name === 'src') throw new Error(`CSS ${name}() resources are outside the single-page artifact profile; use url()`)
    if (name !== 'url') { result += word; continue }
    cursor = opening + 1
    while (/\s/.test(source[cursor] ?? '') && cursor < source.length) cursor++
    let reference
    if (source[cursor] === '"' || source[cursor] === "'") {
      const end = stringEnd(cursor); reference = source.slice(cursor + 1, end - 1); cursor = end
      while (/\s/.test(source[cursor] ?? '') && cursor < source.length) cursor++
    } else {
      const end = source.indexOf(')', cursor)
      if (end === -1) throw new Error('Unterminated CSS url() in artifact')
      reference = source.slice(cursor, end).trim(); cursor = end
      if (/[\s'"(]/.test(reference)) throw new Error('Unsupported CSS url(); quote asset paths containing spaces')
    }
    if (source[cursor] !== ')' || !reference || reference.includes('\\')) throw new Error('Unsupported CSS url() in artifact')
    cursor++; result += `url(${JSON.stringify(resolve(reference))})`
  }
  return result
}

/** Only immutable local resources enter this opaque frame. No companion authority is passed. */
export async function packageArtifact(snapshot, { revision, runtime, name = 'Application preview' } = {}) {
  const files = new Map(snapshot.files.map(file => [file.path.replace(/^out\//, ''), file.bytes ?? (file.base64 != null ? unbase64(file.base64) : new TextEncoder().encode(file.content ?? ''))]))
  if (!files.has('index.html')) throw new Error('The build did not produce out/index.html. Enable Next static export.')
  const errorPages = new Set(['404.html', '404/index.html', '_not-found.html', '_not-found/index.html'])
  for (const path of files.keys()) if (/\.html?$/i.test(path) && path !== 'index.html' && !errorPages.has(path)) throw new Error(`Multiple routes are outside the single-page artifact profile: ${path}`)
  const doc = parse(text(files.get('index.html'))); const resources = new Set(); const id = `artifact-${crypto.randomUUID()}`; const nonce = crypto.randomUUID()
  const pathFor = (reference, parent = 'index.html') => {
    reference = reference.trim()
    if (reference.startsWith('data:') || reference.startsWith('#')) return null
    const url = new URL(reference, `https://artifact.invalid/${parent}`)
    if (url.origin !== 'https://artifact.invalid') throw new Error(`External artifact resource is unsupported: ${reference}`)
    const path = decodeURIComponent(url.pathname.slice(1)); if (!files.has(path)) throw new Error(`Missing artifact resource: ${path}`); resources.add(path); return path
  }
  const dataURL = (reference, parent) => { const path = pathFor(reference, parent); if (!path) return reference; const type = snapshot.files.find(file => file.path.replace(/^out\//, '') === path)?.mime ?? ({ svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf' }[path.split('.').pop().toLowerCase()] || 'application/octet-stream'); const fragment = new URL(reference, `https://artifact.invalid/${parent ?? 'index.html'}`).hash; return `data:${type};base64,${encode(files.get(path))}${fragment}` }
  const inlineCSS = (source, parent) => packageCSS(source, reference => dataURL(reference, parent))
  function visit(node) {
    if (node.tagName === 'base') throw new Error('Custom base URLs are outside the single-page artifact profile')
    if (node.tagName === 'meta' && attribute(node, 'http-equiv')?.toLowerCase() === 'refresh') throw new Error('Artifact redirects are outside the single-page artifact profile')
    if (node.tagName === 'style') nodeText(node, inlineCSS((node.childNodes ?? []).map(child => child.value ?? '').join(''), 'index.html'))
    const style = attribute(node, 'style'); if (style) putAttribute(node, 'style', inlineCSS(style, 'index.html'))
    if (node.tagName === 'script') {
      if (attribute(node, 'type')?.toLowerCase() === 'module') throw new Error('Module scripts and lazy imports are outside the single-page webpack artifact profile')
      const src = attribute(node, 'src')
      if (src) {
        const path = pathFor(src)
        if (!path) throw new Error('Script sources must be local emitted files')
        node.attrs = node.attrs.filter(attr => !['src', 'integrity', 'crossorigin', 'async', 'defer'].includes(attr.name))
        // Inlining removes the network attribute, but Next's bootstrap still reads
        // currentScript.src to derive its asset prefix. A property on this one
        // element preserves that metadata without initiating a resource request.
        const sourceURL = new URL(src, 'https://artifact.invalid/').href
        nodeText(node, scriptSafe(`Object.defineProperty(document.currentScript,"src",{value:${JSON.stringify(sourceURL)}});\n${text(files.get(path))}`))
      }
    }
    if (node.tagName === 'link') {
      const rel = attribute(node, 'rel'); const href = attribute(node, 'href')
      if (rel === 'stylesheet' && href) {
        const path = pathFor(href); if (!path) throw new Error('Stylesheets must be local emitted files')
        if (attribute(node, 'disabled') != null || attribute(node, 'title')) throw new Error('Switchable stylesheets are outside the single-page artifact profile')
        // React's resource cache identifies an emitted stylesheet by its original
        // link href. Keep that identity inert: an initially disabled stylesheet
        // is not fetched (HTML's stylesheet fetch setup steps). Its actual bytes
        // live in the adjacent style, with media and precedence preserved.
        // Without this link, Next hydration recreates it and attempts a network
        // fetch inside our deliberately network-free sandbox.
        const inlined = { nodeName: 'style', tagName: 'style', namespaceURI: node.namespaceURI, parentNode: node.parentNode,
          attrs: node.attrs.filter(attr => ['media', 'data-precedence'].includes(attr.name)).map(attr => ({ ...attr })), childNodes: [] }
        putAttribute(inlined, 'data-href', href)
        nodeText(inlined, inlineCSS(text(files.get(path)), path))
        putAttribute(node, 'disabled', '')
        node.parentNode.childNodes.splice(node.parentNode.childNodes.indexOf(node) + 1, 0, inlined)
      }
      else if (rel?.includes('preload') || rel === 'prefetch' || rel === 'modulepreload') { node.tagName = 'meta'; node.nodeName = 'meta'; node.attrs = [] }
      else if (href && (rel === 'icon' || rel === 'apple-touch-icon')) putAttribute(node, 'href', dataURL(href))
    }
    if (['img', 'source', 'video', 'audio'].includes(node.tagName)) {
      const src = attribute(node, 'src'); if (src) putAttribute(node, 'src', dataURL(src))
      const srcset = attribute(node, 'srcset'); if (srcset) throw new Error('Responsive srcset requires an artifact renderer with resource serving. Use a local image src for this profile.')
    }
    if (node.tagName === 'video' && attribute(node, 'poster')) putAttribute(node, 'poster', dataURL(attribute(node, 'poster')))
    if (node.tagName === 'image') for (const attr of node.attrs ?? []) if (attr.name === 'href') attr.value = dataURL(attr.value)
    if (node.tagName === 'iframe') throw new Error('Nested frames are outside the single-page artifact profile')
    for (const child of node.childNodes ?? []) visit(child)
    if (node.content) visit(node.content)
  }
  visit(doc)
  const source = serialize(doc)
  const bootstrap = `(${installArtifactLocationProfile.toString()})(window);(${artifactBootstrap.toString()})(${JSON.stringify({ id, nonce })},${settleArtifactStorage.toString()});`
  const policy = "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"
  const html = source.replace(/<head>/i, `<head><meta http-equiv="Content-Security-Policy" content="${policy}"><script>${scriptSafe(bootstrap)}</script>`)
  return { id, nonce, name, type: 'application', html, url: URL.createObjectURL(new Blob([html], { type: 'text/html' })), revision, runtime, buildId: snapshot.revision ?? id, resources: [...resources], at: Date.now(), status: 'ready' }
}

/** A bounded virtual URL for single-page Next hydration; the actual sandbox stays opaque. */
export function installArtifactLocationProfile(realm = window) {
  const NativeURL = realm.URL; const original = realm.location.href
  if (original !== 'about:srcdoc' && !original.startsWith('blob:')) return
  const canonical = realm.location.pathname + realm.location.search + realm.location.hash
  const root = 'https://artifact.invalid/'
  class ArtifactURL extends NativeURL {
    constructor(input, base) {
      const value = String(input); const frameBase = base != null && String(base) === original
      super(value === original || frameBase && value === canonical ? root : input, frameBase ? root : base)
    }
    static canParse(input, base) { try { new ArtifactURL(input, base); return true } catch { return false } }
    static parse(input, base) { try { return new ArtifactURL(input, base) } catch { return null } }
  }
  realm.URL = ArtifactURL
  for (const method of ['pushState', 'replaceState']) {
    const native = realm.history[method].bind(realm.history)
    realm.history[method] = (state, title, url) => {
      if (url != null) {
        const target = new ArtifactURL(url, original)
        if (target.origin !== 'https://artifact.invalid' || target.pathname !== '/') throw new Error('Navigation is outside the single-page artifact profile')
      }
      // Preserve Next's history state without rewriting the non-hierarchical URL.
      return native(state, title)
    }
  }
}

function artifactBootstrap({ id, nonce }, settleStorage) {
  // Capture platform operations before application code runs in this realm.
  // Application code never receives the private inspection MessagePort.
  const apply = Reflect.apply
  const bind = (method, target) => (...args) => apply(method, target, args)
  const add = EventTarget.prototype.addEventListener
  const send = MessagePort.prototype.postMessage
  const start = MessagePort.prototype.start
  const stop = Event.prototype.stopImmediatePropagation
  const query = bind(Document.prototype.querySelector, document)
  const queryAll = bind(Document.prototype.querySelectorAll, document)
  const getText = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent').get
  const getTag = Object.getOwnPropertyDescriptor(Element.prototype, 'tagName').get
  const getLength = Object.getOwnPropertyDescriptor(NodeList.prototype, 'length').get
  const click = HTMLElement.prototype.click
  const dispatch = EventTarget.prototype.dispatchEvent
  const inputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  const textareaValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  const includes = String.prototype.includes
  const push = Array.prototype.push
  const NativeEvent = Event; const NativeFocusEvent = FocusEvent; const NativePromise = Promise; const NativeError = Error
  const timeout = window.setTimeout.bind(window); const clear = window.clearTimeout.bind(window)
  const now = performance.now.bind(performance)
  const postParent = parent.postMessage.bind(parent)
  let port; let serial = 0; const waiting = new Map(); const errors = []
  const pendingGet = waiting.get.bind(waiting); const pendingSet = waiting.set.bind(waiting); const pendingDelete = waiting.delete.bind(waiting)
  const pendingEach = waiting.forEach.bind(waiting)
  const post = data => apply(send, port, [data])
  const record = error => apply(push, errors, [String(error)])
  const request = (method, params) => new NativePromise((resolve, reject) => {
    const requestId = ++serial
    const timer = timeout(() => { pendingDelete(requestId); reject(new NativeError('Artifact storage did not answer')) }, 10000)
    pendingSet(requestId, { resolve: value => { clear(timer); resolve(value) }, reject: error => { clear(timer); reject(error) }, method, params, deadline: now() + 10000 })
    if (port) post({ method, params, requestId })
  })
  Object.defineProperty(window, 'askkArtifact', { value: Object.freeze({ storage: Object.freeze({ get: key => request('storage.get', { key }), set: (key, value) => request('storage.set', { key, value }) }) }), writable: false, configurable: false })
  apply(add, window, ['error', event => record(event.message || 'An artifact resource failed to load'), true])
  apply(add, window, ['unhandledrejection', event => record(event.reason), true])
  apply(add, window, ['securitypolicyviolation', event => record(`Blocked artifact resource: ${event.blockedURI}`), true])
  apply(add, window, ['message', event => {
    if (!event.isTrusted || event.source !== parent || event.data?.type !== 'askk.connect' || event.data.id !== id || event.data.nonce !== nonce || !event.ports[0]) return
    apply(stop, event, [])
    if (port) return
    port = event.ports[0]
    apply(add, port, ['message', async ({ data }) => {
      if (data.replyTo) { const item = pendingGet(data.replyTo); pendingDelete(data.replyTo); if (item) { const error = now() >= item.deadline ? 'Artifact storage did not answer before its deadline' : data.error; if (error) { if (item.method === 'storage.set') record(`Artifact storage write failed: ${error}`); item.reject(new NativeError(error)) } else item.resolve(data.value) } return }
      if (data.method === 'drain') {
        const settled = await settleStorage({ now, timeoutMs: data.timeoutMs, sleep: ms => new NativePromise(resolve => timeout(resolve, ms)), hasPending: () => { let outstanding = false; pendingEach(() => { outstanding = true }); return outstanding } })
        if (settled) { post({ replyTo: data.requestId, result: { ok: errors.length === 0, errors } }); return }
        record('Artifact storage did not settle before reload')
        post({ replyTo: data.requestId, result: { ok: false, errors } }); return
      }
      if (data.method !== 'inspect') return
      const results = []
      const deadline = now() + data.timeoutMs
      try {
        for (let index = 0; index < data.assertions.length; index++) {
          if (now() >= deadline) throw new NativeError('Artifact inspection timed out')
          const assertion = data.assertions[index]
          const element = query(assertion.selector)
          if (assertion.action === 'click') { if (!element) throw new NativeError(`No element: ${assertion.selector}`); apply(click, element, []) }
          else if (assertion.action === 'fill') {
            if (!element) throw new NativeError(`No element: ${assertion.selector}`)
            apply(apply(getTag, element, []) === 'TEXTAREA' ? textareaValue : inputValue, element, [assertion.value])
            apply(dispatch, element, [new NativeEvent('input', { bubbles: true })]); apply(dispatch, element, [new NativeEvent('change', { bubbles: true })])
          }
          else if (assertion.action === 'blur') {
            if (!element) throw new NativeError(`No element: ${assertion.selector}`)
            // This is an explicit DOM lifecycle action, not a claim about trusted
            // keyboard focus. Moving real focus would interrupt the owner's composer.
            apply(dispatch, element, [new NativeFocusEvent('blur', { bubbles: false, relatedTarget: null })])
            apply(dispatch, element, [new NativeFocusEvent('focusout', { bubbles: true, relatedTarget: null })])
          }
          else if (assertion.action === 'assertText') { if (!element || !apply(includes, apply(getText, element, []), [assertion.value])) throw new NativeError(`Expected text at ${assertion.selector}`) }
          else if (assertion.action === 'assertCount') { const count = apply(getLength, queryAll(assertion.selector), []); if (count !== assertion.count) throw new NativeError(`Expected ${assertion.count} matches at ${assertion.selector}, found ${count}`) }
          else throw new NativeError('Unknown assertion action')
          await new NativePromise(resolve => timeout(resolve, 80))
          if (now() >= deadline) throw new NativeError('Artifact inspection timed out')
          apply(push, results, [{ index, ok: true }])
        }
        post({ replyTo: data.requestId, result: { ok: errors.length === 0, results, errors } })
      } catch (error) { record(error.message); post({ replyTo: data.requestId, result: { ok: false, results, errors } }) }
    }])
    apply(start, port, [])
    pendingEach((item, requestId) => post({ method: item.method, params: item.params, requestId }))
    post({ type: 'connected' })
  }, true])
  apply(add, window, ['DOMContentLoaded', event => { if (event.isTrusted) postParent({ type: 'askk.artifact.ready', id, nonce }, '*') }, true])
}

export function validateAssertions(assertions, { requireInteraction = true, requireOutcome = true, allowReload = true } = {}) {
  if (!Array.isArray(assertions) || !assertions.length || assertions.length > 100) throw new Error('Supply between 1 and 100 concrete DOM assertions')
  let lastInteraction = -1; let lastOutcome = -1; let pendingReload = false; let hasInteraction = false
  const plan = assertions.map((row, index) => {
    if (row?.action === 'reload') {
      if (!allowReload) throw new Error('Reload is controlled by the parent artifact inspector')
      if (pendingReload) throw new Error('Assert the restored state after reload before another reload')
      if (row.selector != null || row.value != null || row.count != null) throw new Error('Reload does not accept a selector, value, or count')
      pendingReload = true
      return Object.freeze({ action: 'reload' })
    }
    if (!row || typeof row.selector !== 'string' || !row.selector.trim() || row.selector.length > 1000) throw new Error(`Check ${index + 1} needs a CSS selector`)
    const item = { action: row.action, selector: row.selector }
    if (row.action === 'fill' || row.action === 'assertText') {
      if (typeof row.value !== 'string' || row.value.length > 10000 || row.action === 'assertText' && !row.value.trim()) throw new Error(`Check ${index + 1} needs a concrete text value`)
      item.value = row.value
    } else if (row.action === 'assertCount') {
      if (!Number.isSafeInteger(row.count) || row.count < 0 || row.count > 10000) throw new Error(`Check ${index + 1} needs a nonnegative integer count`)
      item.count = row.count
    } else if (!['click', 'blur'].includes(row.action)) throw new Error(`Unsupported check action: ${row.action}`)
    if (['click', 'fill', 'blur'].includes(row.action)) { if (pendingReload) throw new Error('Assert the restored state after reload before another interaction'); lastInteraction = index; if (row.action !== 'blur') hasInteraction = true }
    else { lastOutcome = index; pendingReload = false }
    return Object.freeze(item)
  })
  if (pendingReload || requireOutcome && (lastOutcome < 0 || lastOutcome < lastInteraction) || requireInteraction && !hasInteraction) throw new Error('Include an interaction followed by an assertion about its resulting state, including after reload')
  return Object.freeze(plan)
}

/** Session grants only project/artifact storage and inspection, never host or model capabilities. */
export function artifactFrameURL(artifact, base = document.baseURI) {
  const url = new URL('artifact-preview.html', base)
  url.searchParams.set('id', artifact.id); url.searchParams.set('nonce', artifact.nonce)
  return url.href
}

/** srcdoc inherits the isolated parent's policy without an HTTP navigation needing server headers. */
export function mountArtifactFrame(frame, artifact) { frame.setAttribute('sandbox', ARTIFACT_SANDBOX); frame.removeAttribute('src'); frame.srcdoc = artifact.html }

export function attachArtifact(frame, artifact, { storageKey = 'default', onReady = () => {}, deadline = Infinity, clock = artifactClock() } = {}) {
  const channel = new MessageChannel(); const pending = new Map(); let ready = false; let connected = false; let closed = false
  const handle = event => {
    if (closed || connected || !event.isTrusted || event.source !== frame.contentWindow || event.data?.id !== artifact.id || event.data.nonce !== artifact.nonce) return
    if (event.data.type === 'askk.artifact.shell') { frame.contentWindow.postMessage({ type: 'askk.artifact.html', id: artifact.id, nonce: artifact.nonce, html: artifact.html }, '*'); return }
    if (event.data.type !== 'askk.artifact.ready') return
    connected = true
    frame.contentWindow.postMessage({ type: 'askk.connect', id: artifact.id, nonce: artifact.nonce }, '*', [channel.port2])
  }
  window.addEventListener('message', handle)
  channel.port1.onmessage = ({ data }) => {
    if (closed) return
    if (data.type === 'connected') { ready = true; onReady(); return }
    if (data.replyTo) {
      const item = pending.get(data.replyTo); if (!item) return
      pending.delete(data.replyTo); clock.clearTimeout(item.timer)
      if (clock.now() >= item.deadline) { item.resolve({ ok: false, errors: [item.timeoutError] }); return }
      const result = data.result
      const validErrors = Array.isArray(result?.errors) && result.errors.every(error => typeof error === 'string')
      const validResults = item.method === 'drain' || Array.isArray(result?.results) && result.results.length <= item.plan.length && result.results.every((row, index) => row.index === index && row.ok === true)
      const valid = result && typeof result.ok === 'boolean' && validErrors && validResults && (result.ok ? result.errors.length === 0 && (item.method === 'drain' || result.results.length === item.plan.length) : result.errors.length > 0)
      item.resolve(snapshot(valid ? { ok: result.ok, errors: [...result.errors], ...(item.method === 'drain' ? {} : { results: result.results.map(row => ({ index: row.index, ok: true })) }) } : { ok: false, errors: ['Malformed artifact check receipt'] })); return
    }
    if (!['storage.get', 'storage.set'].includes(data.method) || typeof data.params?.key !== 'string') return
    const key = `askk:artifact-storage:${storageKey}:${data.params.key.slice(0, 200)}`
    try {
      let value
      if (data.method === 'storage.get') value = JSON.parse(localStorage.getItem(key) ?? 'null')
      else { const serialized = JSON.stringify(data.params.value); if (serialized.length > 1024 * 1024) throw new Error('Artifact storage value exceeds 1 MiB'); localStorage.setItem(key, serialized); value = true }
      channel.port1.postMessage({ replyTo: data.requestId, value })
    } catch (error) { channel.port1.postMessage({ replyTo: data.requestId, error: error.message }) }
  }
  channel.port1.start()
  const request = (method, plan) => {
    if (closed || !ready) return Promise.resolve({ ok: false, errors: ['Artifact is not connected'] })
    const timeoutError = method === 'inspect' ? 'Artifact inspection timed out' : 'Artifact storage drain timed out'
    const started = clock.now()
    const expires = Math.min(deadline, started + (method === 'inspect' ? artifactSegmentMs(plan.length) : ARTIFACT_TIMING.drainMs))
    if (started >= expires) return Promise.resolve({ ok: false, errors: [timeoutError] })
    const requestId = crypto.randomUUID()
    return new Promise(resolve => {
      const timer = clock.setTimeout(() => { pending.delete(requestId); resolve({ ok: false, errors: [timeoutError] }) }, expires - started)
      pending.set(requestId, { resolve, plan, timer, method, deadline: expires, timeoutError })
      // Send a duration, because separate realms need not share a performance time origin.
      channel.port1.postMessage({ method, requestId, ...(plan ? { assertions: plan } : {}), timeoutMs: Math.min(expires - started, method === 'drain' ? ARTIFACT_TIMING.storageMs : Infinity) })
    })
  }
  return {
    get ready() { return ready },
    inspect(assertions) { return request('inspect', validateAssertions(assertions, { requireInteraction: false, requireOutcome: false, allowReload: false })) },
    drain() { return request('drain') },
    dispose() { closed = true; window.removeEventListener('message', handle); channel.port1.close(); for (const { resolve, timer } of pending.values()) { clock.clearTimeout(timer); resolve({ ok: false, errors: ['Artifact was closed'] }) } pending.clear() },
  }
}

export async function inspectArtifact(artifact, assertions, { clock = artifactClock() } = {}) {
  const plan = validateAssertions(assertions, { requireInteraction: false })
  // Reject oversized plans before granting a frame any capabilities or taking actions.
  const budget = artifactInspectionBudget(plan); const started = clock.now(); const deadline = started + budget.totalMs
  const results = []; const storageKey = `checks:${artifact.id}:${crypto.randomUUID()}`
  let frame; let session; let timer; let bootTimer; let readyTimer; let cancelled = false; let generation = 0
  const receipt = result => snapshot({ ...result, interactionMode: 'programmatic-dom', results: [...results], assertions: plan, artifactId: artifact.id, revision: artifact.revision, buildId: artifact.buildId, checkedAt: Date.now(), timing: { budgetMs: budget.totalMs, elapsedMs: Math.max(0, clock.now() - started) } })
  const assertActive = () => { if (cancelled || clock.now() >= deadline) throw new Error('Artifact inspection exceeded its plan time budget') }
  const close = () => { clock.clearTimeout(bootTimer); clock.clearTimeout(readyTimer); session?.dispose(); frame?.remove(); session = null; frame = null }
  const boot = () => new Promise((resolve, reject) => {
    try { assertActive() } catch (error) { reject(error); return }
    const bootDeadline = Math.min(deadline, clock.now() + ARTIFACT_TIMING.bootMs)
    frame = document.createElement('iframe'); frame.style.cssText = 'position:fixed;left:-2000px;top:0;width:1280px;height:800px;border:0'; frame.setAttribute('aria-hidden', 'true')
    bootTimer = clock.setTimeout(() => reject(new Error('Artifact did not become inspectable within 15 seconds')), bootDeadline - clock.now())
    session = attachArtifact(frame, artifact, { storageKey, clock, deadline, onReady: () => {
      clock.clearTimeout(bootTimer)
      try { assertActive(); if (clock.now() >= bootDeadline) throw new Error('Artifact did not become inspectable within 15 seconds') } catch (error) { reject(error); return }
      // A short bounded settling interval is not a claim that the app hydrated.
      // Concrete post-interaction outcomes remain the acceptance evidence.
      const settleDeadline = Math.min(deadline, clock.now() + ARTIFACT_TIMING.settleMs)
      readyTimer = clock.setTimeout(() => {
        try { assertActive(); if (clock.now() >= settleDeadline) throw new Error('Artifact settling exceeded its time budget'); resolve() } catch (error) { reject(error) }
      }, ARTIFACT_TIMING.settleDelayMs)
    } })
    mountArtifactFrame(frame, artifact); document.body.append(frame)
  })
  const execute = async () => {
    await boot(); assertActive()
    for (let index = 0; index < plan.length;) {
      assertActive()
      if (plan[index].action === 'reload') {
        const drained = await session.drain(); assertActive()
        if (!drained.ok) return receipt(drained)
        close(); generation++; await boot(); assertActive()
        results.push({ index, action: 'reload', ok: true, frame: generation }); index++
      } else {
        let end = index + 1; while (end < plan.length && plan[end].action !== 'reload') end++
        const checked = await session.inspect(plan.slice(index, end)); assertActive()
        for (const result of checked.results ?? []) results.push({ index: index + result.index, action: plan[index + result.index].action, ok: true, frame: generation })
        if (!checked.ok) return receipt(checked)
        index = end
      }
    }
    const drained = await session.drain(); assertActive()
    return receipt(drained)
  }
  try {
    return await Promise.race([execute().catch(error => receipt({ ok: false, errors: [error.message] })), new Promise(resolve => {
      timer = clock.setTimeout(() => { cancelled = true; resolve(receipt({ ok: false, errors: ['Artifact inspection exceeded its plan time budget'] })) }, Math.max(0, deadline - clock.now()))
    })])
  } finally {
    cancelled = true; clock.clearTimeout(timer); close()
    try { for (let index = localStorage.length - 1; index >= 0; index--) { const key = localStorage.key(index); if (key?.startsWith(`askk:artifact-storage:${storageKey}:`)) localStorage.removeItem(key) } } catch {}
  }
}
