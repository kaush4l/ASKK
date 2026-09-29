import { expect, test } from 'bun:test'
import { importAgentPackage } from '../src/core/agent-package.js'
import { copyAgentSource } from '../src/runtime/package-source.js'

const records = [
  {path:'agent.md',content:'---\npackage_id: source.copy\npackage_version: 1.0.0\nid: lead\nagents: { helper: helper }\n---\nLead body\n'},
  {path:'agents/helper/agent.md',content:'---\nid: helper\n---\nHelper body\n'},
  {path:'soul.md',content:'Original soul\r\n'},
  {path:'notes.md',content:'Not referenced but still authored.\n'},
]
async function fixture(namespace='installed', extra=[]) {
  const pkg = await importAgentPackage([...records,...extra])
  const path = `${namespace}/example/lead`
  const spec = {name:'Original lead',package:{namespace,installationId:'example',revisionDigest:pkg.data.revisionDigest,packageId:pkg.data.packageId}}
  const hub = {specs:new Map([[path,spec]]),packages:{items:new Map([['example',{record:{data:pkg.data,bindings:{models:{$default:'private-profile'},tools:['web']}}}]])},shippedPackageSources:[{id:'example',data:pkg.data}]}
  return {hub,path,pkg,spec}
}
test('installed and bundled copies retain every authored byte and exclude generated locks and bindings', async()=>{
  for(const namespace of ['installed','bundled']) {
    const {hub,path,spec}=await fixture(namespace)
    const source=await copyAgentSource(hub,path)
    expect(source.label).toBe('Original lead copy')
    expect(source.files.sort((a,b)=>a.path.localeCompare(b.path))).toEqual([...records].sort((a,b)=>a.path.localeCompare(b.path)))
    expect(Object.keys(source).sort()).toEqual(['files','label'])
    expect(hub.specs.get(path)).toBe(spec)
    source.files[0].content='changed copy'
    expect((await copyAgentSource(hub,path)).files).not.toEqual(source.files)
  }
})
test('a stale identity or changed definition cannot be copied into a different revision', async()=>{
  const f=await fixture()
  f.hub.specs.set(f.path,{...f.spec,package:{...f.spec.package,revisionDigest:'wrong'}})
  await expect(copyAgentSource(f.hub,f.path)).rejects.toThrow('does not match')
  f.hub.specs.set(f.path,f.spec)
  const pending=copyAgentSource(f.hub,f.path)
  f.hub.specs.set(f.path,{...f.spec})
  await expect(pending).rejects.toThrow('changed while copying')
})
test('binary resources fail visibly instead of silently producing an incomplete editable folder', async()=>{
  const {hub,path}=await fixture('installed',[{path:'asset.bin',content:new Uint8Array([255,254])}])
  await expect(copyAgentSource(hub,path)).rejects.toThrow('Cannot copy asset.bin')
  expect(hub.specs.size).toBe(1)
})
