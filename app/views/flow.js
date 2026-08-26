/**
 * Flow — watching a run happen: the declared phase graph, and the blackboard.
 *
 * The graph is drawn from `core/flows.js`, never from a picture typed here: a
 * third flow is an entry in `FLOWS` (the whole point of R2) and a hardcoded
 * diagram would be a lie the moment someone adds one. Layout is computed —
 * longest-path layering over the forward edges, with the cycle-closing edges in
 * a return lane, so `verify --retry--> plan` reads as going back. `FLOWS` is
 * the one core import in `app/`: it is declared data, and re-typing the edge
 * table here would be computing it. The session rides on `phase:enter`, replayed
 * on mount because a turn can only be started from Converse and the ordinary way
 * here is after one; with none, this says so rather than draw a plan that is not.
 */
import "./flow.css";
import { FLOWS } from "../../core/flows.js";
/** Diagram coordinates in a unitless viewBox — not CSS sizes, and each a
 * multiple of the 4px base so the picture sits on the page's own scale. */
const W = 128, H = 32, GX = 24, GY = 48, LANE = 40, PAD = 8;
const END = "END", NS = "http://www.w3.org/2000/svg";
/** @type {{ flow: string, phase: string, visited: Set<string>, taken: { from: string, to: string } | null, session: any, maxRounds: number, turns: number, calls: Map<string, number>, note: string, tone: string }} */
const st = { flow: "full", phase: "", visited: new Set(), taken: null, session: null, maxRounds: 0, turns: 0, calls: new Map(), note: "", tone: "" };
let note = /** @type {HTMLElement | null} */ (null), body = /** @type {HTMLElement | null} */ (null);
/** @type {(() => void) | null} */ let off = null;
/** @param {string} tag @param {Record<string, string | number>} [attrs] @param {(Node | string)[]} [kids] @param {string} [ns] @returns {any} */
function node(tag, attrs = {}, kids = [], ns = "") {
  const made = ns ? document.createElementNS(ns, tag) : document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) made.setAttribute(name, String(value));
  made.append(...kids); return made;
}
/** @type {(t: string, a?: Record<string, string | number>, k?: (Node | string)[]) => HTMLElement} */
const el = (t, a, k) => node(t, a, k);
/** @type {(t: string, a?: Record<string, string | number>, k?: (Node | string)[]) => SVGElement} */
const sv = (t, a, k) => node(t, a, k, NS);
/** Anything the model wrote or read is mono (DESIGN §5). @type {(t: string) => HTMLElement} */
const mono = (t) => el("code", {}, [t]);
/** @type {(text: string, tone: string) => HTMLElement} */
const badge = (text, tone) => el("span", { class: "badge", "data-tone": tone }, [text]);
/** One table, or one honest sentence about why there is no table.
 * @param {string} title @param {string[]} cols @param {(Node|string)[][]} rows @param {string} empty @param {boolean} [bytes] is `empty` model-facing @returns {HTMLElement} */
function panel(title, cols, rows, empty, bytes = false) {
  const filled = () => el("table", {}, [el("thead", {}, [el("tr", {}, cols.map((c) => el("th", { scope: "col" }, [c])))]), el("tbody", {}, rows.map((r) => el("tr", {}, r.map((cell, i) => el("td", { class: `c${i}` }, [cell])))))]);
  return el("section", { class: "panel" }, [el("h2", {}, [title]), rows.length ? filled() : el(bytes ? "pre" : "p", { class: "empty" }, [empty])]);
}
/** The edges that close a cycle, as `"from to"` keys, from a depth-first walk of
 * the entry. It has to be the walk and not plain reachability: inside a loop
 * every phase reaches every other, so `plan --done--> work` would come back
 * "backwards" too. An edge is back only if it returns to a phase still open.
 * @param {any} flow @param {string} [name] @param {Set<string>} [seen] @param {Set<string>} [open] @param {Set<string>} [back] @returns {Set<string>} */
