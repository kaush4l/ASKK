// Tool execution: a tool plan's stages, live progress, one call by name.
// A part of BaseEngine (core/base-engine.js): its methods are mixed into
// BaseEngine.prototype, so `this` is the engine.

import { Artifact } from "@/backend/core/artifact"
import { clipInputs } from "@/backend/core/engine/helpers"
import { BaseEngine } from "@/backend/core/base-engine"
import { LIMITS } from "@/lib/config"

// Most tool calls one response may make (all stages together).
const MAX_CALLS_PER_STEP = LIMITS.toolPlan.maxCallsPerStep
// Tool inputs as shown while a call runs (activity.calls): long strings cut
// (clipInputs, core/engine/helpers.js), the full inputs land on the tool
// message when the call ends.
const LIVE_PROGRESS_CHARS = LIMITS.engine.liveProgressChars // a streaming call's live output kept in state (its tail; every patch re-sends it to every tab)
const LIVE_PROGRESS_MS = LIMITS.engine.liveProgressMs // progress reaches the state at most ten times a second

export class ToolsPart {
  // ── tool execution ─────────────────────────────────────────────────────

  // Run a tool plan exactly as written: stages one after another, the calls
  // of a parallel stage started together and joined. Once a stage has a
  // failed call, later stages are skipped (they may depend on it). Pushes one
  // tool message per call, in written order. Returns whether all succeeded.
  async runTools(plan, signal) {
    const total = plan.flat().length
    if (total > MAX_CALLS_PER_STEP) {
      this.push(
        this.message("tool", {
          name: null,
          ok: false,
          output: `Too many tool calls in one response (${total}); the limit is ${MAX_CALLS_PER_STEP}.`,
          content: `Result: Error: too many tool calls (${total} > ${MAX_CALLS_PER_STEP})`,
        })
      )
      return false
    }

    let failed = null
    for (const [index, calls] of plan.entries()) {
      const stage = index + 1
      const parallel = calls.length > 1
      const kindOf = (name) => (this.toolsMap.get(name)?.kind === "agent" ? "agent" : "tool")
      const viewOf = (name) => this.toolsMap.get(name)?.view ?? null
      const result = (call, fields) =>
        this.message("tool", {
          name: call.name,
          kind: kindOf(call.name),
          view: viewOf(call.name),
          inputs: call.inputs,
          stage,
          parallel,
          ...fields,
          content: `Result: ${call.name}: ${fields.output}`,
        })

      if (failed) {
        for (const call of calls) {
          this.push(result(call, { ok: false, skipped: true, output: `Skipped: ${failed} failed earlier in this response.` }))
        }
        continue
      }

      const names = calls.map((c) => c.name)
      // calls: what is running now, for views that follow it live (Live follow);
      // a tool that streams adds its progress to its call while it runs.
      const running = calls.map((c) => ({ name: c.name, kind: kindOf(c.name), view: viewOf(c.name), streams: !!this.toolsMap.get(c.name)?.streams, inputs: clipInputs(c.inputs), progress: null }))
      const since = new Date().toISOString()
      this.update({ activity: { phase: parallel ? "tools" : kindOf(names[0]), name: names[0], names, calls: running, stage, since } })
      let publishing = null
      const publish = () => {
        publishing = null
        if (this._state.activity?.since === since) this.update({ activity: { ...this._state.activity, calls: running.map((c) => ({ ...c })) } })
      }
      const progressOf = (i) => (update) => {
        if (!update || typeof update !== "object") return
        const progress = { ...(running[i].progress ?? {}) }
        if (typeof update.append === "string") progress.text = `${progress.text ?? ""}${update.append}`.slice(-LIVE_PROGRESS_CHARS)
        if (typeof update.text === "string") progress.text = update.text.slice(-LIVE_PROGRESS_CHARS)
        if (update.data && typeof update.data === "object") progress.data = { ...(progress.data ?? {}), ...update.data }
        progress.at = new Date().toISOString()
        running[i].progress = progress
        publishing ??= setTimeout(publish, LIVE_PROGRESS_MS)
      }
      const outcomes = await Promise.all(calls.map((c, i) => this.executeTool(c.name, c.inputs, { signal, progress: progressOf(i) })))
      clearTimeout(publishing)
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

      outcomes.forEach((outcome, i) => this.push(result(calls[i], outcome)))
      // What the calls changed (files, runs) shows in the artifacts' live views
      // now, not at the next step — only after a stage that could change them.
      const changing = calls.some((c) => {
        const tool = this.toolsMap.get(c.name)
        return tool?.effect === "write" || tool?.view === "file" || tool?.view === "terminal"
      })
      // Any artifact with a live view counts, even one not shown yet (the
      // filesystem tree before its first refresh returns null).
      if (changing && this.artifacts?.some((a) => a.live !== Artifact.prototype.live)) await this.refreshArtifacts().catch(() => {})
      const bad = outcomes.findIndex((o) => !o.ok)
      if (bad !== -1) failed = calls[bad].name
    }
    return !failed
  }

  // Execute a tool by name. Never throws — returns { ok, output }.
  async executeTool(toolName, inputs, { signal, progress } = {}) {
    try {
      // A bare MCP tool name ("search_issues" for "github.search_issues") resolves when exactly one tool ends with it:
      // small models often drop the server prefix.
      let tool = this.toolsMap.get(toolName)
      if (!tool && !toolName.includes(".")) {
        const matches = [...this.toolsMap.keys()].filter((k) => k.endsWith(`.${toolName}`))
        if (matches.length === 1) tool = this.toolsMap.get(matches[0])
      }
      if (!tool) {
        const available = [...this.toolsMap.keys()].join(", ") || "none"
        throw new Error(`Tool not found. Available: ${available}`)
      }
      if (tool.approval && !BaseEngine.autopilot) {
        // A declined call is not asked again within the same request.
        const key = `${toolName} ${JSON.stringify(inputs)}`
        if (this._declined.has(key) || !(await this._requestApproval(tool, inputs, signal))) {
          if (!signal?.aborted) this._declined.add(key)
          throw new Error(
            "The owner declined this call. Do not try it again or work around it; answer now and say it was not done."
          )
        }
      }
      // record(fields): extra fields for the call's tool message (fs.* put the
      // change they made there, so views never re-read the file afterwards).
      const extra = {}
      const record = (fields) => fields && typeof fields === "object" && Object.assign(extra, fields)
      const result = await tool.invoke(inputs, { engine: this, signal, progress: progress ?? (() => {}), record })
      return { ...extra, ok: true, output: typeof result === "string" ? result : JSON.stringify(result) }
    } catch (error) {
      return { ok: false, output: `Error executing ${toolName}: ${error.message}` }
    }
  }
}
