/** Prepare the two small real Next apps used by verify-artifact-isolation.js.
 * Run: bun scripts/prepare-artifact-fixtures.js
 * --prepare-only writes sources without building. Uses the repository's pinned dependencies.
 */
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const packages = await Bun.file(resolve(root, 'package.json')).json()
const fixtures = [
  { directory: "artifact-fixture", page: "'use client'\nimport {useEffect,useState} from 'react'\nexport default function Page(){ const [count,setCount]=useState(0);const[ready,setReady]=useState(false); useEffect(()=>{window.askkArtifact?.storage.get('count').then(value=>{setCount(value??0);setReady(true)})},[]); return <main><h1>Artifact counter</h1><p id=\"count\">Count: {count}</p><form onSubmit={event=>{event.preventDefault();setCount(count+1);window.askkArtifact?.storage.set('count',count+1)}}><button type=\"submit\">Increment</button></form><p id=\"ready\">{ready?'Storage ready':'Loading storage'}</p></main> }\n", config: "export default {output:'export',images:{unoptimized:true},trailingSlash:true}\n" },
  { directory: "artifact-blur-fixture", page: "'use client'\nimport { useEffect, useState } from 'react'\nexport default function Page() {\n  const [title, setTitle] = useState('Original task')\n  const [draft, setDraft] = useState('Original task')\n  const [ready, setReady] = useState(false)\n  const [saved, setSaved] = useState(false)\n  const [events, setEvents] = useState('')\n  useEffect(() => { window.askkArtifact.storage.get('title').then(value => { setTitle(value ?? 'Original task'); setDraft(value ?? 'Original task'); setReady(true) }) }, [])\n  async function commit() { setEvents(value => value + ' blur'); setTitle(draft); await window.askkArtifact.storage.set('title', draft); setSaved(true) }\n  return <main><h1>Edit on blur</h1><p id=\"ready\">{ready ? 'Ready' : 'Loading'}</p><label>Task title<input id=\"title\" value={draft} onFocus={() => setEvents(value => value + ' focus')} onChange={event => { setEvents(value => value + ' change'); setDraft(event.target.value) }} onBlur={commit}/></label><button id=\"outside\">Finish editing</button><p id=\"draft\">{draft}</p><p id=\"events\">{events}</p><p id=\"committed\">{title}</p><p id=\"saved\">{saved ? 'Saved' : 'Not edited'}</p></main>\n}\n", config: "export default { output: 'export', images: { unoptimized: true }, experimental: { cpus: 1 }, webpack: config => { config.optimization.splitChunks = false; config.optimization.runtimeChunk = false; return config } }\n" },
]
const layout = "import './globals.css'\nexport default function Root({children}){return <html lang=\"en\"><body>{children}</body></html>}\n"
for (const fixture of fixtures) {
  const directory = resolve(root, '.cache', fixture.directory)
  await mkdir(resolve(directory, 'app'), { recursive: true })
  await Bun.write(resolve(directory, 'app/page.jsx'), fixture.page)
  await Bun.write(resolve(directory, 'app/layout.jsx'), layout)
  await Bun.write(resolve(directory, 'app/globals.css'), 'body{font:16px system-ui;background:rgb(241,245,249);color:#172033}main{padding:24px}button{background:rgb(22,101,52);color:white;padding:12px;border:0;border-radius:8px}\n')
  await Bun.write(resolve(directory, 'next.config.mjs'), fixture.config)
  await Bun.write(resolve(directory, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: Object.fromEntries(['next', 'react', 'react-dom'].map(name => [name, packages.dependencies[name]])) }, null, 2) + '\n')
  if (!process.argv.includes('--prepare-only')) {
    const child = Bun.spawn([Bun.which('bun'), '--bun', resolve(root, 'node_modules/next/dist/bin/next'), 'build', '--webpack'], { cwd: directory, stdout: 'inherit', stderr: 'inherit' })
    const status = await child.exited
    if (status !== 0) throw new Error(`${fixture.directory} failed to build (${status})`)
  }
}
console.log('Artifact fixtures prepared. Run bun scripts/verify-artifact-isolation.js and use CUA on the printed URL.')
