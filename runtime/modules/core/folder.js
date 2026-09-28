/**
 * Reading agent folders — the one utility that turns files into an AgentSpec.
 *
 *     const index = await loadIndex(base)             // agents/index.json: every file and its hash
 *     agentPaths(index)                              // ['coder', 'coder/reviewer', 'main', ...]
 *     const spec = await readSpec('coder', { index, load })
 *
 * Port of the skeleton's `load_agent` minus the building: this reads, it does not construct.
 * The page uses it for the manifest and each worker uses the same function to build its
 * engine, so what the page shows is what the thread runs.
 *
 * HTTP cannot list a directory, so `index.json` is the listing: a flat map of every published
 * file to a content hash. Everything else — which folders are agents, which agent owns which,
 * which `.js` files are its tools — is derived from those paths here, the same way the
 * skeleton derives it from the filesystem. There is no registry to keep in step.
 */

import { read } from './markdown.js'

const INFERENCE = {
  provider: 'provider',
  model: 'model',
  base_url: 'baseUrl',
  api_key: 'apiKey',
  temperature: 'temperature',
  max_output_tokens: 'maxOutputTokens',
  context_length: 'contextLength',
  via: 'via',
}
const ENGINE = {
  response_format: 'responseFormat',
  observation_format: 'observationFormat',
  contract_version: 'contractVersion',
  prompt_template: 'promptTemplate',
  output_reserve: 'outputReserve',
  require_verification: 'requireVerification',
  max_steps: 'maxSteps',
  repairs: 'repairs',
  compact_at: 'compactAt',
  keep: 'keep',
  remembers: 'remembers',
  session: 'session',
}
const WIRING = ['name', 'description', 'agents', 'tools', 'context', 'skills', 'private', 'permissions']

/** Fetch the published listing. `cache: 'no-cache'` so an edited folder is seen on reload. */
export async function loadIndex(base, fetcher = fetch) {
  const response = await fetcher(new URL('agents/index.json', base), { cache: 'no-cache' })
  if (!response.ok) throw new Error(`agents/index.json answered ${response.status}`)
  return response.json()
}

/** A loader for text files named relative to the published root. */
export function loader(base, index, fetcher = fetch) {
  return async (file) => {
    const response = await fetcher(versioned(base, file, index), { cache: 'no-cache' })
    if (!response.ok) throw new Error(`${file} answered ${response.status}`)
    return response.text()
  }
}

/** A file's URL with its content hash, so a changed module is never served from the module map. */
export function versioned(base, file, index) {
  const url = new URL(file, base)
  const hash = index?.files?.[file]
  if (hash) url.searchParams.set('v', hash)
  return url.href
}

/** Every folder with an `agent.md`, as a path under `agents/`. */
export function agentPaths(index) {
  return Object.keys(index.files ?? {})
    .filter((file) => file.startsWith('agents/') && file.endsWith('/agent.md'))
    .map((file) => file.slice('agents/'.length, -'/agent.md'.length))
    .sort()
}

/** Agents at the head of the tree: the ones anyone may name in `agents:`. */
export function headPaths(index) {
  return agentPaths(index).filter((path) => !path.includes('/'))
}

/** The folders directly inside this one that are agents — the sub-agents it alone holds. */
export function ownedPaths(index, path) {
  return agentPaths(index).filter((child) => parentOf(child) === path)
}

export function parentOf(path) {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? '' : path.slice(0, cut)
}

/** The `.js` files sitting directly in an agent's folder: its own tools. */
export function localToolFiles(index, path) {
  const prefix = `agents/${path}/`
  return Object.keys(index.files ?? {})
    .filter((file) => file.startsWith(prefix) && !file.slice(prefix.length).includes('/') && /\.m?js$/.test(file))
    .sort()
}

/** Common tools: `tools/<name>.js`, granted by name. */
export function commonToolFiles(index) {
  return Object.fromEntries(
    Object.keys(index.files ?? {})
      .filter((file) => /^tools\/[^/]+\.m?js$/.test(file))
      .map((file) => [file.slice('tools/'.length).replace(/\.m?js$/, ''), file]),
  )
}

