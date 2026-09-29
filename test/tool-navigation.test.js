import { expect, test } from 'bun:test'
import { retainedResource, toolDestinations, selectedCommandRecord, selectedArtifactRecord } from '../src/workbench/tool-navigation.js'

const state = { files: [{ path: 'src/a.js' }], commands: [{ id: 'old' }, { id: 'new' }], artifacts: [{ id: 'build-old' }, { id: 'build-new' }] }
test('result actions resolve exact retained references, never destinations in result prose', () => {
  const links = toolDestinations({ path: 'src/a.js', commandId: 'old', artifactId: 'build-old' }, state)
  expect(links).toEqual({ file: state.files[0], command: state.commands[0], artifact: state.artifacts[0] })
  expect(toolDestinations({ summary: JSON.stringify({ path: 'src/a.js', commandId: 'new', artifactId: 'build-new' }) }, state)).toEqual({ file: null, command: null, artifact: null })
  expect(toolDestinations({ path: 'gone', commandId: 'gone', artifactId: 'gone' }, state)).toEqual({ file: null, command: null, artifact: null })
  expect(retainedResource([{ id: 'duplicate' }, { id: 'duplicate' }], 'duplicate')).toBeNull()
})
test('explicit unavailable command or artifact never selects a different result', () => {
  expect(selectedCommandRecord(state.commands, 'missing')).toBeNull()
  expect(selectedArtifactRecord(state.artifacts, 'artifact:missing', 'build-new')).toBeNull()
  expect(selectedArtifactRecord(state.artifacts, 'artifact:', 'build-new')).toBeNull()
  expect(selectedCommandRecord(state.commands, 'old')).toBe(state.commands[0])
  expect(selectedArtifactRecord(state.artifacts, 'artifact:build-old', 'build-new')).toBe(state.artifacts[0])
  expect(selectedCommandRecord(state.commands, null)).toBe(state.commands[1])
  expect(selectedArtifactRecord(state.artifacts, 'preview', 'build-old')).toBe(state.artifacts[0])
  expect(selectedArtifactRecord([], 'preview', null)).toBeNull()
})
test('evicted resources cease to be navigable while original receipt stays intact', () => {
  const tool = Object.freeze({ commandId: 'old', summary: 'original receipt' })
  expect(toolDestinations(tool, state).command).toBe(state.commands[0])
  expect(toolDestinations(tool, { ...state, commands: [state.commands[1]] }).command).toBeNull()
  expect(tool.summary).toBe('original receipt')
})
