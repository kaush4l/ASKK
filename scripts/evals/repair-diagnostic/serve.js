/** Explicit loopback QA server. Starting it bundles code but never calls a model. */
import { readFile, writeFile, mkdir, readdir, lstat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSpec } from '../../../src/core/folder.js'
import { packageArtifact } from '../../../src/workspace/artifacts.js'
import { extractFixture, SOURCE_RECEIPT, sha256 } from './fixture.js'
import { verifySource } from './source.js'
import { modelCatalogue } from './profile.js'

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const args = Bun.argv.slice(2)
if (args.includes('--help')) {
  console.log('bun scripts/evals/repair-diagnostic/serve.js [--directory PATH] [--port 5210] [--allow-inference]\nRequires explicit prepared native build. Serves one isolated manual browser run; no model request until its Run button is clicked. Records stay private under the fixture directory. Do not start during another agent timing bracket.')
} else {
  const valued = new Set(['--directory', '--port'])
  for (let index = 0; index < args.length; index++) { if (valued.has(args[index])) { if (!args[++index]) throw new Error('Flag needs a value') } else if (args[index] !== '--allow-inference') throw new Error('Unknown flag') }
  const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
  const directory = resolve(option('--directory', join(root, '.cache/evals/repair-diagnostic'))), port = Number(option('--port', 5210))
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid loopback port')
  const fixture = JSON.parse(await readFile(join(directory, 'fixture.json')))
  const historical = extractFixture(await readFile(join(root, SOURCE_RECEIPT)))
  if (JSON.stringify(fixture) !== JSON.stringify(historical)) throw new Error('Prepared historical fixture changed')
  await verifySource(join(directory, 'source'), fixture.files)
  const buildBytes = await readFile(join(directory, 'build.json')), build = JSON.parse(buildBytes)
  if (build.code !== 0 || build.sourceFingerprint !== fixture.sourceFingerprint || !build.outputs.some(file => file.path === 'index.html')) throw new Error('A successful matching native build is required')
  const files = []
  for (const row of build.outputs) {
    if (row.path.startsWith('/') || row.path.split('/').includes('..')) throw new Error('Invalid export path')
    const path = join(directory, 'source/out', row.path)
    if (!(await lstat(path)).isFile()) throw new Error('Export must contain regular files')
    const bytes = await readFile(path)
    if (sha256(bytes) !== row.sha256 || bytes.length !== row.bytes) throw new Error(`Export changed: ${row.path}`)
    files.push({ path: row.path, base64: bytes.toString('base64') })
  }
  const artifact = await packageArtifact({ files, revision: sha256(buildBytes) }, { revision: 26, runtime: 'native-evaluation-fixture', name: 'Immutable Daylight repair diagnostic' })
  const configuration = {}, sources = {}
  async function collect(folder, target) {
    for (const entry of await readdir(join(root, folder), { withFileTypes: true })) {
      const path = `${folder}/${entry.name}`
      if (entry.isDirectory()) await collect(path, target)
      else if (entry.isFile() && /\.(js|md|json)$/.test(path) && !path.endsWith('/index.json')) target[path] = sha256(await readFile(join(root, path)))
    }
  }
  for (const folder of ['public/agents', 'public/prompts', 'public/tools']) await collect(folder, configuration)
  configuration['public/models.json'] = sha256(await readFile(join(root, 'public/models.json')))
  for (const folder of ['src/core', 'src/builtin', 'scripts/evals/repair-diagnostic']) await collect(folder, sources)
  for (const path of ['src/workspace/artifacts.js', 'src/workspace/artifact-timing.js', 'src/workspace/contracts.js']) sources[path] = sha256(await readFile(join(root, path)))
  const index = { files: Object.fromEntries(Object.entries(configuration).map(([path, hash]) => [path.slice('public/'.length), hash])) }
  const load = file => readFile(join(root, 'public', file), 'utf8')
  const specs = Object.fromEntries(await Promise.all(['main', 'compactor'].map(async path => [path, await readSpec(path, { index, load })])))
  const peers = Object.fromEntries(await Promise.all(specs.main.peers.map(async path => [path, await readSpec(path, { index, load })])))
  const catalogue = modelCatalogue()
  const bundle = await Bun.build({ entrypoints: [join(root, 'scripts/evals/repair-diagnostic/runner.js')], target: 'browser' })
  if (!bundle.success) throw new Error(bundle.logs.join('\n'))
  const javascript = await bundle.outputs[0].text()
  for (const [path, hash] of Object.entries({ ...configuration, ...sources })) if (sha256(await readFile(join(root, path))) !== hash) throw new Error(`Configuration/source changed during preparation: ${path}`)
  const id = crypto.randomUUID(), allowInference = args.includes('--allow-inference')
  const payload = { fixture, artifact, build, specs, peers, catalogue, provenance: { id, configuration, sources, modelProfileSource: 'Explicitly authorized local Qwen evaluation profile; temperature 0 matches historical ProviderRequest. No saved UI settings were read. Per-agent inference overrides remain in force (production compactor max_output_tokens: 2048).', bundleSha256: sha256(javascript), buildReceiptSha256: sha256(buildBytes) } }
  const evidenceDirectory = join(directory, 'runs', id)
  await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 })
  let reserved = false, saved = false
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>ASKK bounded repair diagnostic</title><style>body{font:16px system-ui;max-width:960px;margin:32px auto;padding:0 20px;background:#f5f3ef;color:#252b30}button{font:inherit;padding:12px;margin:8px 8px 8px 0}pre{white-space:pre-wrap;font:12px/1.5 monospace}</style><h1>Bounded verification repair</h1><p>Frozen Daylight source. Real opaque artifact checks. Six main requests, one compactor request, two inspections. No owner steering, edits, commands or delegation. A machine-completed run still needs independent summary and coverage review.</p><p>Model: <strong id="model"></strong>. Local model transport only; no host execution is connected.</p><button id="run" ${allowInference ? '' : 'disabled'}>Run one bounded diagnostic</button><button id="cancel" disabled>Cancel diagnostic</button><p id="state">${allowInference ? 'Ready. No model requests have been sent.' : 'Inference disabled. Restart with explicit --allow-inference after the timing bracket is released.'}</p><pre id="events"></pre><script type="module">
import {runDiagnostic} from '/runner.js';
const input=await fetch('/fixture').then(r=>r.json());document.querySelector('#model').textContent=input.catalogue.models[input.catalogue.default].model;
document.querySelector('#run').onclick=async()=>{
const response=await fetch('/reserve',{method:'POST'});if(!response.ok)throw new Error(await response.text());
document.querySelector('#run').disabled=true;document.querySelector('#cancel').disabled=false;const controller=new AbortController();document.querySelector('#cancel').onclick=()=>controller.abort();const events=[];
try{const receipt=await runDiagnostic(input,{allowInference:true,signal:controller.signal,onProgress:e=>{events.push(e);document.querySelector('#events').textContent=JSON.stringify(events,null,2);document.querySelector('#state').textContent=e.phase+' · '+e.kind;}});window.repairDiagnostic=receipt;const stored=await fetch('/receipt',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(receipt)});if(!stored.ok)throw new Error(await stored.text());document.querySelector('#state').textContent=receipt.assessment.status+' — private exact receipts saved. Independent review required; this is not a one-shot generation result.';}catch(error){document.querySelector('#state').textContent='Diagnostic error: '+error.message;}finally{document.querySelector('#cancel').disabled=true;}
};</script></html>`
  const origin = `http://127.0.0.1:${port}`
  const server = Bun.serve({ hostname: '127.0.0.1', port, maxRequestBodySize: 32 * 1024 * 1024, async fetch(request) {
    const path = new URL(request.url).pathname
    const headers = { 'cache-control': 'no-store', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'credentialless' }
    if (request.headers.get('host') !== `127.0.0.1:${port}`) return new Response('Invalid host', { status: 403 })
    if (request.method === 'POST') {
      if (request.headers.get('origin') !== origin) return new Response('Forbidden origin', { status: 403 })
      if (path === '/reserve' && allowInference && !reserved) { reserved = true; return Response.json({ reserved: true }, { headers }) }
      if (path === '/receipt' && reserved && !saved) {
        const receipt = await request.json()
        if (receipt.provenance?.id !== id || receipt.evaluation !== 'immutable-repair-v1') return new Response('Wrong evidence identity', { status: 400 })
        const bytes = `${JSON.stringify(receipt, null, 2)}\n`
        await writeFile(join(evidenceDirectory, 'receipt.json'), bytes, { flag: 'wx', mode: 0o600 }); saved = true
        return Response.json({ saved: true, sha256: sha256(bytes) }, { headers })
      }
      return new Response('Unavailable or already used', { status: 409 })
    }
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
    if (path === '/runner.js') return new Response(javascript, { headers: { ...headers, 'content-type': 'text/javascript' } })
    if (path === '/fixture') return Response.json(payload, { headers })
    if (path === '/') return new Response(html, { headers: { ...headers, 'content-type': 'text/html' } })
    return new Response('Not found', { status: 404 })
  } })
  console.log(JSON.stringify({ url: String(server.url), allowInference, evidenceDirectory, sourceFingerprint: fixture.sourceFingerprint, notice: 'No model request until explicit Run click. Keep receipts private pending redaction/review.' }))
}
