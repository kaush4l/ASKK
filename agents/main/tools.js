/**
 * Tools for the main agent.
 *
 * Every function this file hands back is one the agent file may name. Unlike
 * the Python this was ported from, a JavaScript function cannot be asked for
 * its parameter names — `Function.prototype.toString` is destroyed by the
 * minifier this page ships through — so each tool declares its own shape with
 * `tool()`. The description and the usage args are what the model reads, and
 * they are the whole of what it is told: the model is never informed whether it
 * is calling a local function, another agent, or an MCP tool.
 *
 * A function can instead be a modality provider: name it under `multimodal:` in
 * agent.md and it is called before every inference, with whatever it returns
 * attached to the request. It is never advertised as a callable tool. Return a
 * data URL (`data:image/png;base64,...`), or an empty string to attach nothing.
 *
 * **There is no `TOOLS` constant here, and that is the fix for a real defect.**
 * The cron tools are an agent run scheduled against a store, and the store is
 * environment — `{ cron, fs, launch }`, which nothing in an agent folder can
 * reach. This file used to call `cronTools()` with no arguments, which is a
 * type error that kept the whole file out of the bundle and left the main agent
 * with none of the four tools its own prompt teaches the model to use. So the
 * file exports a **factory** instead, and the one place that owns the ports —
 * `app/worker.js`, the browser side of the seam — calls it. `loadTools` asks a
 * module for `TOOLS`, and `app/worker.js` is what produces that list.
 *
 * The default export is the same factory, and it exists so `app/seed.js` can
 * import this file's *bytes* with `with { type: "text" }` and still typecheck:
 * `tsc` resolves the `.js` and wants a default binding, `bun` honours the
 * attribute and hands over the source. One file, two loaders, no second copy.
 */

import { cronTools } from "../../core/schedule.js"
import { tool } from "../../core/tool-call.js"

/** @typedef {import("../../core/schedule.js").Deps} Deps */

/** The four cron tools, bound to whatever store the environment offers.
 * @param {Deps} deps @returns {ReturnType<typeof tool>[]} */
export function makeTools(deps) {
  return cronTools(deps)
}

export default makeTools

export { tool }
