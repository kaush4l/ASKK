// The desk the hosted version runs in this tab (2026-10-20 owner: "a new core along with the hosted version that
// contains the capabilities of a single agent with creates a agent tool and ability to call an LLM and use the tools,
// whatever is possible to run in the browser … the basic capability of a single long running agent"): the kernel
// (backend/kernel — plain JS, no host) with one lead, `agent`, and the kit's parts a browser can run:
//   tools      web.search (wikipedia + hn), web.read (pages that allow browser reads), agent.spawn / catalog / update /
//              dismiss (helpers, kept ones back on the next visit)
//   artifacts  practice (its checklist, quality bar and learned instructions, improved by its own retro), dispatch
//              (helpers in parallel), files (this browser's workspace: notes/, work/), plan, talk
// Its model: any OpenAI-compatible endpoint the owner names (a local server — Ollama, LM Studio, llama.cpp, vLLM — or a
// hosted one with a key: backend/browser/settings.js), called from the tab with the kernel's complete(). The terminal,
// app previews, MCP tools and other desks are the desk server's (bun run dev).
//
//   buildBrowserDesk({store, connection, fetch?, log?, infer?}) → {desk, host}

import { buildDesk, builtinKit, complete } from "../kernel/index.js"
import { browserHost } from "./host.js"

export const BROWSER_TOOLS = ["web.search", "web.read", "agent.spawn", "agent.catalog", "agent.update", "agent.dismiss"]
export const BROWSER_ARTIFACTS = ["practice", "dispatch", "files", "plan", "talk"]
const RETRO_CHARS = 20_000 // the retro log kept in the store: its newest part

export const LEAD = {
  name: "agent",
  description: "A single long-running agent in this browser: does what you ask itself or with helpers it makes and runs in parallel, keeps its notes and standing orders here, and improves its practice after every run.",
  goal: "Do what the owner asks to the quality bar — itself or with helpers — and leave the practice better after each run.",
  role: `SPEC
You are a single long-running agent in the owner's browser. You keep working across visits: your earlier runs, your practice (checklist, quality bar, learned instructions), your kept helpers and your workspace (notes/, work/) stay in this browser.
Question each run: what does the owner want done, and what is the least work that does it to the bar?
Done when: every item of agent.practice's RUN CHECKLIST is ticked with evidence or skipped with a reason, and agent.practice.reflect closed the run.

CAPABILITY — helpers instead of a fixed team
C1. A question a few reads answer: do it yourself.
C2. Work with independent angles or many reads: agent.catalog first, then agent.spawn one helper per angle {name, role (how it works, the exact shape of its output, the bar it must meet), goal, the fewest tools}; dispatch.start each brief {to, requirement (the facts it starts from), ask, outcome}, then dispatch.wait; check each report against the bar — a claim without its source goes back once, then you do it yourself.
C3. A helper whose job recurs: agent.update {name, keep: desk} — it stays in this browser for the next visit. A kept helper that missed: agent.update its role or tools with the evidence.
C4. What a browser cannot do — a terminal, the open web beyond pages that allow browser reads, other desks — say so plainly: the owner runs the desk server for it (bun run dev).

RUNBOOK
1. INTENT: the request in one line and what done means, observable.
2. WORK: yourself or with helpers (C1–C3); notes/ for what you found, work/ for what you made (files.write).
3. DELIVER: the answer — what was done, where it is, what is open; talk.say a result the owner should hear now.
4. REFLECT, last: what held, what this run missed (a checklist step, a bar, an instruction, a helper's role, a tool) → agent.practice.edit the section that missed it, with the evidence, then agent.practice.reflect.

REPORT, in the five lines: VERDICT = what was done; EVIDENCE = what proves it, each with its source; CONFIDENCE; FALSIFIER = what would show it wrong; GAPS = what is open, and what you changed in your practice.`,
  practice: {
    checklist: ["!intent: the request restated in one line with what done means, observable", "work: the work done to the quality bar (helpers' reports checked before use)", "!deliver: the answer says what was done, where it is and what is open"],
    quality: ["every claim names its source: a tool result, a link, a file path", "a missing fact reads unknown, never a guess", "a helper's brief carries the facts it starts from and the exact shape of its output"],
    instructions: ["reuse before you build: agent.catalog and your kept helpers before agent.spawn", "a browser cannot run a terminal or read every page: say so, never pretend"],
  },
}

// practice's store in the browser store: the text under practice:<agent>, retros appended under retros:<agent>.
export function storePractice(store, agent) {
  return {
    where: `this browser (practice:${agent.name})`,
    read: () => store.get(`practice:${agent.name}`, null),
    write: (text) => {
      if (!store.set(`practice:${agent.name}`, text)) throw new Error("this browser's storage refused it (full, or site data blocked)")
    },
    seed: () => null,
    retro: (entry) => {
      const all = `${store.get(`retros:${agent.name}`, "")}${entry}\n`
      if (!store.set(`retros:${agent.name}`, all.slice(-RETRO_CHARS))) throw new Error("this browser's storage refused it (full, or site data blocked)") // Practice says it
    },
    retros: () => store.get(`retros:${agent.name}`, null),
  }
}

// infer(prompt, agent, {images}) over the owner's OpenAI-compatible endpoint, from this tab.
export function browserInfer(connection, { onUsage } = {}) {
  return async (prompt, agent, { images = [] } = {}) => {
    if (!connection?.base_url || !connection?.model) throw new Error("no model set: name an OpenAI-compatible endpoint and a model (Run in this browser)")
    const t0 = Date.now()
    const { raw } = await complete({ model: { provider: "openai", base_url: connection.base_url, api_key: connection.api_key || undefined, id: connection.model, ...(connection.max_tokens ? { max_tokens: connection.max_tokens } : {}) }, prompt, images })
    onUsage?.({ agent: agent.name, model: connection.model, ms: Date.now() - t0, prompt_chars: prompt.length, reply_chars: raw.length })
    return raw
  }
}

export function buildBrowserDesk({ store, connection, fetch, log = () => {}, infer = null, clock } = {}) {
  const host = browserHost({ store, fetch })
  const kit = builtinKit({ practiceStore: (agent) => storePractice(store, agent), ...(clock ? { clock } : {}) })
  const pick = (all, names) => Object.fromEntries(names.map((n) => [n, all[n]]))
  const spec = {
    name: LEAD.name,
    team: "browser",
    description: LEAD.description,
    goal: LEAD.goal,
    role: LEAD.role,
    model: "default",
    maxSteps: 60,
    writes: ["notes/**", "work/**"],
    tools: BROWSER_TOOLS,
    artifacts: [{ type: "practice", seed: LEAD.practice }, "dispatch", "files", "plan", "talk"],
  }
  const desk = buildDesk(spec, {
    infer: infer ?? browserInfer(connection),
    context: { host, desk: "browser", memory: null, log },
    tools: pick(kit.tools, BROWSER_TOOLS),
    artifacts: pick(kit.artifacts, BROWSER_ARTIFACTS),
    models: ["default"],
  })
  return { desk, host }
}
