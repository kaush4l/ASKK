import { Tool } from "../tool/tool.js"
import { cleanPath, inLane, mayContain } from "./files.js"
import { outsideFrom } from "./spawn.js"

// desk.* (2026-10-20 owner: "we want to give this desk create capable tool as a default agent. Now for any kind of desk
// setup, it should be simple enough to request it and the agent figuring out the good ways of creating the desk"): an
// agent makes, checks, loads and gives work to desks, over the host's desks/* (companion/server/desks.js →
// companion/team/scaffold.js). Plain JS over ctx.host, type "desk", view "desk".
//
// Tools: list, create {name, spec, update?} (writes custom/<name>/ from a spec, composed before it is put in place; config
// only — never code), check, load, ask {name, text, wait?} (one whole run, polled), read (a hosted desk's workspace, read
// only), propose {name, file, code, why} (tool code → custom/<name>/proposed/tools/<file>.js, never loaded by an agent).
//
// Provenance (2026-10-20, practice.js's and spawn.js's hold extended to desks): a desk's agents' roles, practice seeds
// and main.js are prompts at every start of it — a lasting prompt injection when a run that read outside wrote them
// (ctx.outside, tool.js readsOutside: web.*, browse, desk.read / desk.ask, MCP tools). So from such a run desk.create
// sends `outside` (outsideFrom: "web.read, scout: browse.open") and the host writes nothing in place: the spec is
// checked (it composes) and kept as a proposal (companion/team/scaffold.js, custom/.proposed/<name>.json) until the
// owner's Accept on the home page writes it (re-checked then) and loads it; desk.load refuses a desk that is only a
// proposal. desk.propose's code never loads anyway; from such a run its file says where its words came from, for the
// owner who reads it before accepting it. The words held never reach a prompt: the answer names the hold, not the text.
const ASK_MINUTES = 30
const ASK_POLL_MS = 5000
const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener?.("abort", () => (clearTimeout(t), reject(signal.reason ?? new Error("stopped"))), { once: true })
  })
const need = (ctx, tool) => {
  if (!ctx?.host?.post) throw new Error(`${tool}: no host here (desks are written by the desk server)`)
  return ctx.host
}
const jsonish = (v) => {
  if (typeof v !== "string") return v
  try {
    return JSON.parse(v)
  } catch {
    throw new Error("spec: a JSON object {title, description, lead: {…}} — it did not parse as JSON")
  }
}
const treeLines = (node, depth = 0) => [`${"  ".repeat(depth)}- ${node.name}${node.model ? ` (${node.model})` : ""}: ${node.description ?? ""}`.slice(0, 220), ...(node.agents ?? []).flatMap((c) => treeLines(c, depth + 1))]
const checkText = (check) =>
  [
    ...treeLines(check.tree),
    ...Object.entries(check.tools ?? {}).map(([agent, tools]) => `${agent} holds: ${tools.join(", ")}`.slice(0, 600)),
    ...(Object.keys(check.templates ?? {}).length ? [`templates: ${Object.keys(check.templates).join(", ")}`] : []),
  ].join("\n")

const SPEC = `{title, description, request (the owner's words), model? (opus | sonnet | haiku), max_steps?, folders? (workspace folders init makes),
 lead: AGENT, teams?: [AGENT (a template the lead staffs with agent.spawn {template})]}
AGENT: {name, description (one line), role (what it is for and how it works: SPEC + RUNBOOK), goal?, model?, max_steps?, writes? (globs), reads?,
 tools: [names: web.search, web.read, agent.spawn, agent.dismiss, agent.catalog, agent.update, desk.* …],
 artifacts: [practice, plan, dispatch, files, terminal, browse, preview, talk, report, or {type, id?, commands?, gate?}],
 practice: {checklist: ["!id: what done means, observable"], quality: ["the bar"], instructions: ["how"]}, members?: [AGENT]}`

const tool = (name, spec) => [name, new Tool({ name, type: "desk", view: "desk", ...spec })]