function backEdges(flow, name = flow.entry, seen = new Set(), open = new Set(), back = new Set()) {
  seen.add(name), open.add(name);
  for (const to of Object.values(flow.edges[name] ?? {})) {
    if (typeof to !== "string") continue;
    if (open.has(to)) back.add(`${name} ${to}`);
    else if (!seen.has(to)) backEdges(flow, to, seen, open, back);
  }
  return open.delete(name), back;
}
/** The declared edges, one per (from, target), outcomes joined — two outcomes
 * can lead to one phase and only the table knows that. @param {any} flow */
function links(flow) {
  const backs = backEdges(flow);
  const out = /** @type {Map<string, { from: string, to: string, labels: string[], back: boolean }>} */ (new Map());
  for (const [from, table] of Object.entries(flow.edges)) {
    for (const [outcome, to] of Object.entries(table ?? {})) { const target = to === null ? END : String(to), key = `${from} ${target}`;
      const link = out.get(key) ?? { from, to: target, labels: [], back: backs.has(`${from} ${to}`) };
      link.labels.push(outcome), out.set(key, link);
    }
  }
  return [...out.values()];
}
/** @param {any} flow */
function layout(flow) {
  const edges = links(flow);
  const names = Object.keys(flow.edges);
  const level = /** @type {Map<string, number>} */ (new Map(names.map((n) => [n, 0])));
  for (let pass = 0; pass < names.length; pass++) for (const link of edges) if (!link.back) level.set(link.to, Math.max(level.get(link.to) ?? 0, (level.get(link.from) ?? 0) + 1));
  const rows = /** @type {Map<number, string[]>} */ (new Map());
  for (const name of names) rows.set(level.get(name) ?? 0, [...(rows.get(level.get(name) ?? 0) ?? []), name]);
  const w = Math.max(...[...rows.values()].map((r) => r.length)) * (W + GX) + LANE * 2;
  const at = /** @type {Map<string, { x: number, y: number }>} */ (new Map());
  for (const [depth, row] of rows) row.forEach((name, i) => at.set(name, { x: w / 2 + (i - (row.length - 1) / 2) * (W + GX), y: PAD + depth * (H + GY) + H / 2 }));
  return { at, links: edges, w, h: PAD * 2 + rows.size * (H + GY) };
}
/** Edges first, phases painted over them. @param {ReturnType<typeof layout>} plan @returns {SVGElement[]} */
function shapes(plan) {
  const drawn = /** @type {SVGElement[]} */ ([]);
  for (const link of plan.links) {
    const a = plan.at.get(link.from);
    if (!a) continue;
    // A declared terminal has no box to point at, so the edge is a stub.
    const b = plan.at.get(link.to) ?? { x: a.x, y: a.y + H + PAD * 3 };
    const label = plan.at.has(link.to) ? link.labels.join(" / ") : `${link.labels.join(" / ")} → ${END}`;
    const live = st.taken?.from === link.from && st.taken?.to === link.to ? "yes" : "no";
    const bow = b.y - a.y > H + GY ? W : 0; // an edge over a level bows around the phase it skips
    const d = link.back
      ? `M ${a.x - W / 2} ${a.y} C ${LANE} ${a.y}, ${LANE} ${b.y}, ${b.x - W / 2} ${b.y}`
      : `M ${a.x} ${a.y + H / 2} C ${a.x + bow} ${a.y + H / 2 + GY}, ${b.x + bow} ${b.y - H / 2 - GY}, ${b.x} ${b.y - H / 2}`;
    drawn.push(sv("path", { class: "edge", d, "data-live": live, "marker-end": "url(#flow-arrow)" }),
      sv("text", { class: "edge-label", "data-live": live, x: (link.back ? 0 : (a.x + b.x) / 2 + bow * 0.75) + PAD, y: (a.y + b.y) / 2, "text-anchor": "start" }, [label]));
  }
  for (const [name, p] of plan.at) drawn.push(sv("g", { class: "phase", "data-state": name === st.phase ? "live" : st.visited.has(name) ? "visited" : "idle" }, [
    sv("rect", { x: p.x - W / 2, y: p.y - H / 2, width: W, height: H }),
    sv("text", { x: p.x, y: p.y, "text-anchor": "middle", "dominant-baseline": "central" }, [name])]));
  return drawn;
}
/** What the picture says, in words, for a reader who is not looking at it. @returns {string} */
function describe() {
  const count = Object.keys((FLOWS[st.flow] ?? FLOWS.full).edges).length;
  return `${count} declared phase${count === 1 ? "" : "s"}. ${st.phase ? `Live phase: ${st.phase}.` : "No phase has run yet."}${st.taken ? ` Arrived from ${st.taken.from}.` : ""}`;
}
/** @returns {HTMLElement} */
function graphPanel() {
  const plan = layout(FLOWS[st.flow] ?? FLOWS.full);
  const arrow = sv("marker", { id: "flow-arrow", viewBox: "0 0 8 8", refX: 7, refY: 4, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse", class: "arrow" }, [sv("path", { d: "M 0 0 L 8 4 L 0 8 z" })]);
  const svg = sv("svg", { class: "graph", viewBox: `0 0 ${plan.w} ${plan.h}`, width: plan.w, height: plan.h, role: "img", "aria-label": describe() }, [sv("defs", {}, [arrow]), ...shapes(plan)]);
  return el("section", { class: "panel" }, [el("h2", {}, [`Phase graph — flow: ${st.flow}`]), el("p", { class: "empty" }, [describe()]), svg]);
}
/** @param {boolean} only is the whole flow one phase @returns {HTMLElement[]} */
function reactPanels(only) {
  const rows = [...st.calls].sort((a, b) => b[1] - a[1]).map(([call, n]) => [String(n), mono(call)]);
  const said = only ? "This agent runs the react flow: one phase, one terminal edge. There is no graph to draw — the shape is think, act, observe, until the model answers, and the repeat guard is the only brake on it."
    : "The live phase runs the react loop inside itself: think, act, observe, until the model answers.";
  return [panel("The react loop", [], [], `${said} Turns so far: ${st.turns}.`), panel("Repeat guard — one row per distinct call", ["seen", "call"], rows, "No tool result has come back yet.")];
}
/** The blackboard: every value written by a phase, none of it computed here. @param {any} s @returns {HTMLElement[]} */
function blackboard(s) {
  if (!s) return [panel("Blackboard", [], [], "No phase has reported a session yet, and nothing here is inferred, so until one does there is nothing to show.")];
  return [
    panel("Session", ["field", "value"], [["query", mono(s.query || "—")], ["enhanced", mono(s.enhanced || "—")],
      ["complexity", badge(String(s.complexity), s.complexity === "complex" ? "warn" : "ok")],
      ["round", `${s.round} of ${st.maxRounds || "unreported"}`], ["skills", (s.skills ?? []).map((/** @type {any} */ k) => String(k?.name ?? k)).join(", ") || "none selected"]], ""),
    panel("Plan", ["#", "status", "step", "notes"], (s.plan ?? []).map((/** @type {any} */ p, /** @type {number} */ i) => [String(i + 1), badge(String(p.status), p.status === "done" ? "ok" : "idle"), String(p.description), String(p.notes ?? "")]), "No plan yet — the plan phase has not written one."),
    panel("Step results", ["ok", "step", "outcome"], (s.stepResults ?? []).map((/** @type {any} */ r) => [badge(r.ok ? "ok" : "failed", r.ok ? "ok" : "fail"), String(r.step), mono(String(r.outcome))]), "No step has reported a result yet."),
    panel("Critiques", ["severity", "state", "finding"], (s.critiques ?? []).map((/** @type {any} */ c) => [badge(String(c.severity), c.severity === "blocking" ? "fail" : "warn"), badge(c.resolved ? "resolved" : "open", c.resolved ? "ok" : "warn"), String(c.finding)]), "The critic has found nothing yet."),
    panel("Verifier's report", [], [], s.verifyReport || "The verifier has not reported yet.", true),
  ];
}
/** The two moments worth reading off this screen without decoding it: a verifier
 * saying no, and the rounds running out. @returns {void} */
function readMoment() {
  const taken = st.taken, s = st.session, rounds = `round ${s?.round ?? "?"} of ${st.maxRounds || "?"}`;
  const open = (s?.critiques ?? []).filter((/** @type {any} */ c) => c.severity === "blocking" && !c.resolved).length;
  const back = taken && taken.to === "plan" && (taken.from === "verify" || taken.from === "critique");
  const spent = taken && taken.to === "respond" && (taken.from === "verify" || open > 0);
  st.tone = back ? "fail" : spent ? "warn" : "";
  st.note = back && taken ? `${taken.from} said no. The plan is being written again — ${rounds}.`
    : spent ? `Rounds ran out at ${rounds}. It is answering anyway, with ${open} unresolved blocking finding${open === 1 ? "" : "s"} stated.` : describe();
}
/** @returns {void} */
function render() {
  if (!body || !note) return;
  const flow = FLOWS[st.flow] ?? FLOWS.full, only = Object.keys(flow.edges).length === 1;
  // A one-phase flow gets no diagram: reactPanels says the shape in words.
  body.replaceChildren(...(only ? [] : [graphPanel()]), ...(only || st.phase === "react" ? reactPanels(only) : []), ...blackboard(st.session));
  note.textContent = st.note || describe();
  note.dataset.tone = st.tone;
}
/** @param {any} payload @returns {void} */
function enter(payload) {
  const name = String(payload?.phase ?? "");
  if (typeof payload?.flow === "string" && FLOWS[payload.flow]) st.flow = payload.flow;
  else if (name && !FLOWS[st.flow]?.edges[name]) st.flow = Object.keys(FLOWS).find((f) => FLOWS[f]?.edges[name]) ?? st.flow;
  st.taken = st.phase && name ? { from: st.phase, to: name } : null;
  if (name) st.phase = name, st.visited.add(name);
  if (payload?.session) st.session = payload.session;
  if (typeof payload?.maxRounds === "number") st.maxRounds = payload.maxRounds;
  if (name === "react") st.turns += 1;
  readMoment();
}
/** The repeat guard's own tally lives in the worker and is not reported, so this
 * counts the calls that came back instead. @param {any} payload @returns {void} */
function tally(payload) {
  const results = payload?.results ?? [];
  const call = typeof payload?.call === "string" && payload.call ? payload.call : results.map((/** @type {any} */ r) => String(r?.tool)).join(", ");
  if (call) st.calls.set(call, (st.calls.get(call) ?? 0) + 1);
}
/** A new turn starts from nothing: the graph of the last run is not this one. @returns {void} */
function reset() {
  Object.assign(st, { phase: "", taken: null, session: null, turns: 0, calls: new Map(), visited: new Set(), note: "", tone: "" });
}
/** @param {HTMLElement} element @param {unknown} runtime @returns {void} */
export function mount(element, runtime) {
  const rt = /** @type {any} */ (runtime);
  reset();
  note = el("p", { class: "note", role: "status", "aria-live": "polite" });
  body = el("div", { class: "body" });
  element.replaceChildren(el("div", { class: "flow" }, [el("header", { class: "head" }, [el("h1", {}, ["Flow"]), el("p", { class: "sub" }, ["The phase graph as the core declares it, and the blackboard the phases write."]), note]), body]));
  render();
  if (!rt || typeof rt.on !== "function") {
    note.textContent = "The runtime is not running, so no phase can report. The graph is what the flow declares; nothing else below is live.";
    note.dataset.tone = "warn";
    return;
  }
  const stop = [rt.on("phase:enter", (/** @type {any} */ p) => (enter(p), render()), { replay: true }),
    rt.on("tool:results", (/** @type {any} */ p) => (tally(p), render()), { replay: true }),
    rt.on("turn:start", () => (reset(), render()))];
  off = () => stop.forEach((f) => f());
}
/** @returns {void} */
export function unmount() { off?.(); off = note = body = null; }
