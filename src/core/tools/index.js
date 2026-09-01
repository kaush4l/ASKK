import { FetchTool } from './FetchTool.js'
import { SearchTool } from './SearchTool.js'
import { ShellTool } from './ShellTool.js'

/**
 * Tools that come with the machinery rather than with a project.
 *
 * An agent file names the tools it wants; anything not named is not attached.
 * Nothing is given to an agent that did not ask for it.
 *
 * Each entry is a FACTORY taking the things only the running app can supply — a
 * sandbox, a transport — because a tool that needs a collaborator cannot be a
 * value in a table written at import time.
 *
 * The bar for being here, learned by deleting the one tool that failed it:
 *
 *   A FACT belongs in the context block. A CAPABILITY belongs in a tool.
 *
 * There was a `now` tool. The time is already in every prompt, so it spent a
 * call, a result and a second inference fetching what the model had read a few
 * hundred characters earlier. A tool earns its round trip by DOING something a
 * prompt cannot contain.
 */
export const BUILTIN_TOOLS = {
  shell: ({ sandbox } = {}) => new ShellTool({ sandbox }),
  // Both take the same port and neither takes the global `fetch`, so the two
  // tools whose every interesting case is a failure are the two that can be
  // tested without a network.
  fetch: ({ http } = {}) => new FetchTool({ http }),
  search: ({ http } = {}) => new SearchTool({ http }),
}

export { McpTool } from './McpTool.js'
export { ShellTool } from './ShellTool.js'
export { SubAgentTool } from './SubAgentTool.js'
export { Tool } from './Tool.js'
export { Toolbox } from './Toolbox.js'
