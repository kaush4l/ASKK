/**
 * ONE REALISTIC PROJECTION PER VIEW — the five that are about what the system
 * IS rather than what it is doing (docs/SEAM.md: agents, tools, settings,
 * status, problem). Nothing here is true; see `fixtures/run.js`.
 *
 * The shapes are the CORE'S, field for field, because that is what makes them a
 * check: `packages/core/src/agents.js` and `settings.js` are what a browser
 * actually hands these components, and a fixture written to the shape the
 * interface would have preferred is a gallery of screens the product cannot
 * produce. Two of them were exactly that for three increments.
 */

/** @type {import('@/components/views/agents').AgentsData} */
export const agents = {
  emptyNote: 'No agent file loaded, so this build has nobody to talk to.',
  rows: [
    { id: 'main', name: 'main', path: 'agents/main/agent.md', originLabel: 'shipped with this build',
      modelLabel: 'gemma-3-12b-it', toolsLabel: 'web_search, read_file, write_file', isMe: true },
    { id: 'scout', name: 'scout', path: 'agents/scout/agent.md', originLabel: 'shipped with this build',
      modelLabel: "the catalogue's default", toolsLabel: 'Every tool this build offers.', isMe: false },
    { id: 'critic', name: 'critic', path: 'critic/agent.md', originLabel: 'written here',
      modelLabel: 'claude-sonnet-4', toolsLabel: 'read_file', isMe: false },
  ],
  refusals: [
    {
      id: 'agents/archivist/agent.md',
      kind: 'unreadable_agent',
      message: 'archivist was listed in the manifest and its file could not be read.',
      detail: 'agents/archivist/agent.md answered 404. The manifest lists it, so nothing else fetched it.',
      repair: 'Add the file, or take the folder out of agents/index.json.',
    },
  ],
}

/** @type {import('@/components/views/tools').ToolsData} */
export const tools = {
  emptyNote: "This agent's file resolved no tools, so every reply it gives is one reply and nothing else.",
  resolvedLabel: '3 of 4 resolve in this build.',
  rows: [
    { id: 'web_search', name: 'web_search', usage: 'web_search({"query": "<string>"}): search the web and read back titles, links and snippets',
      needsLabel: 'Needs the right to reach the network.', resolves: true, resolvesLabel: 'Resolved: this build has something behind it.' },
    { id: 'read_file', name: 'read_file', usage: 'read_file({"path": "<string>"}): read a file from the workspace',
      needsLabel: 'Needs the right to read and write files.', resolves: true, resolvesLabel: 'Resolved: this build has something behind it.' },
    { id: 'write_file', name: 'write_file', usage: 'write_file({"path": "<string>", "contents": "<string>"}): write a whole file into the workspace',
      needsLabel: 'Needs the right to read and write files.', resolves: true, resolvesLabel: 'Resolved: this build has something behind it.' },
    { id: 'speak', name: 'speak', usage: 'speak({"text": "<string>"}): say a sentence out loud',
      needsLabel: 'Needs the right to use this device’s voice.', resolves: false,
      resolvesLabel: 'This build cannot use this device’s voice, so this tool is not offered to the model.' },
  ],
}

/** @type {import('@/components/views/settings').SettingsData} */
export const settings = {
  selected: 'local',
  modelLabel: 'Every call goes to local, whatever an agent file asks for.',
  searchLabel: 'Search runs against the built-in ladder, which needs no configuration and no key.',
  storeLabel: 'Storage is working.',
  keyNote: 'A key is written straight into this browser’s storage, unencrypted. Nothing here can read one back.',
  entries: [
    { id: 'local', name: 'local', model: 'gemma-3-12b-it', baseUrl: 'http://127.0.0.1:1234/v1',
      hasKey: false, keyLabel: 'No key saved.', selected: true },
    { id: 'openrouter', name: 'openrouter', model: 'anthropic/claude-sonnet-4', baseUrl: 'https://openrouter.ai/api/v1',
      hasKey: true, keyLabel: 'A key is saved for this entry.', selected: false },
    { id: 'ondevice', name: 'ondevice', model: 'gemma-3-1b-it-int4', baseUrl: 'Runs in this tab',
      hasKey: false, keyLabel: 'No key saved.', selected: false },
  ],
}

/** @type {import('@/components/views/status').StatusData} */
export const status = {
  status: 'failed',
  headline: 'Storage has failed 2 times — the most recent was a quota the browser would not raise.',
  detail: 'Read off the log and the capability list this build started with.',
}

/**
 * THE ONE FAILURE SHAPE, AS THE SEAM RETURNS IT for an address that names no
 * route — the 404 row at the bottom of the route table.
 * @type {import('@/components/views/problem').ProblemData}
 */
export const problem = {
  id: 'GET /wharrgarbl',
  kind: 'no_such_route',
  message: 'The seam has no route at that address.',
  detail: 'GET /wharrgarbl reached handle and matched nothing in the route table.',
  repair: 'Check the address against docs/SEAM.md, which lists every route there is.',
}
