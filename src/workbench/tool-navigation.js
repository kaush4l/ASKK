/** Resolve retained identities only. Recorded prose never supplies destinations. */
export function retainedResource(rows = [], id, key = 'id') {
  if (typeof id !== 'string' || !id) return null
  const matches = rows.filter(row => row?.[key] === id)
  return matches.length === 1 ? matches[0] : null
}
export function toolDestinations(tool, state = {}) {
  return {
    file: retainedResource(state.files, tool.path, 'path'),
    command: retainedResource(state.commands, tool.commandId),
    artifact: retainedResource(state.artifacts, tool.artifactId),
  }
}
export function selectedCommandRecord(commands, selected) {
  return selected ? retainedResource(commands, selected) : commands.at(-1) ?? null
}
export function selectedArtifactRecord(artifacts, selection, activeId) {
  return selection?.startsWith('artifact:') ? retainedResource(artifacts, selection.slice(9))
    : retainedResource(artifacts, activeId) ?? artifacts.at(-1) ?? null
}
