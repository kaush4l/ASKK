import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { PackageImportReview } from '../src/workbench/PackageImport.jsx'
import { draftChanged, draftChanges, studioFilePath } from '../src/workbench/package-studio.js'

test('invalid source remains exact draft text and participates in dirty detection', () => {
  const saved = { label: 'Agent', files: [{ path: 'agent.md', content: '---\nname: Valid\n---\n' }, { path: 'extra.md', content: '<!-- retained -->\r\n' }] }
  const draft = { ...saved, files: [{ path: 'agent.md', content: '---\nname: [invalid' }, saved.files[1]] }
  expect(draftChanged(saved, draft)).toBe(true)
  expect(draftChanged(draft, structuredClone(draft))).toBe(false)
  expect(draftChanges(saved.files, draft.files)).toEqual([{ path: 'agent.md', base: saved.files[0].content, draft: '---\nname: [invalid', kind: 'Changed' }])
  expect(draftChanged(saved, { ...saved, label: 'Renamed draft' })).toBe(true)
})

test('source file operations reject traversal and collisions without blocking nested paths', () => {
  const files = [{ path: 'agent.md' }, { path: 'skills/café.md' }]
  for (const path of ['../bad.md', '/bad.md', 'skills//bad.md', 'x\\y.md', 'a%2fb.md', 'AGENT.md', 'skills/café.md', 'askk.lock.json']) expect(() => studioFilePath(path, files)).toThrow()
  expect(studioFilePath('roles/critic/agent.md', files)).toBe('roles/critic/agent.md')
  expect(studioFilePath('agent.md', files, 'agent.md')).toBe('agent.md')
})

test('review includes deleted empty files and added files', () => {
  expect(draftChanges([{ path: 'empty.md', content: '' }], [{ path: 'new.md', content: '' }])).toEqual([{ path: 'empty.md', base: '', draft: '', kind: 'Deleted' }, { path: 'new.md', base: '', draft: '', kind: 'Added' }])
})

test('draft installation review says new installation and keeps its explicit binding gate', () => {
  const preview = { stageId: 'stage', packageId: 'agent', packageVersion: '1', agents: [{ id: 'lead', tools: [] }], files: [], modelAliases: ['$default'], availableModels: [], availableTools: [] }
  const html = renderToStaticMarkup(<PackageImportReview preview={preview} choices={{ leadAgentId: 'lead', models: {}, tools: [] }} actionLabel="Install as new agent" helpText="Existing agents and runs stay unchanged."/>)
  expect(html).toContain('Install as new agent')
  expect(html).toContain('Existing agents and runs stay unchanged.')
  expect(html).toContain('type="submit" class="button primary" disabled=""')
})
