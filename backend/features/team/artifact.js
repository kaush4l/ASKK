// The team artifact (`team`): the sub-agents this agent created, live —
// who, kept or task, working or idle (and for how long), their tools — plus
// the ones ended lately, re-read before every step. Its commands create and
// end them (backend/runtime/spawner.js does the work, through the engine's
// directory):
//
//   agent.spawn {name, role, goal, tools?, mcp?, artifacts?, keep?, idle_minutes?, max_steps?, writes?, checklist?}
//               a new agent (its own engine) with that role, handed `goal` as
//               a quest at once; its report wakes the caller
//   agent.task  {name, quest}       another quest for a live sub-agent
//   agent.keep  {name, keep?}       keep it (saved, restarted with the team) or
//                                   make it a task agent again
//   agent.kill  {name, reason?}     end it: its open quests come back as called
//                                   back, its engine closes
//
// The caller decides each sub-agent's fate when its report is in: done → kill;
// more of the same work → agent.task; a role the team needs from now on → keep.
// Task agents idle past their limit are ended for it. agent.md: `artifacts:
// [team]`, optional `spawn_max` (6) and `spawn_idle_minutes` (30).

import { Artifact } from "@/backend/core/artifact"
import { Tool } from "@/backend/core/tool"

const name = { type: "string", minLength: 2, maxLength: 40, pattern: "^[a-z][a-z0-9-]{1,39}$" }
const names = { type: "array", items: { type: "string", minLength: 1, maxLength: 80 }, maxItems: 40 }

const ago = (iso) => {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000))
  return minutes < 60 ? `${minutes} min ago` : `${(minutes / 60).toFixed(1)} h ago`
}

export class TeamArtifact extends Artifact {
  static type = "team"
  static title = "YOUR SUB-AGENTS"

  #roster = null
  #error = null

