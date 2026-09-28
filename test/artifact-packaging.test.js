import { test, expect } from 'bun:test'
import { runInNewContext } from 'node:vm'
import { parse } from 'parse5'
import { packageArtifact } from '../src/workspace/artifacts.js'

const file = (path, content) => ({ path, content })
async function pack(html, files = []) {
  const artifact = await packageArtifact({ files: [file('index.html', html), ...files] })
  URL.revokeObjectURL(artifact.url)
  return artifact
}
function elements(node, tag) {
  return [...(node.tagName === tag ? [node] : []), ...(node.childNodes ?? []).flatMap(child => elements(child, tag))]
}

// Execute the shipped bootstrap in its own realm. Application mutations happen
// after bootstrap, just as they do in the opaque preview, not in a test helper.
async function inspectText({ actual, expected, tamper = false }) {
  const artifact = await pack('<main>Diagnostic fixture</main>')
  const script = elements(parse(artifact.html), 'script')[0].childNodes[0].value
  const realm = { actual, expected, artifactId: artifact.id, artifactNonce: artifact.nonce, queueMicrotask, URL }
  runInNewContext(`
    class EventTarget {
      listeners = new Map();
      addEventListener(type, listener) { this.listeners.set(type, listener) }
      dispatchEvent(event) { return this.listeners.get(event.type)?.(event) }
    }
    class Event { stopImmediatePropagation() {} }
    class FocusEvent extends Event {}
    class Node extends EventTarget { get textContent() { return actual } }
    class Element extends Node { get tagName() { return 'MAIN' } }
    class HTMLElement extends Element { click() {} }
    class HTMLInputElement extends HTMLElement { set value(value) {} }
    class HTMLTextAreaElement extends HTMLElement { set value(value) {} }
    class NodeList { get length() { return 0 } }
    class Document extends Node {
      querySelector() { return actual == null ? null : new HTMLElement() }
      querySelectorAll() { return new NodeList() }
    }
    class MessagePort extends EventTarget {
      sent = [];
      postMessage(value) { this.sent.push(value) }
      start() {}
    }
    var document = new Document(), window = new EventTarget(), parent = { postMessage() {} };
    window.location = { href: 'https://artifact.invalid/' }; window.URL = URL;
    window.setTimeout = callback => queueMicrotask(callback); window.clearTimeout = () => {};
    var performance = { now: () => 0 }, port = new MessagePort();
    ${script}
    ${tamper ? `
      Object.defineProperty(Node.prototype, 'textContent', { get: () => expected });
      String.prototype.includes = () => true;
      String.prototype.slice = () => 'FORGED SLICE';
      JSON.stringify = () => 'FORGED JSON';
    ` : ''}
  `, realm)
  return await runInNewContext(`(async () => {
    window.listeners.get('message')({ isTrusted: true, source: parent,
      data: { type: 'askk.connect', id: artifactId, nonce: artifactNonce }, ports: [port] });
    await port.listeners.get('message')({ data: { method: 'inspect', requestId: 'check', timeoutMs: 1000,
      assertions: [{ action: 'assertText', selector: '#task-title', value: expected }] } });
    return port.sent.find(message => message.replyTo === 'check').result;
  })()`, realm)
}

test('failed text checks expose bounded actual and expected text using captured native operations', async () => {
  const actual = 'A'.repeat(320) + 'PRIVATE TAIL'; const expected = 'B'.repeat(320) + 'EXPECTED TAIL'
  const receipt = await inspectText({ actual, expected, tamper: true })
  expect(receipt.ok).toBe(false)
  expect(receipt.results).toEqual([])
  expect(receipt.errors).toEqual([`Expected text "${'B'.repeat(299)}…" at #task-title; actual text "${'A'.repeat(299)}…"`])
  expect(receipt.errors[0]).not.toContain('TAIL')
  expect(receipt.errors[0]).not.toContain('FORGED')
})

test('text diagnostics distinguish a missing element from an existing empty element', async () => {
  const missing = await inspectText({ actual: null, expected: 'New task' })
  const empty = await inspectText({ actual: '', expected: 'New task' })
  expect(missing.errors).toEqual(['No element at #task-title; expected text "New task"'])
  expect(empty.errors).toEqual(['Expected text "New task" at #task-title; actual text ""'])
  expect((await inspectText({ actual: 'New task ready', expected: 'New task' })).ok).toBe(true)
})

test('inlined Next scripts retain currentScript source metadata without a network src attribute', async () => {
  const source = 'globalThis.prefix = new URL(document.currentScript.src).pathname.split("/_next/")[0]'
  const artifact = await pack('<script async src="/_next/static/main.js"></script>', [file('_next/static/main.js', source)])
  const script = elements(parse(artifact.html), 'script').find(node => node.childNodes[0]?.value.includes(source))
  expect(script.attrs.some(attr => ['src', 'async', 'defer'].includes(attr.name))).toBe(false)
  let requests = 0
  const currentScript = Object.create({ set src(value) { requests++ } })
  const realm = { document: { currentScript }, URL }
  runInNewContext(script.childNodes[0].value, realm)
  expect(realm.prefix).toBe('')
  expect(currentScript.src).toBe('https://artifact.invalid/_next/static/main.js')
  expect(requests).toBe(0)
  expect(artifact.html).not.toContain('allow-same-origin')
})

