import {test,expect} from 'bun:test'
import {cp,mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {Hub} from '../src/runtime/hub.js'
import {listing} from '../scripts/listing.js'
import {resolveCommandReference} from '../src/core/command-reference.js'

for(const mode of ['allow','ask','refuse','deny','guardrail','mutated','mixed','out-of-range']) test(`worker resolves configured command before authority checks: ${mode}`,async()=>{
 const site=await mkdtemp(join(tmpdir(),'askk-command-ref-'));let hub
 const calls=[],approvals=[]
 const command=mode==='guardrail'?'sudo echo blocked':`printf '%s' 'exact configured command'`
 const completion={checks:[{capability:'workspace.commands',options:{commands:[command]}}]}
 const args=mode==='mixed'?{requiredCheck:0,command:'echo override'}:mode==='out-of-range'?{requiredCheck:1}:{requiredCheck:0}
 try{
  for(const name of ['packages','tools'])await cp(join(import.meta.dir,'../public',name),join(site,name),{recursive:true})
  await cp(join(import.meta.dir,'../public/desk.json'),join(site,'desk.json'));await mkdir(join(site,'agents'))
  await writeFile(join(site,'models.json'),JSON.stringify({default:'fixture',models:{fixture:{provider:'scripted',model:'fixture',max_output_tokens:256,script:{builder:[JSON.stringify({do:'tool',act:[[{name:'workspace_run',args}]]}),JSON.stringify({do:'done',act:'Fixture finished'})]}}}}))
  await writeFile(join(site,'agents/index.json'),JSON.stringify(await listing(site)))
  hub=new Hub({base:`${pathToFileURL(site).href}/`,storeName:`ref-${crypto.randomUUID()}`})
  hub.externalOps={'workspace.environment':()=>({target:'fixture',status:'ready',files:[],capabilities:['exec']}),'workspace.run':(args,run)=>{const resolved=resolveCommandReference(args,run.completion,{resolved:true});calls.push(resolved);return{id:'receipt',code:0,output:'exact configured command'}}}
  // This suite tests dispatch authority only. Real completion receipts are tested
  // separately through the Local Bun evaluator and controller suites.
  hub.completionAdapters={'workspace.commands':()=>({ok:true,reason:'Fixture authority check only'})}
  await hub.start();await hub.settings.set({policy:{defaults:{read:'allow',exec:['ask','refuse'].includes(mode)?'ask':mode==='deny'?'deny':'allow'}}})
  hub.subscribe(event=>{if(event.type==='approval'){approvals.push(event.approval);hub.approvalsApi.answer(event.approval.id,{approved:mode!=='refuse'})}})
  const run=hub.startRun('bundled/starter/builder','Execute configured check',{context:{workflow:{completion}}})
  if(mode==='mutated')completion.checks[0].options.commands[0]='echo changed after start'
  await run.answer
  const executes=['allow','ask','mutated'].includes(mode)
  expect(calls).toEqual(executes?[{command,requiredCheck:0}]:[])
  const proposal=run.toolEvents.find(e=>e.kind==='call')
  expect(proposal.args).toEqual(args)
  const outcome=run.toolEvents.find(e=>e.kind==='observation')
  if(mode!=='deny')expect(outcome.ok).toBe(executes)
  if(['allow','ask','refuse','guardrail','mutated'].includes(mode))expect(outcome.resolvedArgs).toEqual({command,requiredCheck:0})
  if(['ask','refuse'].includes(mode)){
   expect(approvals).toHaveLength(1);expect(approvals[0].args).toEqual({command,requiredCheck:0})
   expect(approvals[0].call).toContain(JSON.stringify(command));expect(approvals[0].callId).toBe(proposal.callId)
  }else expect(approvals).toHaveLength(0)
  if(mode==='guardrail')expect(outcome.value).toContain('superuser')
 }finally{hub?.stop();await rm(site,{recursive:true,force:true})}
},15000)
