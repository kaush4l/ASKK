/**
 * Converse — the transcript, and the prompt inspector beside it (DESIGN §3).
 *
 * The transcript reads the way the prompt writes it: `[USER]:` and
 * `[ASSISTANT]:` tags, content in mono, a hairline between turns, no bubbles
 * (§2). A tool call and the `Result:` turn answering it are one block: in the
 * transcript they are one exchange, and the model reads them as one.
 *
 * Nothing here computes what the core computed. The one thing measured on this
 * side is elapsed time, which no event can carry: it keeps running while the
 * event sits still, and it is why the line under the transcript can always say a
 * real progress fact instead of spinning (§2).
 */

import "./converse.css";
import { el } from "../dom.js";
import { createInspector } from "./inspector.js";

/**
 * @typedef {import("../runtime.js").Runtime} Runtime
 * @typedef {{ role: string, content: string }} Message
 * @typedef {ReturnType<typeof createActivity>} Activity
 * @typedef {{ section: HTMLElement, list: HTMLElement, area: HTMLTextAreaElement, send: HTMLButtonElement,
 *   form: HTMLFormElement, activity: Activity, inspector: ReturnType<typeof createInspector>,
 *   rendered: number, busy: boolean }} Ui
 */

/** The prefix `agent-react.js` writes on every tool observation. */
const RESULT = "Result: ";

/** @type {(() => void)[]} */
let off = [];
/** @type {Activity | null} */
let running = null;

/** One turn, verbatim — `Result: ` stays on the front of an observation because
 * that prefix is in the prompt, and this view's claim is that it shows the prompt.
 * @param {string} tag @param {Message} m @param {"prose"|"call"|"result"} kind @returns {HTMLElement} */
function turnItem(tag, m, kind) {
  const tagged = m.role === "assistant" ? "[ASSISTANT]:" : "[USER]:";
  const head = el("p", { class: "turn-role" }, [tagged]);
  if (kind !== "prose") head.append(el("span", { class: "turn-kind" }, [kind === "call" ? "tool call" : "tool result"]));
  const node = el(tag, { class: "turn" }, [head, el("pre", { class: "turn-body" }, [m.content])]);
  node.dataset.role = m.role;
  node.dataset.kind = kind;
  return node;
}

/** Append every turn from `from` on, pairing a call with its result. Appending
 * rather than repainting is what lets the list carry `aria-live`.
 * @param {HTMLElement} list @param {Message[]} messages @param {number} from @returns {number} */
function paint(list, messages, from) {
  let i = Math.max(0, from);
  while (i < messages.length) {
    const turn = messages[i];
    const next = messages[i + 1];
    if (!turn) break;
    if (turn.role === "assistant" && next?.role === "user" && next.content.startsWith(RESULT)) {
      list.append(el("li", { class: "pair" }, [turnItem("div", turn, "call"), turnItem("div", next, "result")]));
      i += 2;
    } else {
      list.append(turnItem("li", turn, "prose"));
      i += 1;
    }
  }
  return i;
}

/** The line that says what is happening. It holds one fact and re-prints it with
 * the elapsed seconds ten times a second while a turn is out — "inferring, 4.2s"
 * — so the number moves even when no event has arrived for a while.
 * @param {HTMLElement} node @returns {{ say: (t: string, tone?: string) => void,
 *   begin: (t: string) => void, settle: (t: string, tone?: string) => void, stop: () => void }} */
function createActivity(node) {
  let what = "";
  let since = 0;
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let timer;
  const print = () => void (node.textContent = what ? `${what}${since ? `, ${((Date.now() - since) / 1000).toFixed(1)}s` : ""}` : "");
  const say = (/** @type {string} */ text, /** @type {string} */ tone = "") => {
    what = text;
    node.dataset.tone = tone;
    print();
  };
  const stop = () => {
    clearInterval(timer);
    timer = undefined;
  };
  return {
    say,
    stop,
    begin(text) { since = Date.now(); timer ||= setInterval(print, 100); say(text); },
    settle(text, tone = "") { stop(); since = 0; say(text, tone); },
  };
}

