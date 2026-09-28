/**
 * Built-in `todo` — the plan for the task in hand, kept outside the conversation.
 *
 * A long task drifts; a written plan does not. The list belongs to the run, the page shows it
 * beside the run, and writing it again replaces it, so it is always the whole current plan.
 */

const MARKS = { todo: '[ ]', doing: '[~]', done: '[x]', dropped: '[-]' }

export const todo_write = {
  description:
    'Write the whole plan for this task as a list, replacing the last one. Each item: {text, status}; ' +
    'status is todo, doing, done or dropped. Keep exactly one item doing while you work.',
  parameters: { items: '[{text, status}]' },
  risk: 'read',
  repeatable: true,
  run: async ({ items }, ctx) => {
    const list = await ctx.request('todo.set', { items: Array.isArray(items) ? items : [] })
    return show(list)
  },
}

export const todo_read = {
  description: 'Read the current plan for this task.',
  parameters: {},
  risk: 'read',
  repeatable: true,
  run: async (_, ctx) => show(await ctx.request('todo.get')),
}

function show(list) {
  if (!list.length) return 'the plan is empty'
  const open = list.filter((item) => item.status === 'todo' || item.status === 'doing').length
  return `${list.map((item) => `${MARKS[item.status] ?? '[ ]'} ${item.text}`).join('\n')}\n(${open} open of ${list.length})`
}
