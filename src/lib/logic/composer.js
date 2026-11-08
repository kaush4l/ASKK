// The footer composer (contract §6 `Composer`): pure logic over the world — which engine it talks to, its modes,
// what Send / Stop / a mode chip / a reply chip post. The component only renders this and calls store.act.

/** The page's default engine: the page tree's `default` when it names a top engine, else the first top engine. */
export function defaultEngineId(world, tree) {
  const engines = world?.engines ?? [];
  const want = tree?.props?.default;
  if (want && engines.some((e) => e.id === want)) return want;
  return engines[0]?.id ?? null;
}

/** The engine a composer talks to: its own `target` when that names a top engine, else the page default. */
export function composerTarget(world, target, dflt) {
  const engines = world?.engines ?? [];
  return engines.find((e) => e.id === target) ?? engines.find((e) => e.id === dflt) ?? engines[0] ?? null;
}

/** The engine's loop: its first loop element that loads. */
export const loopOf = (engine) => (engine?.elements ?? []).find((x) => x.kind === "loop" && x.phase !== "failed") ?? null;

const elementOf = (engine, kind) => (engine?.elements ?? []).find((x) => x.kind === kind && x.phase !== "failed") ?? null;
const busy = (o) => ["running", "waiting"].includes(o?.phase);
/** The engine's workflows (its workflows element): each an ordered list of phase ids. */
export const workflowsOf = (engine) => {
  const w = elementOf(engine, "workflows");
  return w ? (w.config?.list ?? []).filter((x) => x && x.id).map((x) => ({ id: x.id, title: x.title ?? x.id, icon: x.icon ?? "🧵", phases: x.phases ?? [] })) : [];
};
/** The loop or a workflow runs: Send waits, Stop shows. */
export const isRunning = (engine) => busy(loopOf(engine)) || busy(elementOf(engine, "workflows"));

/** The engine's phases (its phases element), the current one marked: the selected phase is the mode it works in. */
export function phasesOf(engine) {
  const p = elementOf(engine, "phases");
  if (!p) return [];
  const list = (p.config?.list ?? []).map((x) => (typeof x === "string" ? { id: x } : x)).filter((x) => x && x.id);
  const cur = list.some((x) => x.id === p.state?.current) ? p.state.current : list[0]?.id;
  return list.map((x) => ({ id: x.id, title: x.title ?? x.id, icon: x.icon ?? "", tools: x.tools ?? null, current: x.id === cur }));
}

/** `set {phase}` on the phases element (the owner selects the mode); null for the current or an unknown phase. */
export function phaseAction(engine, id) {
  const m = phasesOf(engine).find((x) => x.id === id);
  if (!m || m.current) return null;
  return { target: elementOf(engine, "phases").id, action: "set", args: { phase: id } };
}

/** `run {workflow, input}` on the workflows element: the text runs through the workflow's phases in order. */
export function workflowAction(engine, workflow, text) {
  const input = String(text ?? "").trim();
  const w = elementOf(engine, "workflows");
  if (!w || !input || isRunning(engine) || !workflowsOf(engine).some((x) => x.id === workflow)) return null;
  return { target: w.id, action: "run", args: { workflow, input } };
}

/** `run {input}` on the engine's loop; null when the text is empty, there is no loop, or it runs. */
export function sendAction(engine, text) {
  const input = String(text ?? "").trim();
  const lp = loopOf(engine);
  if (!input || !lp || isRunning(engine)) return null;
  return { target: lp.id, action: "run", args: { input } };
}

/** `cancel` on a running loop; null when nothing runs. */
export function cancelAction(engine) {
  const w = elementOf(engine, "workflows");
  if (busy(w)) return { target: w.id, action: "cancel", args: {} };
  return busy(loopOf(engine)) ? { target: loopOf(engine).id, action: "cancel", args: {} } : null;
}

/** Open asks the engine holds (to the owner, or from a child engine): the reply chips above the composer. */
export const ownerAsks = (engine) => (engine?.state?.asks ?? []).filter((a) => a.status === "open");

/** `reply {ask, text}` on the engine that holds the ask. */
export function replyAction(engine, ask, text) {
  const t = String(text ?? "").trim();
  if (!engine || !ask || !t) return null;
  return { target: engine.id, action: "reply", args: { ask, text: t } };
}

/** What the composer's submit posts: a reply when an ask is chosen, else a run. */
export const submitAction = (engine, text, ask) => (ask ? replyAction(engine, ask, text) : sendAction(engine, text));

/** One line under the text area: the loop's step while it runs, else the mode and the loop's state. */
export function composerStatus(engine) {
  if (!engine) return { running: false, line: "No engine" };
  const lp = loopOf(engine), w = elementOf(engine, "workflows");
  if (busy(w)) return { running: true, line: [w.status?.now, busy(lp) ? lp.status?.now : null].filter(Boolean).join(" · ") };
  if (busy(lp)) return { running: true, line: lp.status?.now || lp.phase };
  const m = phasesOf(engine).find((x) => x.current);
  const state = lp ? lp.status?.now || lp.phase : "No loop";
  return { running: false, line: m ? `${`${m.icon} ${m.title}`.trim()} · ${state}` : state };
}

/** A key in the text area: Enter sends, Shift+Enter is a newline, Escape leaves; an IME composition is its own. */
export function keyIntent(e) {
  if (e?.isComposing) return null;
  if (e?.key === "Enter") return e.shiftKey ? "newline" : "send";
  if (e?.key === "Escape") return "blur";
  return null;
}

/** Rows of the auto-growing text area: one per line, at least 1, at most `max`. */
export const growRows = (text, max = 8) => Math.max(1, Math.min(max, String(text ?? "").split("\n").length));
