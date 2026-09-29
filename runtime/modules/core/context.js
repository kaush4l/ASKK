/**
 * Context — what is true right now, gathered each time the prompt is rendered.
 *
 *     context: [time, budget, board]          # in agent.md frontmatter
 *     context: {time: {zone: UTC}}             # a piece may take settings
 *
 * Port of the skeleton's `core/context.py`. Every other layer is written once and read back
 * unchanged; context is a function that runs on every render, so it is never stale. A piece
 * is handed the engine it renders for, so it can report the world or the agent's own state.
 *
 * Context is not memory and not a tool result. If it has to be fetched by deciding to fetch
 * it, it is a tool. If it is simply true and cheap to state, it is context.
 */

export const CONTEXTS = {
  /** The date and time, as the machine running the agent sees them. */
  time: (settings = {}) => ({
    name: 'time',
    render: () => {
      const shown = new Date().toLocaleString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
        ...(settings.zone ? { timeZone: settings.zone } : {}),
      })
      return `The time is ${shown}.`
    },
  }),

  /**
   * Steps spent of steps allowed, and history against the window. An agent that cannot see its
   * budget cannot spend it: it explores for nine steps and is cut off on the tenth.
   */
  budget: () => ({
    name: 'budget',
    render: async (engine) => {
      const budget = engine.promptBudget
      return budget ? `Full request estimate: ${budget.inputTokens} input + ${budget.outputReserve} output of ${budget.window} tokens.` : 'The full request budget is computed when the prompt is assembled.'
    },
  }),

  /** The open entries on the task's shared board, so every participant reads the current state. */
  board: () => ({
    name: 'board',
    render: async (engine) => {
      const entries = (await engine.ctx?.board?.list?.()) ?? []
      const open = entries.filter((entry) => !entry.resolved)
      if (!open.length) return 'The task board is empty.'
      return `The task board:\n${open.map((entry) => `- [${entry.kind} #${entry.id} by ${entry.author}] ${entry.text}`).join('\n')}`
    },
  }),

  /**
   * What this agent remembers: its own notes and the shared ones, newest first, capped so the
   * standing cost stays fixed however much is saved (Hermes: a bounded, frozen snapshot).
   */
  memory: (settings = {}) => ({
    name: 'memory',
    render: async (engine) => {
      const cap = settings.chars ?? 2000
      const entries = (await engine.ctx?.memory?.list?.()) ?? []
      const block = (title, rows) => {
        let used = 0
        const kept = []
        for (const row of rows) {
          const line = `- ${row.text}`
          if (used + line.length > cap) break
          kept.push(line)
          used += line.length
        }
        return kept.length ? `${title}:\n${kept.join('\n')}` : ''
      }
      const own = block('What you remember', entries.filter((entry) => entry.agent === engine.path))
      const shared = block('What every agent remembers', entries.filter((entry) => entry.agent === 'shared'))
      return [own, shared].filter(Boolean).join('\n') || 'You have no saved memories yet.'
    },
  }),

  /** What this thread can reach outside the browser, stated once so the agent does not guess. */
  runtime: () => ({
    name: 'runtime',
    render: (engine) => {
      const host = engine.ctx?.host
      const reach = host
        ? `The companion grants only these capabilities: ${(host.capabilities ?? []).join(', ') || 'none'}. Pairing for model or network relay does not grant native execution. Consult the workspace binding for file and command execution.`
        : 'No general host tools are paired through the desk connection. Workspace files and commands use their separately selected execution binding.'
      return `This agent runs in its own worker. ${reach}`
    },
  }),

  /** Configured context with owner-supplied facts, never model-selected authority. */
  workspace: (settings = {}) => ({
    name: 'workspace',
    render: async engine => {
      const environment = await engine.ctx?.request?.('workspace.environment')
      if (!environment) return ''
      const limit = Number.isSafeInteger(settings.fileLimit) && settings.fileLimit >= 0 ? settings.fileLimit : 100
      const current = Array.isArray(environment.files) ? { ...environment, files: environment.files.slice(0, limit), fileCount: environment.files.length, filesOmitted: Math.max(0, environment.files.length - limit) } : environment
      return `Workspace environment:\n${JSON.stringify({ run: engine.ctx.runContext ?? null, current })}`
    },
  }),

  goal: () => ({
    name: 'goal',
    render: async engine => {
      const goal = await engine.ctx?.request?.('workspace.goal')
      return goal?.text ? `Owner's saved conversation goal (revision ${goal.revision}):\n${goal.text}` : ''
    },
  }),

  plan: () => ({
    name: 'plan',
    render: async engine => {
      const plan = await engine.ctx?.request?.('todo.get')
      return plan?.length ? `Current task plan:\n${JSON.stringify(plan)}` : 'No task plan has been recorded.'
    },
  }),
}

/** The pieces an agent asked for, in the order it asked for them. Unknown names become notes. */
export function contexts(listed, notes = []) {
  const entries = Array.isArray(listed) ? listed.map((name) => [name, {}]) : Object.entries(listed ?? {})
  const pieces = []
  for (const [name, settings] of entries) {
    if (CONTEXTS[name]) pieces.push(CONTEXTS[name](settings ?? {}))
    else notes.push(`unknown context "${name}"; known: ${Object.keys(CONTEXTS).join(', ')}`)
  }
  return pieces
}
