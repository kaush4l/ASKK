/** Server-only browser fixture. First run bun scripts/prepare-artifact-fixtures.js.
 * Open the printed URL in Chrome/Safari through CUA, type a draft, then Command/Ctrl+Enter. */
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { packageArtifact } from '../src/workspace/artifacts.js'

const port = Number(Bun.env.ARTIFACT_VERIFY_PORT || 5196)
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('ARTIFACT_VERIFY_PORT must be a valid TCP port')
const evidenceDirectory = resolve(Bun.env.ARTIFACT_VERIFY_RESULTS || (port === 5196 ? '.cache/artifact-reload' : `.cache/artifact-reload-${port}`))

async function collect(directory, prefix = '') {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`
    if (entry.isDirectory()) files.push(...await collect(join(directory, entry.name), `${path}/`))
    else files.push({ path, base64: (await readFile(join(directory, entry.name))).toString('base64') })
  }
  return files
}
const artifact = (name, script) => packageArtifact({ files: [{ path: 'index.html', content: `<html><head></head><body><button id="add">Add</button><p id="count">0</p><p id="proof">Actual</p><script>${script}</script></body></html>` }] }, { name, revision: 1, runtime: 'fixture' })
const fixtures = {
  next: await packageArtifact({ files: await collect(resolve(process.argv[2] || '.cache/artifact-fixture/out')), revision: 'next-isolation-fixture' }, { revision: 1, runtime: 'fixture' }),
  blur: await packageArtifact({ files: await collect(resolve('.cache/artifact-blur-fixture/out')), revision: 'next-blur-fixture' }, { revision: 1, runtime: 'fixture' }),
  formExternal: await artifact('External form submission must fail', `const form=document.createElement('form');form.method='POST';form.action='https://artifact.invalid/forbidden';document.body.append(form);document.querySelector('#add').onclick=()=>form.submit();`),
  formParent: await artifact('Harness-origin form submission must fail', `const form=document.createElement('form');form.method='POST';form.action='http://127.0.0.1:${port}/forbidden-form';document.body.append(form);document.querySelector('#add').onclick=()=>form.submit();`),
  counterForm: await packageArtifact({ files: [{ path: 'index.html', content: `<html><head></head><body><p id="ready">Form ready</p><form id="counter-form"><label>Entry<input id="entry"></label><button id="submit-entry" type="submit">Add entry</button></form><p id="count">Count: 0; Last: none.</p><script>let count=0;document.querySelector('#counter-form').addEventListener('submit',event=>{event.preventDefault();document.querySelector('#count').textContent='Count: '+(++count)+'; Last: '+document.querySelector('#entry').value+'.'});</script></body></html>` }] }, { name: '37-action native form counter', revision: 1, runtime: 'fixture' }),
  memory: await artifact('Unpersisted memory must fail', `let count=0;document.querySelector('#add').onclick=()=>{document.querySelector('#count').textContent=String(++count);try{localStorage.setItem('count',count)}catch{}};`),
  port: await artifact('Private-port forgery must fail', `addEventListener('message',e=>{if(e.data?.type==='askk.connect'){const p=e.ports[0];p.onmessage=({data})=>{if(data.method==='inspect')p.postMessage({replyTo:data.requestId,result:{ok:true,results:data.assertions.map((a,index)=>({index,ok:true})),errors:[]}})}}})`),
  dom: await artifact('Native DOM forgery must fail', `Document.prototype.querySelector=()=>document.body;Document.prototype.querySelectorAll=()=>[document.body];Object.defineProperty(Node.prototype,'textContent',{get:()=> 'forged proof'});`),
  url: await artifact('URL compatibility', `const checks=[new URL('../x','https://example.org/a/b').href==='https://example.org/x',URL.canParse('relative',location.href),!URL.canParse('no base'),URL.parse('no base')===null];const blob=URL.createObjectURL(new Blob(['x']));checks.push(blob.startsWith('blob:'));URL.revokeObjectURL(blob);document.querySelector('#add').onclick=()=>{document.querySelector('#proof').textContent=checks.every(Boolean)?'URL APIs passed':'URL APIs failed'};`),
}
const bundle = await Bun.build({ entrypoints: [resolve('src/workspace/artifacts.js')], target: 'browser' })
if (!bundle.success) throw new Error(bundle.logs.join('\n'))
const moduleSource = await bundle.outputs[0].text()
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>ASKK isolated artifact verification</title><style>body{font:16px system-ui;padding:32px;max-width:1100px;margin:auto;background:#f5f3ef;color:#28323a}button{font:inherit;padding:12px 18px;border:1px solid #aca79e;border-radius:8px;cursor:pointer}pre{white-space:pre-wrap;font:12px/1.6 monospace}iframe{width:100%;height:340px;border:1px solid #ccc}</style><h1>Isolated artifact verification</h1><p id="isolation">Preparing cross-origin isolation…</p><label>Focus-preservation draft<textarea id="composer" rows="2" style="display:block;width:100%;margin:12px 0" placeholder="Type a draft, then press Command+Enter to verify without moving focus"></textarea></label><button id="run" disabled>Run verification</button> <button id="background" disabled>Arm 37-action background check</button><p id="background-status">The background check waits for this tab to become hidden. Switch to another tab after arming it.</p><p id="summary"></p><pre id="results"></pre><div id="preview"></div><script type="module">
if(!crossOriginIsolated){await navigator.serviceWorker.register('/coi-serviceworker.js',{updateViaCache:'none'});await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));if(sessionStorage.getItem('isolation-attempt'))throw new Error('Isolation did not activate');sessionStorage.setItem('isolation-attempt','1');location.reload()}else{
document.querySelector('#isolation').textContent='crossOriginIsolated: '+crossOriginIsolated+' · actual static-host service worker · opaque frames with client-side form handlers';
const {inspectArtifact,attachArtifact,mountArtifactFrame}=await import('/module.js');const fixtures=await fetch('/fixtures').then(response=>response.json());const button=document.querySelector('#run');button.disabled=false;
const counterPlan=[{action:'assertText',selector:'#ready',value:'Form ready'}];for(let index=1;index<=12;index++)counterPlan.push({action:'fill',selector:'#entry',value:'Entry '+index},{action:'click',selector:'#submit-entry'},{action:'assertText',selector:'#count',value:'Count: '+index+'; Last: Entry '+index+'.'});
const background=document.querySelector('#background');background.disabled=false;background.onclick=async()=>{
background.disabled=true;const status=document.querySelector('#background-status');status.textContent='Armed: switch to another tab within15 seconds. This check must stay hidden until it finishes.';
try{if(document.visibilityState!=='hidden')await new Promise((resolve,reject)=>{const changed=()=>{if(document.visibilityState==='hidden'){clearTimeout(timer);document.removeEventListener('visibilitychange',changed);resolve()}};const timer=setTimeout(()=>{document.removeEventListener('visibilitychange',changed);reject(new Error('No background transition within15 seconds'))},15000);document.addEventListener('visibilitychange',changed)});
const started=performance.now();const visibility=[{state:document.visibilityState,ms:0}];const changed=()=>visibility.push({state:document.visibilityState,ms:performance.now()-started});document.addEventListener('visibilitychange',changed);status.textContent='Running37 assertions in a hidden tab; leave it hidden until the saved result is available.';
let receipt;try{receipt=await inspectArtifact(fixtures.counterForm,counterPlan)}finally{document.removeEventListener('visibilitychange',changed)}
const elapsedMs=performance.now()-started;const stayedHidden=visibility.every(row=>row.state==='hidden');const evidence={name:'37-action background native form counter',userAgent:navigator.userAgent,at:new Date().toISOString(),crossOriginIsolated,elapsedMs,visibility,assertionCount:counterPlan.length,expectedSubmissions:12,passed:receipt.ok&&receipt.results.length===37&&stayedHidden&&elapsedMs>12000,receipt};window.artifactBackgroundVerification=evidence;status.textContent=(evidence.passed?'PASS':'FAIL')+':37-action background check '+Math.round(elapsedMs)+'ms';await fetch('/background-results',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(evidence)});
}catch(error){status.textContent=error.message}finally{background.disabled=false}};

button.onclick=async()=>{button.disabled=true;const composer=document.querySelector('#composer');const startedFocus=document.activeElement;const draft=composer.value;const results=[];const display=()=>{document.querySelector('#results').textContent=JSON.stringify(results,null,2);document.querySelector('#summary').textContent=results.map(row=>(row.passed?'PASS: ':'FAIL: ')+row.name).join(' · ')};
const check=async(name,artifact,plan,expected=true)=>{const receipt=await inspectArtifact(artifact,plan);results.push({name,passed:receipt.ok===expected,expected,receipt});display()};
await check('Next hydration and persistence across real frame reload',fixtures.next,[{action:'assertText',selector:'#ready',value:'Storage ready'},{action:'click',selector:'button'},{action:'assertText',selector:'#count',value:'Count: 1'},{action:'reload'},{action:'assertText',selector:'#ready',value:'Storage ready'},{action:'assertText',selector:'#count',value:'Count: 1'}]);
await check('Repeated inspection of the same artifact starts with fresh test storage',fixtures.next,[{action:'assertText',selector:'#count',value:'Count: 0'},{action:'click',selector:'button'},{action:'assertText',selector:'#count',value:'Count: 1'}]);
await check('Next explicit DOM blur commits React edit and survives reload',fixtures.blur,[{action:'assertText',selector:'#ready',value:'Ready'},{action:'fill',selector:'#title',value:'Edited task'},{action:'assertText',selector:'#draft',value:'Edited task'},{action:'blur',selector:'#title'},{action:'assertText',selector:'#events',value:'blur'},{action:'assertText',selector:'#committed',value:'Edited task'},{action:'assertText',selector:'#saved',value:'Saved'},{action:'reload'},{action:'assertText',selector:'#ready',value:'Ready'},{action:'assertText',selector:'#committed',value:'Edited task'}]);
await check('Silent localStorage fallback loses state and must fail',fixtures.memory,[{action:'click',selector:'#add'},{action:'assertText',selector:'#count',value:'1'},{action:'reload'},{action:'assertText',selector:'#count',value:'1'}],false);
for(const key of ['formExternal','formParent'])await check(key+' submission blocked by CSP',fixtures[key],[{action:'click',selector:'#add'},{action:'assertText',selector:'#proof',value:'Actual'}],false);
for(const key of ['port','dom'])await check(key+' forgery must fail',fixtures[key],[{action:'click',selector:'button'},{action:'assertText',selector:'#missing',value:'forged proof'}],false);
await check('Normal URL and native Blob APIs',fixtures.url,[{action:'click',selector:'#add'},{action:'assertText',selector:'#proof',value:'URL APIs passed'}]);
await check('37-action native form counter without duplicated submissions',fixtures.counterForm,counterPlan);
results.push({name:'Parent composer focus and draft preserved',passed:startedFocus===composer&&document.activeElement===composer&&composer.value===draft});display();const evidence={userAgent:navigator.userAgent,crossOriginIsolated,at:new Date().toISOString(),results};await fetch('/results',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(evidence)});window.artifactVerification=evidence;
const frame=document.createElement('iframe');frame.sandbox='allow-scripts';frame.title='Actual Next counter preview';attachArtifact(frame,fixtures.next,{storageKey:'isolated-manual-preview'});mountArtifactFrame(frame,fixtures.next);document.querySelector('#preview').replaceChildren(frame);button.disabled=false;
};document.querySelector('#composer').onkeydown=event=>{if((event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();if(!button.disabled)button.click()}};}
</script></html>`
const server = Bun.serve({ hostname: '127.0.0.1', port, async fetch(request) {
  const path = new URL(request.url).pathname
  if (path === '/coi-serviceworker.js') return new Response(Bun.file('public/coi-serviceworker.js'), { headers: { 'content-type': 'text/javascript', 'cache-control': 'no-store' } })
  if (path === '/module.js') return new Response(moduleSource, { headers: { 'content-type': 'text/javascript' } })
  if (path === '/fixtures') return Response.json(fixtures)
  if (path === '/forbidden-form') { await mkdir(evidenceDirectory, { recursive: true }); await writeFile(join(evidenceDirectory, 'forbidden-form-received.json'), JSON.stringify({ method: request.method, at: new Date().toISOString() })); return new Response('Unexpected form submission', { status: 500 }) }
  if (['/results', '/background-results'].includes(path) && request.method === 'POST') {
    const evidence = await request.json(); const browser = evidence.userAgent.includes('Chrome/') ? 'chrome' : 'safari'
    await mkdir(evidenceDirectory, { recursive: true }); await writeFile(join(evidenceDirectory, `${browser}-${path === '/background-results' ? 'background-time-budget' : 'isolated'}.json`), JSON.stringify(evidence, null, 2))
    return Response.json({ saved: true })
  }
  return new Response(html, { headers: { 'content-type': 'text/html' } })
} })
console.log(`Isolated artifact CUA fixture: ${server.url}`)