test('CSS assets resolve against each stylesheet and inline assets resolve against the document', async () => {
  const artifact = await pack('<link rel="stylesheet" href="/css/main.css"><style>.inline{background:URL("/images/my icon.svg#symbol")}</style><div style="background:url(&quot;/images/my icon.svg&quot;)"></div>', [
    file('css/main.css', '.external{background:url("../images/my icon.svg#symbol")} .label:after{content:"url(missing.png)"} /*url(missing.png)*/'),
    file('images/my icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>'),
  ])
  expect(artifact.resources).toEqual(['css/main.css', 'images/my icon.svg'])
  expect(artifact.html.match(/data:image\/svg\+xml;base64,/g)?.length).toBe(3)
  expect(artifact.html).toContain('#symbol')
  expect(artifact.html).toContain('content:"url(missing.png)"')
  expect(artifact.html).toContain('/*url(missing.png)*/')
})

test('unresolved CSS resources fail for linked, embedded and inline CSS', async () => {
  await expect(pack('<link rel="stylesheet" href="/main.css">', [file('main.css', 'p{background:url(missing.png)}')])).rejects.toThrow('Missing artifact resource')
  await expect(pack('<style>p{background:url("https://example.com/image.png")}</style>')).rejects.toThrow('External artifact resource')
  await expect(pack('<p style="background:url(/missing.png)">Hello</p>')).rejects.toThrow('Missing artifact resource')
  await expect(pack('<template><style>p{background:url(/missing.png)}</style></template>')).rejects.toThrow('Missing artifact resource')
})

test('Next stylesheet identity stays inert while packaged CSS retains order and media', async () => {
  const artifact = await pack('<link rel="stylesheet" href="/_next/static/css/main.css" data-precedence="next" media="screen"><link rel="stylesheet" href="/print.css" media="print">', [
    file('_next/static/css/main.css', 'body{color:green}'), file('print.css', 'body{color:black}'),
  ])
  const document = parse(artifact.html)
  const links = elements(document, 'link')
  expect(links.map(link => Object.fromEntries(link.attrs.map(attr => [attr.name, attr.value])))).toEqual([
    { rel: 'stylesheet', href: '/_next/static/css/main.css', 'data-precedence': 'next', media: 'screen', disabled: '' },
    { rel: 'stylesheet', href: '/print.css', media: 'print', disabled: '' },
  ])
  const styles = elements(document, 'style')
  expect(styles.map(style => style.childNodes[0].value)).toEqual(['body{color:green}', 'body{color:black}'])
  expect(styles.map(style => Object.fromEntries(style.attrs.map(attr => [attr.name, attr.value])))).toEqual([
    { 'data-precedence': 'next', media: 'screen', 'data-href': '/_next/static/css/main.css' }, { media: 'print', 'data-href': '/print.css' },
  ])
  expect(links.every(link => link.parentNode.childNodes[link.parentNode.childNodes.indexOf(link) + 1]?.tagName === 'style')).toBe(true)
  expect(artifact.html).toContain("style-src 'unsafe-inline'")
  await expect(pack('<link rel="stylesheet" href="/off.css" disabled>', [file('off.css', '')])).rejects.toThrow('Switchable stylesheets')
})

test('CSS resource forms outside the packaging grammar are explicit errors', async () => {
  for (const css of ['@IMPORT "other.css";', '@import url(other.css);', 'p{background:image-set("small.png" 1x)}', 'p{background:-webkit-image-set("small.png" 1x)}', 'p{background:src("small.png")}', String.raw`p{background:u\72l(missing.png)}`, String.raw`p{background:url("im\61ge.png")}`]) {
    await expect(pack(`<style>${css}</style>`)).rejects.toThrow()
  }
  await expect(pack('<style>p{background:url("broken.png)}</style>')).rejects.toThrow('Unterminated CSS string')
})

test('single-page profile permits generated Next error pages and rejects additional routes', async () => {
  const artifact = await pack('<main>One page</main>', [file('404.html', ''), file('404/index.html', ''), file('_not-found.html', ''), file('_not-found/index.html', '')])
  expect(artifact.html).toContain('One page')
  await expect(pack('<main>One page</main>', [file('dashboard/index.html', '<h1>Second route</h1>')])).rejects.toThrow('Multiple routes')
})

test('unsupported module scripts, redirects and URL bases cannot masquerade as a supported export', async () => {
  await expect(pack('<script type="module">import("/lazy.js")</script>')).rejects.toThrow('Module scripts and lazy imports')
  await expect(pack('<script src="data:text/javascript,alert(1)"></script>')).rejects.toThrow('local emitted files')
  await expect(pack('<link rel="stylesheet" href="data:text/css,body{}">')).rejects.toThrow('local emitted files')
  await expect(pack('<base href="https://example.com/">')).rejects.toThrow('Custom base URLs')
  await expect(pack('<meta http-equiv="refresh" content="0;url=https://example.com/">')).rejects.toThrow('redirects')
  await expect(pack('<template><iframe src="/elsewhere"></iframe></template>')).rejects.toThrow('Nested frames')
})
