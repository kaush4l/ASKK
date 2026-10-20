import { Tool } from "../tool/tool.js"
import { cleanPath, inLane, mayContain } from "./files.js"

// desk.* (2026-10-20 owner: "we want to give this desk create capable tool as a default agent. Now for any kind of desk
// setup, it should be simple enough to request it and the agent figuring out the good ways of creating the desk"): an
// agent makes, checks, loads and gives work to desks, over the host's desks/* (companion/server/desks.js →
// companion/team/scaffold.js). Plain JS over ctx.host, type "desk", view "desk".
//
//   desk.list                         the hosted desks: name, what each is for, what it runs now
//   desk.create {name, spec, update?} writes custom/<name>/ from a spec (agents, practice seeds, teams, init folders),
//                                     composed before it is put in place; config only — never code
//   desk.check {name}                 does it compose: its tree and every agent's tools
//   desk.load {name}                  hosts it in the running server (or reloads it: refused while it works)
//   desk.ask {name, text, wait?}      work for a hosted desk's lead; wait: true → its answer (one whole run, polled)
//   desk.read {name, path}            a hosted desk's workspace file, or a folder's listing (read only)
//   desk.propose {name, file, code, why}  tool code the desk lacks → custom/<name>/proposed/tools/<file>.js, for the
//                                     owner to accept (moved into tools/); never loaded by an agent
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

export function deskTools() {
  return {
    "desk.list": new Tool({
      name: "desk.list",
      type: "desk",
      view: "desk",
      description: "the desks hosted in this server: name, what each is for, what it runs now",
      input: {},
      run: async (_input = {}, ctx = {}) => {
        const { desks = [] } = await need(ctx, "desk.list").get("desks")
        return desks.map((d) => `- ${d.name}: ${d.description ?? ""}${d.work?.length ? ` — running: ${d.work.map((w) => `${w.agent} (${w.step ?? w.run})`).join("; ")}` : " — idle"}`).join("\n") || "no desks hosted"
      },
    }),
    "desk.create": new Tool({
      name: "desk.create",
      type: "desk",
      view: "desk",
      description: `write a new desk custom/<name>/ from a spec — its lead (goal, role, checklist and quality bar as practice, the tools and artifacts it needs: start with one capable lead that spawns helpers; add fixed members only for a workflow that never changes), team templates, init folders — checked before it is put in place (a spec that does not compose writes nothing and says why); then desk.load it and desk.ask it. update: true rewrites a desk desk.create made (its data, memory and kept helpers stay). Spec: ${SPEC}`,
      input: { name: "the desk's folder name: lowercase-words (e.g. research-desk)", spec: "the spec object (above), or its JSON", update: "true to rewrite a desk desk.create made; optional" },
      run: async (input = {}, ctx = {}) => {
        const spec = jsonish(input.spec)
        const made = await need(ctx, "desk.create").post("desks/create", { name: String(input.name ?? "").trim(), spec, update: input.update === true || input.update === "true" })
        return [`${input.update ? "updated" : "created"} ${made.folder}/: ${made.written.join(", ")}`, "composes:", checkText(made.check), made.hosted ? `hosted already: desk.load {name: "${made.name}"} reloads it` : `next: desk.load {name: "${made.name}"}, then desk.ask it`].join("\n")
      },
    }),
    "desk.check": new Tool({
      name: "desk.check",
      type: "desk",
      view: "desk",
      description: "does a desk compose: its agents' tree and every agent's tools (nothing runs)",
      input: { name: "the desk's folder name" },
      run: async ({ name } = {}, ctx = {}) => checkText(await need(ctx, "desk.check").post("desks/check", { name: String(name ?? "").trim() })),
    }),
    "desk.load": new Tool({
      name: "desk.load",
      type: "desk",
      view: "desk",
      description: "host a desk in the running server, or reload it with its files as they are now (refused while it works)",
      input: { name: "the desk's folder name" },
      run: async ({ name } = {}, ctx = {}) => {
        const r = await need(ctx, "desk.load").post("desks/load", { name: String(name ?? "").trim() })
        return `${r.reloaded ? "reloaded" : "loaded"} ${r.name}: ${r.agents} agents`
      },
    }),
    "desk.ask": new Tool({
      name: "desk.ask",
      type: "desk",
      view: "desk",
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
    "desk.read": new Tool({
      name: "desk.read",
      type: "desk",
      view: "desk",
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
    "desk.propose": new Tool({
      name: "desk.propose",
      type: "desk",
      view: "desk",
      description: "propose tool code a desk lacks (export default defineTool({name, description, input, run}) — docs/standard.md): kept in custom/<name>/proposed/tools/<file>.js for the owner, who moves it into tools/ to accept it; tell the owner (talk.ask) what it unlocks",
      input: { name: "the desk", file: "the file's name (e.g. notes)", code: "the whole file", why: "what the desk cannot do without it" },
      run: async (input = {}, ctx = {}) => `proposed ${(await need(ctx, "desk.propose").post("desks/propose", input)).path} — not loaded until the owner moves it into tools/`,
    }),
  }
}
