/**
 * Built-in `schedule` — tasks that start themselves later, or again and again.
 *
 * The hub keeps the schedules and starts each one as a new task when it falls due. A browser
 * gives no way to wake a closed tab, so a schedule runs only while a tab of this page is open;
 * one that fell due while every tab was closed runs once when the page next opens.
 */

export const schedule_task = {
  description:
    'Start a task later or repeatedly: agent gets query as a new task. Give every_minutes to repeat, ' +
    'or in_minutes for once. The owner can see and cancel every schedule.',
  parameters: { agent: 'string', query: 'string', every_minutes: 'number (repeat)', in_minutes: 'number (once)' },
  risk: 'write',
  run: async (args, ctx) => {
    const made = await ctx.request('schedule.add', args)
    return `scheduled #${made.id}: ${made.agent} "${made.query}" ${made.every ? `every ${made.every} min` : 'once'}, next at ${new Date(made.next).toISOString()}`
  },
}

export const schedule_list = {
  description: 'List the schedules: id, agent, query, when it next runs.',
  parameters: {},
  risk: 'read',
  repeatable: true,
  run: async (_, ctx) => {
    const listed = await ctx.request('schedule.list')
    return listed.length
      ? listed.map((item) => `#${item.id} ${item.agent} "${item.query}" ${item.every ? `every ${item.every} min` : 'once'} · next ${new Date(item.next).toISOString()}${item.last ? ` · last ran ${item.last.status}` : ''}`).join('\n')
      : 'nothing is scheduled'
  },
}

export const schedule_cancel = {
  description: 'Cancel a schedule by its id.',
  parameters: { id: 'number' },
  risk: 'read',
  run: async ({ id }, ctx) => ((await ctx.request('schedule.cancel', { id: Number(id) })) ? `cancelled #${id}` : `no schedule #${id}`),
}
