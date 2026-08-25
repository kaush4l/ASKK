/**
 * The application aggregate: the registry fold, the log, the injected ports,
 * and what this build can actually offer a module. The composition root builds
 * one and the seam threads it explicitly — never a global, so a test and an
 * agent's own Worker each hold their own.
 *
 * `available` is the second half of I6, and it is STATED, never defaulted. A
 * grant is the intersection of what a manifest asks for with what THIS build
 * offers, so a build assembled without a workspace substrate passes a shorter
 * list and every module that asked for `workspace` is simply not granted it
 * (I15) — no branch anywhere else. Defaulting it to every capability would
 * have answered "what does this build offer?" on behalf of adapters nobody has
 * written yet, which is how `durable()` came to return `true` while the only
 * shipping implementation returned `false`. A capability descriptor is filled
 * in honestly by the composition root or the build does not start.
 * @module
 */

import { ENTRY_AGENT } from '@harness/kernel'
import { newAgentState } from '@harness/agent'

import { Registry } from './registry.js'

/** @typedef {import('@harness/kernel').CapabilityId} CapabilityId */
/** @typedef {import('@harness/kernel').Manifest} Manifest */
/** @typedef {import('@harness/kernel').Ports} Ports */
/** @typedef {import('./registry.js').Handler} Handler */
/** @typedef {import('./log/index.js').Log} Log */
/** @typedef {import('@harness/agent').AgentState} AgentState */
/** @typedef {import('@harness/agent').Reply} Reply */
/** @typedef {import('@harness/kernel').Fact} Fact */
/** @typedef {import('@harness/kernel').Timestamp} Timestamp */
/** @typedef {import('@harness/kernel').TurnId} TurnId */
/** @typedef {import('@harness/agent').Effect} Effect */
/** @typedef {import('@harness/agent').AgentSpec} AgentSpec */
/** @typedef {import('@harness/agent').Refusal} Refusal */

/**
 * WHICH AGENT FILES THIS BUILD LOADED, and which would not load. Both halves,
 * because a file that will not parse costs that one agent and the rest still
 * load — and the roster pane exists to say which one, by name.
 *
 * `paths` is name -> the file it was read from. `AgentSpec` deliberately does
 * not carry it — a spec is what a file SAYS and not where it lives — but the
 * pane's whole job is telling a person which file to edit.
 * @typedef {{specs: AgentSpec[], refusals: Refusal[], paths: Record<string, string>}} Roster
 */

/**
 * THE ENDPOINT CATALOGUE, READABLE THROUGH THE SEAM AND NEVER THE KEY.
 * `null` is a build that shipped no catalogue reader, which `/settings` says in
 * one sentence rather than rendering an empty list that looks like a person has
 * no endpoints (I15, I16). `apply` takes effect immediately in memory and
 * persists behind the request, because a setting that needs a reload to take is
 * a setting the page lies about; `saveEndpoint` in `adapters-web` remains the
 * only door a CREDENTIAL goes through (docs/SEAM.md).
 * @typedef {{
 *   read: () => {selected: string, search: string, entries: Array<Record<string, unknown>>},
 *   apply: (patch: {entry?: string, baseUrl?: string, model?: string, search?: string}) => void,
 * }|null} SettingsFace
 */

/**
 * ONE FACT ON ITS WAY TO THE LOOP: what happened, when, and WHICH TURN it
 * belongs to (I21). A model reply carries the parts the kernel's fact cannot
 * hold — the native calls and the signal it stopped on.
 * @typedef {{at: Timestamp, turnId: TurnId|null, callId?: string, fact: Fact, reply?: Reply}} Incoming
 */

/**
 * ONE TOOL, RUN. The gate, the capability check and the built-in table are
 * `tools.js`'s and arrive with it; this is the shape they fill. A build with an
 * empty table offers no tools and says so by name when one is called — the
 * honest answer, rather than a call that quietly does nothing.
 * @typedef {(args: string, opts: {signal: AbortSignal}) => Promise<{ok: boolean, output: string}>} ToolRun
 */

/**
 * @typedef {{
 *   registry: Registry, log: Log, ports: Ports, available: CapabilityId[],
 *   agent: AgentState, me: string, tools: Record<string, ToolRun>,
 *   pending: Incoming[], bootedAt: number, quiet: Record<string, number>,
 *   errands: Set<string>, chores: Effect[], roster: Roster, settings: SettingsFace,
 * }} App
 */

/**
 * The log is PASSED IN and never defaulted, for the same reason `available` is:
 * a log built here would be one this process invented, with no store behind it
 * and no history in front of it, and every fact it recorded would evaporate on
 * refresh while the interface showed them landing. `freshLog` and `bootLog` in
 * `./log/` are the two honest ways to obtain one.
 * @param {Ports} ports
 * @param {CapabilityId[]} available what THIS build can actually offer a module
 * @param {{log: Log, me?: string, tools?: Record<string, ToolRun>, agent?: AgentState, roster?: Roster, settings?: SettingsFace}} opts
 * @returns {App}
 */
export function createApp(ports, available, opts) {
  return {
    registry: new Registry(),
    log: opts.log,
    ports,
    available,
    agent: opts.agent ?? newAgentState(),
    me: opts.me ?? ENTRY_AGENT,
    tools: opts.tools ?? {},
    pending: [],
    // WHERE THIS PAGE LOAD STARTS. The one thing that separates a file written
    // in this session from one a reload took, and the only reason `folder.js`
    // can make that claim at all.
    bootedAt: opts.log.length,
    // WHO THIS PROCESS IS WAITING ON RIGHT NOW, by agent name. A delegation in
    // flight is state the LOG cannot hold — it has produced no fact yet — and
    // the pending queue cannot either, because the message that started it was
    // taken off before the await. Without it the pane told the person their
    // page had been reloaded for the whole duration of the call.
    errands: new Set(),
    // WORK A PERSON'S PRESS PRODUCED. A terminal command and a file write have
    // no reply behind them and no turn to belong to, so they cannot ride the
    // fact queue — `step` would drop them. The driver drains this first.
    chores: [],
    roster: opts.roster ?? { specs: [], refusals: [], paths: {} },
    settings: opts.settings ?? null,
    // Consecutive silent completions, per model. A model that answers with
    // nothing twice running is not worth a third attempt, and the driver stops
    // retrying it rather than paying to learn the same thing again.
    quiet: {},
  }
}

/**
 * AN ID FROM INJECTED BYTES (I7), so a replay of a test is byte-identical.
 * Turn ids and artifact handles are both minted here because both are drawn
 * from the same port, and an id spelled twice is an id that will differ once.
 * @param {App} app @param {number} [bytes]
 */
export function mintId(app, bytes = 8) {
  return [...app.ports.rng.bytes(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Install a module and RECORD that it happened. The registry decides whether
 * the module may exist; the fact is what makes the install undoable (I10) and
 * visible to every projection of the log (I8).
 * @param {App} app
 * @param {Manifest} manifest
 * @param {Handler} handler
 * @returns {import('./registry.js').Registered}
 */
export function install(app, manifest, handler) {
  const entry = app.registry.install(manifest, handler)
  app.log.append(
    { type: 'module_installed', module: manifest.id, version: manifest.version },
    app.ports.clock.now(),
  )
  return entry
}
