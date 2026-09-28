/**
 * Built-in `sessions` — search what earlier runs said and did.
 *
 * Memory holds what an agent chose to keep; this reaches everything else: every kept run's
 * question, answer and turns (the last 200 runs persist). An agent asks "did we do this
 * before?" instead of starting cold.
 */

export const session_search = {
  description: 'Search earlier runs (question, answer and every step) for words in the query. Newest first.',
  parameters: { query: 'string', agent: 'only runs of this agent (optional)', limit: 'number (default 5)' },
  risk: 'read',
  repeatable: true,
  run: async ({ query, agent, limit = 5 }, ctx) => {
    const found = await ctx.request('sessions.search', { query, agent, limit: Number(limit) || 5 })
    if (!found.length) return 'no earlier run matches'
    return found.map((hit) => `run ${hit.id} · ${hit.agent} · ${hit.when}\n  asked: ${hit.query}\n  ${hit.snippet}`).join('\n\n')
  },
}

export const session_read = {
  description: 'Read one earlier run in full by its id: the question, each step, and the answer.',
  parameters: { id: 'string' },
  risk: 'read',
  run: async ({ id }, ctx) => {
    const run = await ctx.request('sessions.read', { id })
    return run ?? `no kept run with id ${id}`
  },
}