export function deskTools() {
  return Object.fromEntries([
    tool("desk.list", {
      description: "the desks hosted in this server: name, what each is for, what it runs now",
      input: {},
      run: async (_input = {}, ctx = {}) => {
        const { desks = [] } = await need(ctx, "desk.list").get("desks")
        return desks.map((d) => `- ${d.name}: ${d.description ?? ""}${d.work?.length ? ` — running: ${d.work.map((w) => `${w.agent} (${w.step ?? w.run})`).join("; ")}` : " — idle"}`).join("\n") || "no desks hosted"
      },
    }),
    tool("desk.create", {
      description: `write a new desk custom/<name>/ from a spec — its lead (goal, role, checklist and quality bar as practice, the tools and artifacts it needs: start with one capable lead that spawns helpers; add fixed members only for a workflow that never changes), team templates, init folders — checked before it is put in place (a spec that does not compose writes nothing and says why); then desk.load it and desk.ask it. From a run that read outside (the web, another desk, an MCP tool) it is checked but held for the owner's accept, not written. Spec: ${SPEC}`,
      input: { name: "the desk's folder name: lowercase-words (e.g. research-desk)", spec: "the spec object (above), or its JSON", update: "true to rewrite a desk desk.create made (its data, memory and kept helpers stay); optional" },
      run: async (input = {}, ctx = {}) => {
        const spec = jsonish(input.spec)
        const update = input.update === true || input.update === "true"
        const from = outsideFrom(ctx)
        const made = await need(ctx, "desk.create").post("desks/create", { name: String(input.name ?? "").trim(), spec, update, ...(from ? { outside: from } : {}) })
        if (made.held)
          return [
            `held for the owner — ${update ? `the update of ${made.folder}/` : `${made.folder}/`} composes but is NOT written: this run read outside (${made.held.from}), so the desk (its roles, practice, main.js: prompts at every start) waits for the owner's Accept on the home page; ${update ? "it runs as it was until then" : "desk.load refuses it until then"}`,
            "composes:",
            checkText(made.check),
            "next: tell the owner (talk.say, or your answer) what the desk is for and that it waits for their accept; go on without it",
          ].join("\n")
        return [`${update ? "updated" : "created"} ${made.folder}/: ${made.written.join(", ")}`, "composes:", checkText(made.check), made.hosted ? `hosted already: desk.load {name: "${made.name}"} reloads it` : `next: desk.load {name: "${made.name}"}, then desk.ask it`].join("\n")
      },
    }),
    tool("desk.check", {
      description: "does a desk compose: its agents' tree and every agent's tools (nothing runs)",
      input: { name: "the desk's folder name" },
      run: async ({ name } = {}, ctx = {}) => checkText(await need(ctx, "desk.check").post("desks/check", { name: String(name ?? "").trim() })),
    }),
    tool("desk.load", {
      description: "host a desk in the running server, or reload it with its files as they are now (refused while it works)",
      input: { name: "the desk's folder name" },
      run: async ({ name } = {}, ctx = {}) => {
        const r = await need(ctx, "desk.load").post("desks/load", { name: String(name ?? "").trim() })
        return `${r.reloaded ? "reloaded" : "loaded"} ${r.name}: ${r.agents} agents${r.proposed ? ` — as it is on disk; an update proposed by ${r.proposed.by} waits for the owner (not in force)` : ""}`
      },
    }),
    tool("desk.ask", {
      description: "give a hosted desk work for its lead (or one of its agents): wait: true returns its answer when its run ends (minutes; polled, never timed out short of max_minutes); without, it is queued and you go on",
      input: { name: "the desk", text: "the work, as the owner would say it: what, why, what done means", agent: "one of its agents; optional (its lead)", wait: "true to wait for the answer; optional", max_minutes: `how long to wait, default ${ASK_MINUTES}; optional` },
      run: async ({ name, text, agent, wait, max_minutes } = {}, ctx = {}) => {
        const host = need(ctx, "desk.ask")
        const desk = String(name ?? "").trim()
        const waited = wait === true || wait === "true"
        const r = await host.post("desks/ask", { name: desk, text, agent: agent || null, wait: waited }, { signal: ctx.signal })
        if (r?.ok === false) throw new Error(r.error?.message ?? r.error ?? "the desk refused the work")
        if (!waited) {
          const v = r?.value ?? r
          return v?.queued ? `queued for ${v.agent} on ${desk}` : JSON.stringify(v)
        }
        // Waited: the run's id, polled until it ends (2026-10-20: one request held for a whole run timed out).
        const until = Date.now() + Math.min(Math.max(Number(max_minutes) || ASK_MINUTES, 1), 120) * 60_000
        while (Date.now() < until) {
          await sleep(ASK_POLL_MS, ctx.signal)
          const run = await host.get(`desks/ask?id=${encodeURIComponent(r.id)}`, { signal: ctx.signal })
          if (run.status === "done") return typeof run.answer === "string" ? run.answer : JSON.stringify(run.answer)
          if (run.status === "failed") throw new Error(`${desk}: ${run.error}`)
        }
        return `${desk} is still working (ask ${r.id}): desk.list shows it; desk.read its workspace for what it wrote so far`
      },
    }),
    tool("desk.read", {
      description: "read a file in a hosted desk's workspace (what it wrote: a report, a preview), or list a folder of it — read only",
      input: { name: "the desk", path: "a path in its workspace (data/), e.g. reports/summary.md or reports/" },
      run: async ({ name, path } = {}, ctx = {}) => {
        const desk = String(name ?? "").trim()
        const at = cleanPath(path)
        // A reader with a reads: lane reads another desk only where its lane names it: desks/<name>/… (the same paths
        // a desk's mounts give: host-api workspaceMounts).
        const reads = ctx.agent?.config?.reads
        const there = `desks/${desk}${at ? `/${at}` : ""}`
        if (reads?.length && !inLane(reads, there) && !mayContain(reads, there)) throw new Error(`${ctx.agent.name} reads only ${[reads].flat().join(", ")} (its reads:) — ${there} is outside its lane`)
        const r = await need(ctx, "desk.read").post("desks/read", { name: desk, path: at })
        if (Array.isArray(r?.entries)) return [`${name}: ${r.path || "."}/`, ...r.entries.map((e) => `- ${e.name}${e.type === "dir" ? "/" : ""}`)].join("\n")
        return `${name}: ${r.path}${r.truncated ? " (cut)" : ""}\n${r.text ?? ""}`
      },
    }),
    tool("desk.propose", {
      description: "propose tool code a desk lacks (export default defineTool({name, description, input, run}) — docs/standard.md): kept in custom/<name>/proposed/tools/<file>.js for the owner, who moves it into tools/ to accept it; tell the owner (talk.ask) what it unlocks",
      input: { name: "the desk", file: "the file's name (e.g. notes)", code: "the whole file", why: "what the desk cannot do without it" },
      run: async (input = {}, ctx = {}) => {
        const from = outsideFrom(ctx)
        const r = await need(ctx, "desk.propose").post("desks/propose", { name: input.name, file: input.file, code: input.code, why: input.why, ...(from ? { outside: from } : {}) })
        return `proposed ${r.path} — not loaded until the owner accepts it (the home page's proposals, or moved into tools/)${r.from ? `; marked: from a run that read outside (${r.from}) — the owner reads every line before accepting it` : ""}`
      },
    }),
  ])
}
