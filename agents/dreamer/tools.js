/**
 * The dreamer's own tool: propose a change to another agent's prompt. It lands in the owner's
 * review list and changes nothing until they accept it; accepted proposals become that agent's
 * LEARNED layer (docs/rewrite/ARCHITECTURE.md §15).
 */

export const propose = {
  description:
    'Propose one short instruction for an agent to follow next time, and why, citing what happened in the task. ' +
    'The owner accepts or rejects it; it changes nothing until then.',
  parameters: { agent: 'agent path, e.g. coder', text: 'the instruction, one or two sentences', why: 'what in the task shows it is needed' },
  risk: 'read',
  run: async ({ agent, text, why }, ctx) => {
    if (agent === ctx.agent.path) return 'you cannot propose changes to yourself'
    const { id } = await ctx.request('dream.propose', { agent, text, why })
    return `proposal #${id} for ${agent} is waiting for the owner`
  },
}
