import { FetchTool } from './FetchTool.js'
import { ReadFileTool } from './ReadFileTool.js'
import { SearchTool } from './SearchTool.js'
import { ShellTool } from './ShellTool.js'
import { WriteFileTool } from './WriteFileTool.js'

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
  // `shell` takes the file store as well as the sandbox, because the guest
  // throws its filesystem away every command and a shell that cannot see the
  // agent's own files is a shell that can only ever compute. What that costs
  // and why it is one-sided is argued in `ShellTool`.
  shell: ({ sandbox, files } = {}) => new ShellTool({ sandbox, files }),
  // There is no `list_files`. The names of the agent's files are a FACT, and
  // the bar above puts a fact in the context block — `ChatService` renders them
  // there, one line, every turn. A tool returning what the prompt already says
  // is the `now` tool this table deleted, and the measurement is in the report:
  // the line costs ~5 tokens a file per turn against a whole round trip.
  read_file: ({ files } = {}) => new ReadFileTool({ files }),
  write_file: ({ files } = {}) => new WriteFileTool({ files }),
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
