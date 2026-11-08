import { test, expect } from "bun:test";
import { defaultEngineId, composerTarget, loopOf, phasesOf, phaseAction, workflowsOf, workflowAction, sendAction, cancelAction, replyAction, ownerAsks, keyIntent, growRows, isRunning, composerStatus, submitAction } from "./composer.js";

const loop = (phase = "idle", now = "idle") => ({ id: "askk/loop", kind: "loop", phase, status: { now } });
const phases = (current = "chat") => ({ id: "askk/phases", kind: "phases", phase: "idle", state: { current },
  config: { list: [{ id: "chat", title: "Chat", icon: "💬", tools: [] }, { id: "research", title: "Research", icon: "🔎", tools: ["files.read"] }, "plain"] } });
const flows = (phase = "idle", now = "1 workflow(s)") => ({ id: "askk/workflows", kind: "workflows", phase, status: { now }, config: { list: [{ id: "study", title: "Study", icon: "📚", phases: ["research", "build"] }] } });
const eng = (over = {}) => ({ id: "askk", kind: "engine", title: "Askk", elements: [{ id: "askk/model", kind: "model" }, loop(), phases(), flows()], children: [], state: {}, ...over });
const world = (engines, ui = {}) => ({ engines, ui });

test("the page default names the target; else the first top engine", () => {
  const w = world([eng({ id: "a" }), eng({ id: "askk" })], { dashboard: { c: "Page", props: { default: "askk" } } });
  expect(defaultEngineId(w, w.ui.dashboard)).toBe("askk");
  expect(defaultEngineId(w, { c: "Page", props: {} })).toBe("a");
  expect(defaultEngineId(w, { c: "Page", props: { default: "gone" } })).toBe("a");
  expect(defaultEngineId(world([]), null)).toBe(null);
  expect(composerTarget(w, "a", "askk").id).toBe("a");
  expect(composerTarget(w, null, "askk").id).toBe("askk");
  expect(composerTarget(w, "missing", "askk").id).toBe("askk");
});

test("phases: the selected one is the mode; set {phase} on the phases element", () => {
  expect(phasesOf(eng()).map((x) => [x.id, x.current, x.icon])).toEqual([["chat", true, "💬"], ["research", false, "🔎"], ["plain", false, ""]]);
  expect(phasesOf({ id: "x", elements: [] })).toEqual([]);
  expect(phaseAction(eng(), "research")).toEqual({ target: "askk/phases", action: "set", args: { phase: "research" } });
  expect(phaseAction(eng(), "chat")).toBe(null);
  expect(phaseAction(eng(), "nope")).toBe(null);
});

test("workflows: Run workflow posts run {workflow, input}; cancel and status follow the workflow", () => {
  expect(workflowsOf(eng())).toEqual([{ id: "study", title: "Study", icon: "📚", phases: ["research", "build"] }]);
  expect(workflowAction(eng(), "study", " topic ")).toEqual({ target: "askk/workflows", action: "run", args: { workflow: "study", input: "topic" } });
  expect(workflowAction(eng(), "study", "")).toBe(null);
  expect(workflowAction(eng(), "nope", "x")).toBe(null);
  const running = eng({ elements: [loop("waiting", "step 1 · calling model"), phases("research"), flows("running", "workflow research→build · 1/2")] });
  expect(isRunning(running)).toBe(true);
  expect(workflowAction(running, "study", "x")).toBe(null);
  expect(cancelAction(running)).toEqual({ target: "askk/workflows", action: "cancel", args: {} });
  expect(composerStatus(running)).toEqual({ running: true, line: "workflow research→build · 1/2 · step 1 · calling model" });
});

test("send runs the target's loop with the text; empty or running sends nothing", () => {
  expect(loopOf(eng()).id).toBe("askk/loop");
  expect(sendAction(eng(), "  hello  ")).toEqual({ target: "askk/loop", action: "run", args: { input: "hello" } });
  expect(sendAction(eng(), "   ")).toBe(null);
  const busy = eng({ elements: [loop("waiting", "step 1 · calling model"), phases(), flows()] });
  expect(isRunning(busy)).toBe(true);
  expect(sendAction(busy, "hi")).toBe(null);
  expect(sendAction(eng({ elements: [] }), "hi")).toBe(null);
});

test("cancel stops a running loop only", () => {
  expect(cancelAction(eng())).toBe(null);
  expect(cancelAction(eng({ elements: [loop("running"), flows()] }))).toEqual({ target: "askk/loop", action: "cancel", args: {} });
});

test("status: running shows the loop's step line; else the mode and the last answer state", () => {
  expect(composerStatus(eng({ elements: [loop("waiting", "step 2 · calling model"), phases()] }))).toEqual({ running: true, line: "step 2 · calling model" });
  expect(composerStatus(eng()).running).toBe(false);
  expect(composerStatus(eng()).line).toBe("💬 Chat · idle");
  expect(composerStatus(eng({ elements: [loop()] })).line).toBe("idle");
  expect(composerStatus(null)).toEqual({ running: false, line: "No engine" });
});

test("open asks to the owner become reply chips; a chosen ask turns Send into a reply", () => {
  const asks = [{ id: "a1", to: "owner", status: "open", question: "Which file?" }, { id: "a2", to: "owner", status: "answered" }, { id: "a3", to: "askk", from: "askk/kid", status: "open", question: "Ok?" }];
  const e = eng({ state: { asks } });
  expect(ownerAsks(e).map((a) => a.id)).toEqual(["a1", "a3"]);
  expect(replyAction(e, "a1", " notes.md ")).toEqual({ target: "askk", action: "reply", args: { ask: "a1", text: "notes.md" } });
  expect(replyAction(e, "a1", "")).toBe(null);
  expect(submitAction(e, "notes.md", "a1")).toEqual(replyAction(e, "a1", "notes.md"));
  expect(submitAction(e, "hello", null)).toEqual(sendAction(e, "hello"));
  // a reply still goes while the loop runs
  expect(submitAction(eng({ state: { asks }, elements: [loop("running")] }), "x", "a1").action).toBe("reply");
});

test("Enter sends, Shift+Enter is a newline, composing text is left alone", () => {
  expect(keyIntent({ key: "Enter" })).toBe("send");
  expect(keyIntent({ key: "Enter", shiftKey: true })).toBe("newline");
  expect(keyIntent({ key: "Enter", isComposing: true })).toBe(null);
  expect(keyIntent({ key: "a" })).toBe(null);
  expect(keyIntent({ key: "Escape" })).toBe("blur");
});

test("the text area grows with its lines up to a cap", () => {
  expect(growRows("")).toBe(1);
  expect(growRows("a\nb\nc")).toBe(3);
  expect(growRows("1\n2\n3\n4\n5\n6\n7\n8\n9", 6)).toBe(6);
});

import { featuredSplit } from "./layout.js";
test("the dashboard features the default engine; the others go beside it", () => {
  const es = [{ id: "a" }, { id: "askk" }, { id: "b" }];
  expect(featuredSplit(es, "askk")).toEqual({ featured: es[1], rest: [es[0], es[2]] });
  expect(featuredSplit(es, "gone").featured.id).toBe("a");
  expect(featuredSplit([], "askk")).toEqual({ featured: null, rest: [] });
});