  #directory() {
    const directory = this.engine.directory
    if (!directory?.spawn) throw new Error("Sub-agents cannot be created here (no team host).")
    return directory
  }

  async refresh() {
    try {
      this.#roster = await this.#directory().roster()
      this.#error = null
    } catch (error) {
      this.#error = error.message
    }
  }

  render() {
    const lines = [`## ${TeamArtifact.title}`, ""]
    if (this.#error) return [...lines, `Not available: ${this.#error}`].join("\n")
    const { alive = [], ended = [], max = 6 } = this.#roster ?? {}
    lines.push(
      `Agents you created (agent.spawn), live, re-read before every step — ${alive.length} of at most ${max}. ` +
        "When a report is in, decide each one's fate: done → agent.kill; more of its kind of work → agent.task; " +
        "a role the team needs from now on → agent.keep. Task agents idle past their limit are ended for you.",
      ""
    )
    if (!alive.length) lines.push("(none alive)")
    for (const a of alive) {
      const state = a.waitingApproval
        ? "WAITING FOR THE OWNER'S APPROVAL"
        : a.busy
          ? `WORKING (${a.phase})`
          : a.status === "error"
            ? `ERROR: ${a.error}`
            : `idle ${a.idleMinutes ?? 0} min${a.idleLimit ? ` (ends at ${a.idleLimit} min idle)` : ""}`
      lines.push(`- ${a.name} · ${a.keep ? "KEPT" : "task"} · ${state} · spawned ${ago(a.spawnedAt)} · tools: ${a.tools.join(", ") || "none"}`, `  ${a.description}`)
    }
    if (ended.length) {
      lines.push("", "Ended lately:")
      for (const e of ended) lines.push(`- ${e.name} · ${ago(e.at)} · ${e.reason}`)
    }
    return lines.join("\n")
  }

  live() {
    const { alive = [], ended = [] } = this.#roster ?? {}
    return {
      view: "list",
      data: {
        items: [
          ...alive.map((a) => ({ name: a.name, detail: { keep: a.keep, busy: a.busy, phase: a.phase, idle: a.idleMinutes, tools: a.tools } })),
          ...ended.map((e) => ({ name: `${e.name} (ended)`, detail: { at: e.at, reason: e.reason } })),
        ],
      },
    }
  }

  commands() {
    const engine = this.engine
    const refresh = async () => {
      await this.refresh()
      this.onChange()
    }
    return [
      new Tool({
        name: "agent.spawn",
        view: "quest",
        description:
          "Create a sub-agent (its own engine and context) and hand it `goal` as a quest at once; like other quests, you " +
          "stop after this response and its report wakes you. `role` is its whole job description: who it is, how it " +
          "works, what its report must contain. `tools`/`mcp`/`artifacts`: a subset of yours (default: all of yours). " +
          "`keep: true` = a lasting team member (saved, restarted with the team); default = a task agent, ended when you " +
          "agent.kill it or after `idle_minutes` idle. Several at once: parallel[agent.spawn(…), agent.spawn(…)]. " +
          "`writes`: its file lane (globs, within yours) — give parallel helpers disjoint lanes so they never edit the same " +
          "file; `checklist`: \"id: done means\" lines its report cannot skip.",
        inputs: {
          type: "object",
          properties: {
            name,
            role: { type: "string", minLength: 20, maxLength: 8000 },
            goal: { type: "string", minLength: 1, maxLength: 8000 },
            description: { type: "string", maxLength: 300 },
            tools: names,
            mcp: names,
            artifacts: names,
            keep: { type: "boolean" },
            idle_minutes: { type: "integer", minimum: 1, maximum: 1440 },
            max_steps: { type: "integer", minimum: 1, maximum: 200 },
            writes: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, maxItems: 20 },
            checklist: { type: "array", items: { type: "string", minLength: 3 }, maxItems: 12 },
          },
          required: ["name", "role", "goal"],
          additionalProperties: false,
        },
        describe: ({ name: n, goal }) => `Create sub-agent ${n} for: ${goal.length > 120 ? `${goal.slice(0, 120)}…` : goal}`,
        run: async ({ goal, ...spec }) => {
          const made = await this.#directory().spawn(spec)
          let sent
          try {
            sent = await engine.dispatchQuest(made.name, goal.trim())
          } catch (error) {
            await this.#directory().kill(made.name, `its first quest failed: ${error.message}`).catch(() => {})
            throw error
          }
          await refresh()
          return `Created ${made.name} (${made.keep ? "kept" : `task agent, ended after ${made.idle_minutes} min idle`}; tools: ${made.tools.join(", ") || "none"}). ${sent}`
        },
      }),
      new Tool({
        name: "agent.task",
        view: "quest",
        description: "Hand one of your live sub-agents another quest (it keeps what it learned on earlier ones). You stop after this response; its report wakes you.",
        inputs: {
          type: "object",
          properties: { name, quest: { type: "string", minLength: 1, maxLength: 8000 } },
          required: ["name", "quest"],
          additionalProperties: false,
        },
        run: async ({ name: n, quest }) => {
          const { alive = [] } = await this.#directory().roster()
          if (!alive.some((a) => a.name === n)) throw new Error(`${n} is not one of your live sub-agents. Live: ${alive.map((a) => a.name).join(", ") || "none"}.`)
          return engine.dispatchQuest(n, quest.trim())
        },
      }),
      new Tool({
        name: "agent.keep",
        view: "quest",
        description: "Keep a sub-agent on the team (saved, restarted with the team, never ended for idling) — or `keep: false` to make it a task agent again.",
        inputs: {
          type: "object",
          properties: { name, keep: { type: "boolean" } },
          required: ["name"],
          additionalProperties: false,
        },
        run: async ({ name: n, keep = true }) => {
          await this.#directory().keep(n, keep)
          await refresh()
          return keep ? `${n} is kept on the team.` : `${n} is a task agent again (ended when idle).`
        },
      }),
      new Tool({
        name: "agent.kill",
        view: "quest",
        description: "End a sub-agent whose work is done (or that is stuck): an open quest to it comes back as called back, then its engine closes.",
        inputs: {
          type: "object",
          properties: { name, reason: { type: "string", maxLength: 500 } },
          required: ["name"],
          additionalProperties: false,
        },
        run: async ({ name: n, reason = "" }) => {
          const recalled = engine.recallQuestsTo(n, reason || "ended")
          await this.#directory().kill(n, reason)
          await refresh()
          return `${n} ended${recalled ? ` (${recalled} open quest${recalled > 1 ? "s" : ""} called back)` : ""}.`
        },
      }),
    ]
  }
}
