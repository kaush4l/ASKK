/**
 * Boot: build the runtime, mount the shell, route.
 *
 * The route is the hash and nothing else. This page is a static export that has
 * to open from a subpath and from a `file://` URL, where there is no server to
 * rewrite `/flow` back to `/index.html`; the hash is the only address that
 * cannot break, so it is the only one used.
 *
 * The runtime and the four views are loaded with dynamic `import()` on literal
 * specifiers: the bundler folds each one in when the file exists, and when it
 * does not the failure arrives as a rejected promise this file can render
 * rather than as a blank page. That is the whole reason for the shape.
 */

import { DESTINATIONS, createShell, renderFailure } from "./shell.js";

/** @typedef {{ mount: (element: HTMLElement, runtime: unknown) => unknown, unmount?: () => unknown }} View */

const DEFAULT_ROUTE = "converse";

/** @type {{ stage: HTMLElement, announce: (t: string, tone?: string) => void, setActive: (id: string) => void } | null} */
let shell = null;
/** @type {View | null} */
let mounted = null;
let mountedId = "";
/** @type {unknown} */
let runtime = null;
/** Kept so every destination can say the same true thing about why it is empty. */
/** @type {unknown} */
let bootError = null;
/** Guards an await that finished after the reader had already moved on. */
let generation = 0;

/**
 * Measured, and the reason every `import()` below sits inside the `try` rather
 * than beside it: `bun build` treats an unresolvable dynamic import as a hard
 * build error unless it is lexically inside a try block, where it becomes an
 * optional import the page reports at runtime instead. Moving one of these out
 * of the try breaks the static export the moment a view file is missing.
 * @param {string} id
 * @returns {Promise<View>}
 */
async function loadView(id) {
  try {
    switch (id) {
      case "converse":
        return await import("./views/converse.js");
      case "flow":
        return await import("./views/flow.js");
      case "roster":
        return await import("./views/roster.js");
      case "bench":
        return await import("./views/bench.js");
    }
  } catch (cause) {
    throw new Error(`app/views/${id}.js did not load`, { cause });
  }
  throw new Error(`no view module is declared for "${id}"`);
}

/** @returns {string} the destination named by the hash, or "" when it names none. */
function routeFromHash() {
  const id = location.hash.replace(/^#\/?/, "").split("/")[0] ?? "";
  return DESTINATIONS.some((d) => d.id === id) ? id : "";
}

/**
 * @param {string} id
 * @returns {string}
 */
function labelOf(id) {
  return DESTINATIONS.find((d) => d.id === id)?.label ?? id;
}

/**
 * Swap the stage to one destination. Unmount first, always: a view left running
 * behind another one is a second writer nobody can see.
 * @param {string} id
 * @returns {Promise<void>}
 */
async function show(id) {
  if (!shell) return;
  const mine = ++generation;
  const label = labelOf(id);
  if (mounted) {
    try {
      mounted.unmount?.();
    } catch (error) {
      surface(`${labelOf(mountedId)} failed to unmount:`, error);
    }
    mounted = null;
  }
  shell.stage.replaceChildren();
  shell.setActive(id);
  document.title = `HARNESS · ${label}`;
  if (bootError !== null) {
    renderFailure(shell.stage, "The runtime did not start", `${label} is empty because nothing behind it is running.`, bootError);
    shell.announce(`${label} — the runtime did not start.`, "fail");
    return;
  }
  shell.announce(`${label} — loading its module`);
  await place(id, label, mine);
}

/**
 * @param {string} id
 * @param {string} label
 * @param {number} mine
 * @returns {Promise<void>}
 */
async function place(id, label, mine) {
  if (!shell) return;
  let view;
  try {
    view = await loadView(id);
    if (typeof view.mount !== "function") throw new Error(`app/views/${id}.js does not export mount(element, runtime)`);
  } catch (error) {
    if (mine !== generation) return;
    renderFailure(shell.stage, `${label} did not load`, `The page expected app/views/${id}.js to export mount(element, runtime).`, error);
    shell.announce(`${label} did not load.`, "fail");
    return;
  }
  if (mine !== generation) return;
  try {
    await view.mount(shell.stage, runtime);
  } catch (error) {
    if (mine !== generation) return;
    renderFailure(shell.stage, `${label} did not render`, "Its mount() raised. Nothing on this destination is live.", error);
    shell.announce(`${label} did not render.`, "fail");
    return;
  }
  if (mine !== generation) return;
  mounted = view;
  mountedId = id;
  shell.announce(label);
}

/** A hash that names no destination is rewritten, not honoured. @returns {void} */
function route() {
  const id = routeFromHash();
  if (!id) {
    location.replace(`#/${DEFAULT_ROUTE}`);
    return;
  }
  void show(id);
}

/**
 * @param {string} what
 * @param {unknown} error
 * @returns {void}
 */
function surface(what, error) {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (shell) shell.announce(`${what} ${text}`, "fail");
  else document.body.append(`${what} ${text}`);
}

/** @returns {Promise<void>} */
async function boot() {
  const root = document.getElementById("root");
  if (!root) throw new Error("app/index.html no longer has #root");
  shell = createShell(root);
  shell.announce("building the runtime");
  try {
    const module = await import("./runtime.js");
    const create = /** @type {{ createRuntime?: () => unknown }} */ (module).createRuntime;
    if (typeof create !== "function") throw new Error("app/runtime.js does not export createRuntime()");
    runtime = await create();
  } catch (error) {
    runtime = null;
    bootError = error;
  }
  window.addEventListener("hashchange", route);
  route();
}

window.addEventListener("error", (event) => surface("uncaught:", event.error ?? event.message));
window.addEventListener("unhandledrejection", (event) => surface("unhandled rejection:", event.reason));

boot().catch((error) => surface("boot failed:", error));
