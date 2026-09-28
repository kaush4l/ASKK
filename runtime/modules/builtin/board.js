/**
 * Built-in `board` — the task's shared memory space (docs/rewrite/ARCHITECTURE.md §6.7).
 *
 * One board per task tree, owned by the hub, so writes are serialised and no two agents can
 * overwrite each other. Every run in the tree reads the open entries through the `board`
 * context piece at its next step, so an agent learns from a peer without routing everything
 * through the lead. The board is released when the task ends.
 */

export const board_post = {
  description: 'Post to the task board every agent on this task reads: kind is plan, question, finding or note.',
  parameters: { kind: 'plan | question | finding | note', text: 'string' },
  risk: 'read',
  run: async ({ kind = 'note', text }, ctx) => {
    const entry = await ctx.request('board.post', { kind, text })
    return `posted ${entry.kind} #${entry.id}`
  },
}

export const board_list = {
  description: 'Read the whole task board, resolved entries included.',
  parameters: {},
  risk: 'read',
  repeatable: true,
  run: async (_, ctx) => {
    const entries = await ctx.request('board.list')
    if (!entries.length) return 'The board is empty.'
    return entries.map((entry) => `#${entry.id} ${entry.kind}${entry.resolved ? ' (resolved)' : ''} by ${entry.author}: ${entry.text}`).join('\n')
  },
}

export const board_resolve = {
  description: 'Mark a board entry resolved, with a short note saying how. It leaves the open list.',
  parameters: { id: 'number', note: 'string (optional)' },
  risk: 'read',
  run: async ({ id, note }, ctx) => {
    const entry = await ctx.request('board.resolve', { id: Number(id), note })
    return `resolved #${entry.id}`
  },
}

export const board_tell = {
  description: 'Leave a note for another agent working on this task; it reads it before its next step. Delivery, not an answer.',
  parameters: { agent: 'agent path, e.g. coder', text: 'string' },
  risk: 'read',
  run: async ({ agent, text }, ctx) => {
    const { delivered } = await ctx.request('board.tell', { agent, text })
    return delivered ? `told ${agent}` : `${agent} is not running on this task; nothing was delivered`
  },
}
