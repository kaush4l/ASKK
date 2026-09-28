/**
 * A common tool module: any agent may grant it with `tools: [text]`.
 *
 * Common tools live in tools/, are shared, and are written by the owner. They follow the same
 * shape as an agent's own tools: plain exports, no imports, capabilities through `ctx`.
 */

export const count_words = {
  description: 'Count the words, lines and characters in a piece of text.',
  parameters: { text: 'string' },
  risk: 'read',
  run: ({ text = '' }) => {
    const body = String(text)
    const words = body.trim() ? body.trim().split(/\s+/).length : 0
    return `${words} words, ${body.split('\n').length} lines, ${body.length} characters`
  },
}

export const today = {
  description: 'The date and time now, in ISO form and in words, with the time zone.',
  parameters: {},
  risk: 'read',
  repeatable: true,
  run: () => {
    const now = new Date()
    return `${now.toISOString()} (${now.toString()})`
  },
}
