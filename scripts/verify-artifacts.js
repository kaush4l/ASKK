/** Legacy non-isolated integration probe. Run after building .cache/artifact-fixture.
 * Isolation/reload/focus acceptance uses scripts/verify-artifact-isolation.js instead. */
import { readdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createProbeIdentity, saveProbeSubmission } from './probe-receipts.js'
import { join, resolve } from 'node:path'
import { packageArtifact } from '../src/workspace/artifacts.js'
const output = resolve(process.argv[2] || '.cache/artifact-fixture/out')
async function collect(directory, prefix = '') { const files = []; for (const entry of await readdir(directory, { withFileTypes: true })) { const path = `${prefix}${entry.name}`; if (entry.isDirectory()) files.push(...await collect(join(directory, entry.name), `${path}/`)); else files.push({ path, base64: (await readFile(join(directory, entry.name))).toString('base64') }) } return files }
const artifacts = []
artifacts.push(await packageArtifact({ files: await collect(output), revision: 'next-fixture' }, { revision: 1, runtime: 'fixture' }))
const fixture = async (name, script) => ({ name, artifact: await packageArtifact({ files: [{ path: 'index.html', content: `<html><head></head><body><button>Click</button><div id="real">Actual</div><script>${script}</script></body></html>` }] }, { revision: 1, runtime: 'fixture', name }) })
const adversaries = await Promise.all([
  fixture('private-port-forgery', `addEventListener('message',e=>{if(e.data?.type==='askk.connect'){const p=e.ports[0];p.onmessage=({data})=>{if(data.method==='inspect')p.postMessage({replyTo:data.requestId,result:{ok:true,results:data.assertions.map((a,index)=>({index,ok:true})),errors:[]}})}}})`),
  fixture('native-DOM-forgery', `Document.prototype.querySelector=()=>document.body;Document.prototype.querySelectorAll=()=>[document.body];Object.defineProperty(Node.prototype,'textContent',{get:()=> 'forged proof'});`),
  fixture('blocked-resource', `fetch('https://example.com/forbidden').catch(()=>{})`),
])
const bundled = await Bun.build({ entrypoints: [resolve('src/workspace/artifacts.js')], target: 'browser', minify: false })
if (!bundled.success) throw new Error(bundled.logs.join('\n'))
const moduleSource = await bundled.outputs[0].text()
const shell = await readFile('public/artifact-preview.html')
const evidenceDirectory = resolve(Bun.env.ARTIFACT_VERIFY_RESULTS || '.cache/artifact-legacy')
const hash = value => createHash('sha256').update(value).digest('hex')
const provenance = { profile: 'legacy-non-isolated', serverStartedAt: new Date().toISOString(), moduleSha256: hash(moduleSource), shellSha256: hash(shell), fixturesSha256: hash(JSON.stringify({ next: artifacts[0], adversaries })) }
const probeIdentity = createProbeIdentity(provenance)
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>ASKK artifact integration</title><style>body{font:16px system-ui;padding:32px}button{padding:12px}pre{white-space:pre-wrap}iframe{width:100%;height:300px;border:1px solid #aaa}</style><h1>Artifact integration checks</h1><button id="run">Run checks</button><div id="summary"></div><pre id="results">Ready</pre><div id="preview"></div><script type="module">
import {inspectArtifact,attachArtifact,mountArtifactFrame} from '/module.js?probe=${probeIdentity.id}';
const probe=${JSON.stringify(probeIdentity)};
const fixtures=await fetch('/fixtures?probe=${probeIdentity.id}').then(r=>r.json());
document.querySelector('#run').onclick=async()=>{
 const results=[]; const display=()=>{document.querySelector('#results').textContent=JSON.stringify(results,null,2); document.querySelector('#summary').replaceChildren(...results.map(row=>{const p=document.createElement('p');p.textContent=(row.expectedRejected?row.passed:row.ok)?'PASS: '+row.test:'FAIL: '+row.test;return p}))};
 const next=fixtures.next;
 const first=await inspectArtifact(next,[{action:'assertText',selector:'#ready',value:'Storage ready'},{action:'click',selector:'button',},{action:'assertText',selector:'#count',value:'Count: 1'}]);results.push({test:'Next hydration and interaction',...first});display();
 const second=await inspectArtifact(next,[{action:'assertText',selector:'#count',value:'Count: 0'},{action:'click',selector:'button'},{action:'assertText',selector:'#count',value:'Count: 1'},{action:'reload'},{action:'assertText',selector:'#count',value:'Count: 1'}]);results.push({test:'Fresh inspection scope and scoped storage across actual frame reload',...second});display();
 for(const row of fixtures.adversaries){const plan=[{action:'click',selector:'button'},{action:'assertText',selector:row.name==='blocked-resource'?'#real':'#missing',value:row.name==='blocked-resource'?'Actual':'forged proof'}]; const receipt=await inspectArtifact(row.artifact,plan);results.push({test:row.name,expectedRejected:true,passed:receipt.ok===false,receipt});display()}
 await fetch('/results',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({probe,receipt:{userAgent:navigator.userAgent,at:new Date().toISOString(),results}})});
 const frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-scripts');frame.title='Actual packaged Next output';attachArtifact(frame,next,{storageKey:'manual-fixture'});mountArtifactFrame(frame,next);document.querySelector('#preview').replaceChildren(frame);
};
</script></html>`
const server = Bun.serve({ hostname: '127.0.0.1', port: 5192, async fetch(request) {
  const url = new URL(request.url), path = url.pathname
  const headers = { 'cache-control': 'no-store' }
  if (path === '/pairing' && process.env.ASKK_PAIRING_FIXTURE === '1') {
    const origin = request.headers.get('origin')
    if (origin !== 'http://127.0.0.1:5189') return new Response('Forbidden', { status: 403, headers })
    return new Response(await readFile('.cache/companion-tls/relay-pairing.json'), { headers: { ...headers, 'content-type': 'application/json', 'access-control-allow-origin': origin } })
  }
  if (path === '/results' && request.method === 'POST') {
    const submission = await request.json(), data = submission?.receipt
    const browser = String(data?.userAgent).includes('Chrome/') ? 'chrome' : String(data?.userAgent).includes('Safari/') ? 'safari' : 'unknown'
    try {
      const receiptDirectory = await saveProbeSubmission(evidenceDirectory, `artifact-${browser}`, submission, provenance, probeIdentity)
      return Response.json({ saved: true, receiptDirectory }, { headers })
    } catch (error) { if (error.status) return new Response(error.message, { status: error.status, headers }); throw error }
  }
  if (['/module.js', '/fixtures'].includes(path) && url.searchParams.get('probe') !== probeIdentity.id) return new Response('Stale fixture asset URL; reload the fixture.', { status: 409, headers })
  if (path === '/artifact-preview.html') return new Response(shell, { headers: { ...headers, 'content-type': 'text/html' } })
  if (path === '/fixtures') return Response.json({ next: artifacts[0], adversaries }, { headers })
  if (path === '/module.js') return new Response(moduleSource, { headers: { ...headers, 'content-type': 'text/javascript' } })
  return new Response(html, { headers: { ...headers, 'content-type': 'text/html' } })
} })
console.log(`Artifact checks: ${server.url}`)
