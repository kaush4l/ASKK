/**
 * Built-in `memory` — what an agent keeps between tasks.
 *
 * Two scopes: an agent's own notes, and shared notes every agent reads. Saved in the browser
 * (IndexedDB) by the hub. The `memory` context piece renders a capped snapshot at every step,
 * so the standing cost is fixed however much is saved; search reaches the rest.
 *
 * Memory is for facts that stay true: the owner's preferences, how this project builds, what
 * failed last time. It is not a scratchpad for the task in hand — that is the board.
 */

export const memory_save = {
  description:
    'Remember a fact for later tasks, in one plain sentence. scope "agent" is yours alone; "shared" every agent reads. ' +
    'Save what stays true (preferences, how things build, what failed), not what you are doing now.',
  parameters: { text: 'string', scope: 'agent | shared (default agent)' },
  risk: 'read',
  run: async ({ text, scope = 'agent' }, ctx) => {
    const entry = await ctx.request('memory.save', { text, scope })
    return `remembered #${entry.id} (${entry.agent === 'shared' ? 'shared' : 'yours'})`
  },
}

export const memory_search = {
  description: 'Search every memory you can read, yours and shared, for words in the query.',
  parameters: { query: 'string' },
  risk: 'read',
  repeatable: true,
  run: async ({ query }, ctx) => {
    const found = await ctx.request('memory.search', { query })
    return found.length ? found.map((entry) => `#${entry.id} [${entry.agent}] ${entry.text}`).join('\n') : 'nothing remembered matches'
  },
}

export const memory_forget = {
  description: 'Forget one memory by its id, when it has stopped being true.',
  parameters: { id: 'number' },
  risk: 'read',
  run: async ({ id }, ctx) => {
    await ctx.request('memory.forget', { id: Number(id) })
    return `forgot #${id}`
  },
}
