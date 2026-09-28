/**
 * Example tools that belong to main alone. Every exported function or `{description, parameters, run}`
 * object in this folder becomes one of main's tools; names starting with `_` stay private.
 *
 * A tool module imports nothing. What it needs from the harness arrives as `ctx`:
 * ctx.request(op, args), ctx.host, ctx.agent, ctx.signal, ctx.note(text).
 */

export const add = {
  description: 'Add two numbers and return the sum.',
  parameters: { a: 'number', b: 'number' },
  risk: 'read',
  run: ({ a, b }) => Number(a) + Number(b),
}

export function multiply({ a, b }) {
  return Number(a) * Number(b)
}
multiply.description = 'Multiply two numbers and return the product.'
multiply.parameters = { a: 'number', b: 'number' }
multiply.risk = 'read'

/**
 * Write a new sub-agent folder. The browser cannot write to its own published folders, so this
 * goes through the host bridge, and it only works when the bridge's root is this project.
 */
export const create_agent = {
  description:
    'Create a sub-agent of your own: a new folder with an agent.md. Needs the host bridge with its root at this project. ' +
    'The description is what you will read when choosing to call it; the instructions are its whole job. It exists after Reload agents.',
  parameters: { name: 'folder name, letters digits and underscores', description: 'string', instructions: 'string' },
  requires: ['host'],
  risk: 'write',
  run: async ({ name, description, instructions }, ctx) => {
    if (!/^[A-Za-z_]\w*$/.test(String(name))) return `"${name}" is not a usable folder name; use letters, digits and underscores`
    const path = `public/agents/main/${name}/agent.md`
    const content = `---\nname: ${name}\ndescription: ${String(description).replace(/\n/g, ' ')}\n---\n\n${String(instructions).trim()}\n`
    await ctx.request('host', { endpoint: '/fs/write', body: { path, content } })
    return `wrote ${path}; it is yours to call after Reload agents`
  },
}
