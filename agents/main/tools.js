/**
 * Tools for the main agent.
 *
 * Every function in `TOOLS` is one the agent file may name. Unlike the Python
 * this was ported from, a JavaScript function cannot be asked for its parameter
 * names — `Function.prototype.toString` is destroyed by the minifier this page
 * ships through — so each tool declares its own shape with `tool()`. The
 * description and the usage args are what the model reads, and they are the
 * whole of what it is told: the model is never informed whether it is calling a
 * local function, another agent, or an MCP tool.
 *
 * A function can instead be a modality provider: name it under `multimodal:` in
 * agent.md and it is called before every inference, with whatever it returns
 * attached to the request. It is never advertised as a callable tool. Return a
 * data URL (`data:image/png;base64,...`), or an empty string to attach nothing.
 */

import { tool } from "../../core/tools.js"
import { cronTools } from "../../core/schedule.js"

export const TOOLS = cronTools()

export { tool }
