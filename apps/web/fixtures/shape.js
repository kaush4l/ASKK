/**
 * ONE REALISTIC PROJECTION PER VIEW — the five that are about what the system
 * IS rather than what it is doing (docs/SEAM.md: agents, tools, settings,
 * status, problem). Nothing here is true; see `fixtures/run.js`.
 */

/** @type {import('@/components/views/agents').AgentsData} */
export const agents = {
  emptyNote:
    'No agents loaded. public/agents/index.json is the manifest — an agent folder that is not listed there is never fetched.',
  entries: [
    { name: 'main', status: 'ok', statusLabel: 'Loaded', fileLabel: 'agents/main/agent.md',
      modelLabel: 'Calls the local endpoint', resolvesLabel: 'local → gemma-3-12b-it at http://127.0.0.1:1234' },
    { name: 'scout', status: 'ok', statusLabel: 'Loaded', fileLabel: 'agents/scout/agent.md',
      modelLabel: 'Calls the local endpoint', resolvesLabel: 'local → gemma-3-12b-it at http://127.0.0.1:1234' },
    { name: 'critic', status: 'ok', statusLabel: 'Written here', fileLabel: 'authored in this browser',
      modelLabel: 'Calls the hosted endpoint', resolvesLabel: '' },
  ],
  problems: [
    {
      kind: 'agent_file_unreadable',
      message: 'archivist was listed in the manifest and its file could not be read.',
      detail: 'agents/archivist/agent.md answered 404. The manifest lists it, so nothing else fetched it.',
      repair: 'Add the file, or take the folder out of public/agents/index.json.',
    },
  ],
}

/** @type {import('@/components/views/tools').ToolsData} */
export const tools = {
  emptyNote: 'This build grants no capability, so no tool resolves.',
  tools: [
    { name: 'web_search', capabilityLabel: 'Needs Net', status: 'ok', resolvesLabel: 'Resolves to Firecrawl, keyless' },
    { name: 'read_file', capabilityLabel: 'Needs Workspace', status: 'ok', resolvesLabel: 'Resolves to OPFS' },
    { name: 'write_file', capabilityLabel: 'Needs Workspace', status: 'ok', resolvesLabel: 'Resolves to OPFS' },
    { name: 'speak', capabilityLabel: 'Needs Speech', status: 'failed', resolvesLabel: 'This browser offers no speech synthesis' },
  ],
}

/** @type {import('@/components/views/settings').SettingsData} */
export const settings = {
  emptyNote: 'The catalogue is empty, so a turn has nowhere to go.',
  note: 'A key is written straight to this browser and never through the seam, because every request is recorded as a fact and a key must not be in one.',
  entries: [
    { id: 'local', name: 'The local endpoint', status: 'ok', addressLabel: 'http://127.0.0.1:1234/v1',
      keyLabel: 'No key needed', resolvesLabel: 'Answers — gemma-3-12b-it' },
    { id: 'hosted', name: 'The hosted endpoint', status: 'failed', addressLabel: 'https://api.example.com/v1',
      keyLabel: 'A key is set', resolvesLabel: 'Refused the last call: 401' },
    { id: 'ondevice', name: 'The built-in model', status: 'idle', addressLabel: 'Runs in this tab',
      keyLabel: 'No key needed', resolvesLabel: 'Not downloaded yet — 1.1 GB' },
  ],
}

/** @type {import('@/components/views/status').StatusData} */
export const status = {
  status: 'failed',
  headline: 'The hosted endpoint refused the last call, and the local one is answering.',
  detail: 'Read off the board: one agent failed on a 401 and three are reaching the local endpoint normally.',
}

/**
 * THE ONE FAILURE SHAPE, AS THE SEAM RETURNS IT for an address that names no
 * route — the 404 row at the bottom of the route table.
 * @type {import('@/components/views/problem').ProblemData}
 */
export const problem = {
  kind: 'no_such_route',
  message: 'The seam has no route at that address.',
  detail: 'GET /wharrgarbl reached handle and matched nothing in the route table.',
  repair: 'Check the address against docs/SEAM.md, which lists every route there is.',
}
