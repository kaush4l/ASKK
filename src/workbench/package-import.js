import { PACKAGE_LIMITS, PACKAGE_LOCK } from '../core/agent-package.js'

const interrupted = () => new DOMException('Package selection was cancelled.', 'AbortError')
const pathOf = raw => {
  if (typeof raw !== 'string' || !raw || raw.length > 1024 || /[\\:%\u0000-\u001f\u007f]/.test(raw)) throw new Error('A selected file has an unsupported path.')
  const path = raw.normalize('NFC')
  if (path.split('/').some(part => !part || part === '.' || part === '..' || part.trim() !== part || part.endsWith('.'))) throw new Error('Select a folder with safe relative file paths.')
  return path
}

/** Inspect every path and declared size before reading any selected file bytes. */
export function packageFileSelection(files, { directory = false, limits = PACKAGE_LIMITS } = {}) {
  const selected = Array.from(files || [])
  if (!selected.length) throw new Error('Choose an agent folder or an agent.md file.')
  if (selected.length > limits.maxFiles + 1) throw new Error(`Choose at most ${limits.maxFiles} files plus ${PACKAGE_LOCK}.`)
  if (!directory && (selected.length !== 1 || selected[0].name !== 'agent.md')) throw new Error('For a single-file import, choose the file named agent.md. Use a folder for supporting files.')
  let root = null, total = 0
  const aliases = new Set()
  const entries = selected.map(file => {
    let path
    if (directory) {
      const relative = pathOf(file.webkitRelativePath)
      const parts = relative.split('/')
      if (parts.length < 2) throw new Error('This browser did not provide folder paths. Choose a single agent.md instead.')
      if (root === null) root = parts[0]
      if (parts[0] !== root) throw new Error('Choose one agent folder at a time.')
      path = pathOf(parts.slice(1).join('/'))
    } else path = 'agent.md'
    const alias = path.toLowerCase()
    if (aliases.has(alias)) throw new Error(`Two selected files use the same normalized path: ${path}`)
    aliases.add(alias)
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > limits.maxFileBytes) throw new Error(`${path} exceeds the ${Math.round(limits.maxFileBytes / 1048576)} MiB per-file limit.`)
    total += file.size
    if (total > limits.maxExpandedBytes) throw new Error(`This folder exceeds the ${Math.round(limits.maxExpandedBytes / 1048576)} MiB import limit.`)
    return { file, path }
  })
  if (!entries.some(entry => entry.path === 'agent.md')) throw new Error('The selected folder must contain agent.md at its top level.')
  if (entries.length - Number(entries.some(entry => entry.path === PACKAGE_LOCK)) > limits.maxFiles) throw new Error(`Choose at most ${limits.maxFiles} source files.`)
  return { entries, total, name: root || 'agent.md' }
}

export async function readPackageFiles(files, { directory = false, isCurrent = () => true, limits = PACKAGE_LIMITS } = {}) {
  const selection = packageFileSelection(files, { directory, limits })
  const records = []
  for (const { file, path } of selection.entries) {
    if (!isCurrent()) throw interrupted()
    const buffer = await file.arrayBuffer()
    if (!isCurrent()) throw interrupted()
    if (buffer.byteLength !== file.size) throw new Error(`${path} changed while reading it. Select the folder again.`)
    records.push({ path, content: new Uint8Array(buffer) })
  }
  return records
}

export function defaultPackageChoices(preview) {
  const models = new Set((preview.availableModels || []).map(model => model.id))
  return { leadAgentId: preview.entryAgentId, models: Object.fromEntries((preview.modelAliases || []).map(alias => [alias, models.has(alias) ? alias : models.has('workbench') ? 'workbench' : ''])), tools: [] }
}

export function unsupportedPackageTools(preview) {
  const available = new Set(preview?.availableTools || [])
  return [...new Set((preview?.agents || []).flatMap(agent => agent.tools || []))].filter(tool => !available.has(tool))
}

export function packageInstallBindings(preview, choices) {
  if (unsupportedPackageTools(preview).length || !choices || !preview?.stageId || !preview.agents?.some(agent => agent.id === choices.leadAgentId)) return null
  const available = new Set((preview.availableModels || []).map(model => model.id))
  const models = Object.fromEntries((preview.modelAliases || []).map(alias => [alias, choices.models?.[alias]]))
  if (Object.values(models).some(value => !available.has(value))) return null
  const requested = new Set(preview.agents.flatMap(agent => agent.tools || []))
  const tools = [...new Set(choices.tools || [])]
  if (tools.some(tool => !requested.has(tool) || !preview.availableTools?.includes(tool))) return null
  return { leadAgentId: choices.leadAgentId, models, tools }
}

/** Late file/preview replies cannot update a closed or superseded import dialog. */
export function createImportSelection() {
  let generation = 0
  return { begin: () => ++generation, cancel: () => { generation++ }, current: ticket => ticket === generation }
}