/** Skills: `skills/<name>.md` or `skills/<name>/skill.md`. */
export function skillFiles(index) {
  const out = {}
  for (const file of Object.keys(index.files ?? {})) {
    const flat = /^skills\/([^/]+)\.md$/.exec(file)
    const nested = /^skills\/([^/]+)\/skill\.md$/.exec(file)
    if (flat) out[flat[1]] = file
    else if (nested) out[nested[1]] = file
  }
  return out
}

/** One fingerprint over every file that decides how an agent behaves, for reload decisions. */
export function agentHash(index, path) {
  const own = [`agents/${path}/agent.md`, `agents/${path}/soul.md`, `agents/${path}/learned.md`, ...localToolFiles(index, path)]
  const templates = Object.entries(index.files ?? {}).filter(([file]) => file.startsWith('prompts/')).sort().map(([, hash]) => hash)
  return [...own.map((file) => index.files?.[file] ?? ''), index.files?.['agents/soul.md'] ?? '', ...templates].join('.')
}

/**
 * Read one agent folder into a plain AgentSpec. Never throws for a bad file's *contents*:
 * unknown keys become notes. A missing `agent.md` still throws, because that is a mistake to
 * fix rather than a condition to survive.
 */
export async function readSpec(path, { index, load }) {
  const { settings, body } = read(await load(`agents/${path}/agent.md`))
  const notes = []
  const inference = {}
  const engine = {}
  for (const [key, value] of Object.entries(settings)) {
    if (key in INFERENCE) inference[INFERENCE[key]] = value
    else if (key in ENGINE) engine[ENGINE[key]] = value
    else if (!WIRING.includes(key)) notes.push(`unknown key "${key}" ignored`)
  }
  if (engine.contractVersion != null && ![1, 2].includes(engine.contractVersion)) throw new Error(`unsupported contract_version: ${engine.contractVersion}`)
  if (engine.observationFormat != null && !['legacy', 'compact'].includes(engine.observationFormat)) throw new Error(`unsupported observation_format: ${engine.observationFormat}`)
  if (engine.contractVersion === 2) {
    if (engine.responseFormat && engine.responseFormat !== 'json') throw new Error('contract_version 2 requires response_format: json')
    engine.responseFormat = 'json'
  }
  if (typeof engine.promptTemplate === 'string') {
    const file = engine.promptTemplate
    if (!/^prompts\/[A-Za-z0-9_./-]+\.md$/.test(file) || file.split('/').includes('..') || index.files?.[file] == null) throw new Error(`prompt_template must name a published prompts/*.md file: ${file}`)
    const template = await load(file)
    const separator = '\n<!-- user -->\n'
    const split = template.indexOf(separator)
    if (split < 0) throw new Error(`prompt template ${file} requires a <!-- user --> separator`)
    engine.promptTemplate = { system: template.slice(0, split), user: template.slice(split + separator.length) }
  }

  const ownSoul = index.files?.[`agents/${path}/soul.md`] != null
  const soulFrom = ownSoul ? `agents/${path}/soul.md` : index.files?.['agents/soul.md'] != null ? 'agents/soul.md' : ''
  const soul = soulFrom ? read(await load(soulFrom)).body : ''

  const learnedFile = `agents/${path}/learned.md`
  const learned = index.files?.[learnedFile] != null ? read(await load(learnedFile)).body : ''

  const heads = new Set(headPaths(index))
  const peers = list(settings.agents)
  for (const peer of peers) if (!heads.has(peer)) notes.push(`agents: "${peer}" is not a folder at the head of agents/`)

  const common = commonToolFiles(index)
  const grants = list(settings.tools)
  return {
    path,
    name: String(settings.name ?? path.split('/').pop()),
    description: String(settings.description ?? '').trim(),
    body,
    soul,
    soulFrom,
    learned,
    permissions: settings.permissions && typeof settings.permissions === 'object' ? settings.permissions : {},
    inference,
    engine,
    context: settings.context ?? [],
    peers: peers.filter((peer) => heads.has(peer) && peer !== path),
    grants,
    skills: Boolean(settings.skills),
    private: Boolean(settings.private),
    owned: ownedPaths(index, path),
    localTools: localToolFiles(index, path),
    commonTools: Object.fromEntries(grants.filter((name) => common[name]).map((name) => [name, common[name]])),
    hash: agentHash(index, path),
    notes,
  }
}

function list(value) {
  if (value == null) return []
  return (Array.isArray(value) ? value : [value]).map(String).filter(Boolean)
}