/** @returns {Ui} the whole destination, unwired. */
function build() {
  const list = el("ol", { class: "transcript", "aria-live": "polite", "aria-label": "Transcript" });
  const line = el("p", { class: "activity", role: "status", "aria-live": "polite" });
  const area = /** @type {HTMLTextAreaElement} */ (el("textarea", { id: "turn-input", rows: "1", "aria-describedby": "turn-hint" }));
  const send = /** @type {HTMLButtonElement} */ (el("button", { type: "submit", class: "send" }, ["Send"]));
  send.disabled = true;
  const label = el("label", { class: "composer-label", for: "turn-input" }, ["Your turn"]);
  const hint = el("p", { class: "hint", id: "turn-hint" }, ["Enter sends. Shift+Enter starts a line."]);
  const form = /** @type {HTMLFormElement} */ (el("form", { class: "composer" }, [label, area, send, hint]));
  const section = el("section", { class: "converse" }, [el("h1", {}, ["Converse"]), list, line, form]);
  return { section, list, area, send, form, activity: createActivity(line), inspector: createInspector(), rendered: 0, busy: false };
}

/** The textarea grows, Enter sends, Shift+Enter does not. The textarea is never
 * disabled while a turn is out — a person may write the next one — so the send
 * button is the only control the busy flag closes.
 * @param {Runtime} rt @param {Ui} ui @returns {void} */
function wireComposer(rt, ui) {
  const fit = () => void ((ui.area.style.height = "auto"), (ui.area.style.height = `${ui.area.scrollHeight}px`));
  ui.area.addEventListener("input", fit);
  ui.area.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    ui.form.requestSubmit();
  });
  ui.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = ui.area.value.trim();
    if (!text || ui.busy || ui.send.disabled) return;
    ui.area.value = "";
    fit();
    // The rejection arrives as an `error` event too; awaiting it here reports it twice.
    void rt.send(text).catch(() => {});
  });
}

/** Every event the runtime emits, and the one thing on screen each one moves.
 * @param {Runtime} rt @param {Ui} ui @returns {void} */
function wireEvents(rt, ui) {
  const on = (/** @type {string} */ type, /** @type {(p: any) => void} */ fn) => off.push(rt.on(type, fn));
  on("turn:start", (p) => {
    ui.busy = true;
    // Shown before the core has it — the transcript only comes back at turn:end —
    // and marked, because a turn that is not in the prompt yet must not read as one that is.
    const pending = turnItem("li", { role: "user", content: String(p.input) }, "prose");
    pending.dataset.pending = "true";
    pending.querySelector(".turn-role")?.append(el("span", { class: "turn-kind" }, ["sending"]));
    ui.list.append(pending);
    ui.activity.begin("assembling the prompt");
  });
  on("prompt:assembled", (p) => void (ui.inspector.show(p), ui.activity.say(`inferring against ${Number(p.bytes).toLocaleString()} bytes`)));
  on("phase:enter", (p) => ui.activity.say(`phase ${p.phase}`));
  on("tool:results", (p) => ui.activity.say(`ran ${(p.results ?? []).map((/** @type {any} */ r) => `${r.tool}${r.ok ? "" : " (failed)"}`).join(", ")}`));
  on("log", (p) => void (ui.busy && ui.activity.say(String(p.message))));
  on("turn:end", (p) => {
    ui.busy = false;
    for (const node of ui.list.querySelectorAll("[data-pending]")) node.remove();
    ui.rendered = paint(ui.list, p.messages ?? rt.messages(), ui.rendered);
    ui.activity.settle(`answered in ${(Number(p.ms) / 1000).toFixed(1)}s`);
  });
  on("error", (p) => void ((ui.busy = false), ui.activity.settle(`${p.kind}: ${p.message}`, "fail")));
}

/** Nothing else starts the runtime, and the destination that talks to the agent
 * is where starting it belongs. A failure lands on the activity line rather than
 * replacing the screen: the transcript that already loaded is still true.
 * @param {HTMLElement} element the stage @param {unknown} runtime @returns {Promise<void>} */
export async function mount(element, runtime) {
  const rt = /** @type {Runtime} */ (runtime);
  const ui = build();
  running = ui.activity;
  element.append(ui.section, ui.inspector.element);
  ui.rendered = paint(ui.list, rt.messages(), 0);
  wireComposer(rt, ui);
  wireEvents(rt, ui);
  if (rt.status === "ready") {
    ui.send.disabled = false;
    return;
  }
  ui.activity.begin("starting the agents");
  try {
    const names = await rt.start();
    ui.send.disabled = false;
    ui.activity.settle(`${names.length} agent(s) loaded`);
  } catch (error) {
    ui.activity.settle(`the agents did not start: ${error instanceof Error ? error.message : String(error)}`, "fail");
  }
}

/** @returns {void} */
export function unmount() {
  for (const stop of off) stop();
  off = [];
  running?.stop();
  running = null;
}
