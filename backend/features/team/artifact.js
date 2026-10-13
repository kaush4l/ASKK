// The team artifact (`team`): the sub-agents this agent created, live —
// who, kept or task, working or idle (and for how long), their tools — plus
// the ones ended lately, re-read before every step. Its commands create and
// end them (backend/runtime/spawner.js does the work, through the engine's
// directory):
//
//   agent.spawn {name, role, goal, tools?, mcp?, artifacts?, keep?, idle_minutes?, max_steps?, writes?, checklist?, shared?}
//               a new agent (its own engine) with that role, handed `goal` as
//               a quest at once; its report wakes the caller
//   agent.spawn {toolkit, focus, goal?, name?, …}
//               a research helper whose tools follow its task: one of the
//               caller's agent.md `toolkits` (tools, mcp, role, once, max_steps);
//               `focus` = what it researches (its first quest when no goal);
//               explicit tools/mcp/… still override the kit
//   agent.task  {name, quest}       another quest for a live sub-agent
//   agent.keep  {name, keep?}       keep it (saved, restarted with the team) or
//                                   make it a task agent again
//   agent.kill  {name, reason?}     end it: its open quests come back as called
//                                   back, its engine closes
//
// The caller decides each sub-agent's fate when its report is in: done → kill;
// more of the same work → agent.task; a role the team needs from now on → keep.
// Task agents idle past their limit are ended for it. agent.md: `artifacts:
// [team]`, optional `spawn_max` (6), `spawn_idle_minutes` (30) and `toolkits`
// (rendered here, so the model sees which kits it can hand out).

import { Artifact } from "@/backend/core/artifact"
import { Tool } from "@/backend/core/tool"
import { LIMITS } from "@/lib/config"

const name = { type: "string", minLength: 2, maxLength: LIMITS.spawnTools.nameChars, pattern: "^[a-z][a-z0-9-]{1,39}$" }
const kitName = { type: "string", minLength: 1, maxLength: LIMITS.spawnTools.itemChars, pattern: "^[A-Za-z][A-Za-z0-9._-]*$" }

// One line per toolkit in agent.md `toolkits` — what a helper of that kind gets.
export function toolkitLines(toolkits) {
  return Object.entries(toolkits ?? {}).map(([kit, spec]) => {
    const gives = [...(spec.tools ?? []), ...(spec.mcp ?? [])]
    const extras = [spec.once ? "once" : null, spec.max_steps ? `max_steps ${spec.max_steps}` : null].filter(Boolean)
    const about = String(spec.description ?? spec.role ?? "").trim().split(/(?<=[.!?])\s/)[0]
    return `- ${kit}: ${gives.join(", ") || "no tools"}${extras.length ? ` · ${extras.join(" · ")}` : ""}${about ? ` — ${about.slice(0, 160)}` : ""}`
  })
}
const names = { type: "array", items: { type: "string", minLength: 1, maxLength: LIMITS.spawnTools.itemChars }, maxItems: LIMITS.spawnTools.maxItems }

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
    const { alive = [], ended = [], max = LIMITS.team.spawnMax } = this.#roster ?? {}
    lines.push(
      `Agents you created (agent.spawn), live, re-read before every step — ${alive.length} of at most ${max}. ` +
        "When a report is in, decide each one's fate: done → agent.kill; more of its kind of work → agent.task; " +
        "a role the team needs from now on → agent.keep. Task agents idle past their limit are ended for you.",
      ""
    )
    const kits = toolkitLines(this.engine.agent?.toolkits)
    if (kits.length) {
      lines.push(
        "Your toolkits — a research helper's tools follow its task: agent.spawn {\"toolkit\": \"<kit>\", \"focus\": \"<what to research, e.g. one file or topic + the question>\"} " +
          "(name optional; goal defaults to the focus; tools/mcp you pass override the kit):",
        ...kits,
        ""
      )
    }
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
          "`keep: true` = a lasting team member (saved, restarted with the team); `once: true` = a one-shot helper, ended " +
          "as soon as its report is in (one per topic: research, report, gone); default = a task agent, ended when you " +
          "agent.kill it or after `idle_minutes` idle. Several at once: parallel[agent.spawn(…), agent.spawn(…)]. " +
          "`writes`: its file lane (globs, within yours) — give parallel helpers disjoint lanes so they never edit the same " +
          "file; `checklist`: \"id: done means\" lines its report cannot skip; `shared`: the shared/ files its SHARED " +
          "shows (globs, default yours). Task-based helper: `toolkit` (one of your toolkits, listed in YOUR SUB-AGENTS) + " +
          "`focus` (what it researches) — its tools, role, once and max_steps come from the kit; name, role and goal " +
          "are then optional (goal = the focus).",
        inputs: {
          type: "object",
          properties: {
            name,
            role: { type: "string", minLength: LIMITS.spawnTools.roleMinChars, maxLength: LIMITS.spawnTools.roleChars },
            goal: { type: "string", minLength: 1, maxLength: LIMITS.spawnTools.goalChars },
            toolkit: kitName,
            focus: { type: "string", minLength: 1, maxLength: LIMITS.spawnTools.goalChars },
            description: { type: "string", maxLength: LIMITS.spawnTools.descriptionChars },
            tools: names,
            mcp: names,
            artifacts: names,
            keep: { type: "boolean" },
            once: { type: "boolean" },
            idle_minutes: { type: "integer", minimum: 1, maximum: LIMITS.spawnTools.maxIdleMinutes },
            max_steps: { type: "integer", minimum: 1, maximum: LIMITS.spawnTools.maxSteps },
            writes: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, maxItems: LIMITS.spawnTools.maxWrites },
            checklist: { type: "array", items: { type: "string", minLength: 3 }, maxItems: LIMITS.spawnTools.maxChecklist },
            shared: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, maxItems: LIMITS.spawnTools.maxWrites },
          },
          additionalProperties: false,
        },
        describe: ({ name: n, goal, focus, toolkit }) => {
          const what = String(goal ?? focus ?? "")
          return `Create sub-agent ${n ?? `(${toolkit ?? "helper"})`} for: ${what.length > LIMITS.spawnTools.describeChars ? `${what.slice(0, LIMITS.spawnTools.describeChars)}…` : what}`
        },
        run: async ({ goal, ...spec }) => {
          goal = String(goal ?? spec.focus ?? "").trim()
          if (!spec.toolkit && (!spec.name || !spec.role)) throw new Error("agent.spawn needs name, role and goal — or a toolkit and a focus.")
          if (!goal) throw new Error("agent.spawn needs a goal (or a focus for a toolkit helper).")
          const made = await this.#directory().spawn(spec)
          let sent
          try {
            sent = await engine.dispatchQuest(made.name, goal)
          } catch (error) {
            await this.#directory().kill(made.name, `its first quest failed: ${error.message}`).catch(() => {})
            throw error
          }
          await refresh()
          return `Created ${made.name} (${made.toolkit ? `toolkit ${made.toolkit}; ` : ""}${made.keep ? "kept" : made.once ? "one-shot: ended when its report is in" : `task agent, ended after ${made.idle_minutes} min idle`}; tools: ${made.tools.join(", ") || "none"}). ${sent}`
        },
      }),
      new Tool({
        name: "agent.task",
        view: "quest",
        description: "Hand one of your live sub-agents another quest (it keeps what it learned on earlier ones). You stop after this response; its report wakes you.",
        inputs: {
          type: "object",
          properties: { name, quest: { type: "string", minLength: 1, maxLength: LIMITS.spawnTools.questChars } },
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
          properties: { name, reason: { type: "string", maxLength: LIMITS.spawnTools.reasonChars } },
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
