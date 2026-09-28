/**
 * Built-in `skill` — procedures kept out of the prompt until they are asked for.
 *
 * Port of the skeleton's `core/skills.py`, now wired: `skill_list` gives name and description
 * for every skill cheaply, and `skill_load` returns the full text of the ones the agent decides
 * it needs. A skill is `skills/<name>.md` or `skills/<name>/skill.md`.
 */

export const skill_list = {
  description: 'List the skills you can load: name and one line on when each helps.',
  parameters: {},
  risk: 'read',
  repeatable: true,
  run: async (_, ctx) => {
    const listed = await ctx.request('skill.list')
    return listed.length ? listed.map((skill) => `- ${skill.name}: ${skill.description}`).join('\n') : 'no skills are published'
  },
}

export const skill_load = {
  description: 'Load the full text of a skill by name, before doing the kind of work it describes.',
  parameters: { name: 'string' },
  risk: 'read',
  run: async ({ name }, ctx) => {
    const skill = await ctx.request('skill.load', { name })
    return skill ? skill.body : `no skill named "${name}"`
  },
}

export const skill_save = {
  description:
    'Save a procedure that worked as a skill, so any agent can load it next time. ' +
    'Write it as steps another agent could follow cold: when it applies, the steps, how to check the result. ' +
    'Saving a name again replaces your earlier version; a published skill of the same name is never replaced.',
  parameters: { name: 'kebab-case name', description: 'one line: when this helps', body: 'the procedure, in markdown' },
  risk: 'write',
  run: async ({ name, description, body }, ctx) => {
    const saved = await ctx.request('skill.save', { name, description, body })
    return `saved skill "${saved.name}" (version ${saved.rev}); load it with skill_load`
  },
}
