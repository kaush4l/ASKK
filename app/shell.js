/**
 * The frame: the rail, the stage, the theme, and the one line that says what
 * just happened. It renders chrome and nothing else — no view, no runtime, no
 * state — because the interface may not compute what the core computes and the
 * frame has nothing of its own to compute either.
 *
 * The stage is what a view is handed. A view that has an inspector puts it in
 * the stage as an element carrying `data-region="inspector"`; shell.css turns
 * the stage into the second and third columns of the three-column grid when it
 * finds one, and into a bottom sheet under the breakpoint. That is the whole
 * contract between this file and the four view modules: one element in, one
 * optional attribute back.
 */

/** @typedef {"system"|"light"|"dark"} ThemeMode */
/** @typedef {{ id: string, label: string, note: string }} Destination */

const THEME_KEY = "harness.theme";

/** DESIGN §3. Four, and they do not nest. A fifth is a design change. */
/** @type {Destination[]} */
export const DESTINATIONS = [
  { id: "converse", label: "Converse", note: "transcript · prompt" },
  { id: "flow", label: "Flow", note: "phases · blackboard" },
  { id: "roster", label: "Roster", note: "agents · status" },
  { id: "bench", label: "Bench", note: "models · skills · space" },
];

/**
 * @param {string} tag
 * @param {Record<string, string>} [attrs]
 * @param {(Node | string)[]} [kids]
 * @returns {HTMLElement}
 */
function el(tag, attrs = {}, kids = []) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  node.append(...kids);
  return node;
}

/** @returns {ThemeMode} the stored choice, or `system` when there is none. */
function readTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // A private window throws on the property itself, not on the read.
  }
  return "system";
}

/**
 * `system` is the absence of the attribute, so the media queries decide.
 * @param {ThemeMode} mode
 * @returns {void}
 */
function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === "system") delete root.dataset.theme;
  else root.dataset.theme = mode;
  try {
    if (mode === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, mode);
  } catch {
    // Nothing to remember it in. The choice still holds for this page.
  }
}

/**
 * @param {HTMLElement} button
 * @param {ThemeMode} mode
 * @returns {void}
 */
function labelTheme(button, mode) {
  button.dataset.mode = mode;
  button.textContent = `Theme: ${mode}`;
  button.setAttribute("aria-label", `Theme: ${mode}. Activate for the next of system, light, dark.`);
}

/**
 * @param {(mode: ThemeMode) => void} onChange
 * @returns {HTMLElement}
 */
function themeControl(onChange) {
  /** @type {ThemeMode[]} */
  const order = ["system", "light", "dark"];
  let mode = readTheme();
  const button = el("button", { type: "button", class: "theme" });
  labelTheme(button, mode);
  button.addEventListener("click", () => {
    mode = order[(order.indexOf(mode) + 1) % order.length] ?? "system";
    applyTheme(mode);
    labelTheme(button, mode);
    onChange(mode);
  });
  return button;
}

/** @returns {HTMLElement} */
function railNav() {
  const items = DESTINATIONS.map((d) =>
    el("li", {}, [
      el("a", { href: `#/${d.id}`, "data-dest": d.id }, [
        el("span", { class: "dest-label" }, [d.label]),
        el("span", { class: "dest-note" }, [d.note]),
      ]),
    ]),
  );
  return el("nav", { class: "nav", "aria-label": "Destinations" }, [el("ul", {}, items)]);
}

/**
 * Build the frame into `root` and hand back the few handles the boot needs.
 * @param {HTMLElement} root
 * @returns {{ stage: HTMLElement, announce: (text: string, tone?: string) => void, setActive: (id: string) => void }}
 */
export function createShell(root) {
  const stage = el("main", { class: "stage", id: "stage", tabindex: "-1" });
  const status = el("p", { class: "status", role: "status", "aria-live": "polite" });
  const brand = el("div", { class: "brand" }, [
    el("span", { class: "brand-name" }, ["HARNESS"]),
    el("span", { class: "brand-note" }, ["prompt instrument"]),
  ]);
  const announce = (/** @type {string} */ text, /** @type {string} */ tone = "") => {
    status.textContent = text;
    status.dataset.tone = tone;
  };
  const nav = railNav();
  const rail = el("header", { class: "rail" }, [
    brand,
    nav,
    el("div", { class: "rail-foot" }, [
      themeControl((mode) => announce(`Theme set to ${mode}.`)),
      status,
    ]),
  ]);
  root.replaceChildren(
    el("a", { class: "skip", href: "#stage" }, ["Skip to the stage"]),
    el("div", { class: "frame" }, [rail, stage]),
  );
  const setActive = (/** @type {string} */ id) => {
    for (const link of nav.querySelectorAll("a[data-dest]")) {
      const on = link.getAttribute("data-dest") === id;
      if (on) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
  };
  return { stage, announce, setActive };
}

/**
 * A failure, in place, naming what was being done and what came back. The
 * failure this project has actually shipped is a page that renders and does
 * nothing, so nothing here is allowed to be silent or to look like a load.
 * @param {HTMLElement} host
 * @param {string} title
 * @param {string} what what the page was trying to do
 * @param {unknown} error
 * @returns {void}
 */
export function renderFailure(host, title, what, error) {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const stack = error instanceof Error && error.stack ? error.stack : "";
  host.replaceChildren(
    el("section", { class: "failure", role: "alert" }, [
      el("h1", {}, [title]),
      el("p", { class: "failure-what" }, [what]),
      el("pre", { class: "failure-text" }, [text]),
      ...(stack ? [el("pre", { class: "failure-stack" }, [stack])] : []),
    ]),
  );
}
