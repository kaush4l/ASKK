/**
 * The prompt inspector — DESIGN §4, the signature view.
 *
 *     const inspector = createInspector()
 *     runtime.on("prompt:assembled", (a) => inspector.show(a))
 *
 * Every other agent interface hides the prompt behind a speech bubble. This one
 * puts it on screen in the pieces it was built from: one band per component
 * that survived `applies()`, in the order `PromptAssembler` joined them, each
 * carrying the four facts that make the memo legible — slot, class, key, bytes.
 *
 * It renders `prompt:assembled`, which the worker posts BEFORE the model is
 * called. That ordering is the whole point: the bands appear, then the answer
 * arrives against them. Nothing here batches the two or waits for a turn to end.
 *
 * It computes nothing the core computes. The one number derived here is the
 * per-turn hit ratio, and it is counted off the rows already on screen rather
 * than from the assembler's totals, which are cumulative since boot and cannot
 * be differenced back into one turn without keeping a running copy of them.
 */

import "./inspector.css";

/**
 * `text` is optional because the event's declared payload does not carry it —
 * see the report for this increment. When it is absent the band says so rather
 * than showing an empty box that reads as a component with nothing in it.
 * @typedef {{ slot: number, name: string, key: string, bytes: number, memo: boolean, cacheable: boolean, text?: string }} Band
 * @typedef {{ agent?: string, phase?: string, bytes?: number, bands?: Band[] }} Assembled
 */

const NUMBER = new Intl.NumberFormat();

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

/**
 * `key()` is `ClassName:digest`, and the class name is already the band's own
 * column — eight characters of the prefix would print the same string on every
 * row and teach nothing. The digest is the half that changes when the component
 * changes, so the digest is what is shown; the full key is on the title.
 * @param {string} key
 * @returns {string}
 */
function fingerprint(key) {
  const at = key.lastIndexOf(":");
  return (at === -1 ? key : key.slice(at + 1)).slice(0, 8) || "—";
}

/**
 * Three states, not two. A band that opted out of the memo did not miss it.
 * @param {Band} band
 * @returns {"memo" | "fresh" | "never cached"}
 */
function mark(band) {
  if (!band.cacheable) return "never cached";
  return band.memo ? "memo" : "fresh";
}

/**
 * One band. Collapsed text is `hidden` rather than clipped to zero height: a
 * reader must be able to select what is open, and a keyboard must not land in
 * what is closed, and `hidden` is the only state that gets both right.
 * @param {Band} band
 * @param {number} index
 * @returns {HTMLElement}
 */
function bandItem(band, index) {
  const id = `band-${index}`;
  const missing = "This event carried the band's measurements but not its text.";
  const body = el("pre", { class: "band-text", id, hidden: "" }, [band.text ?? missing]);
  if (band.text === undefined) body.dataset.absent = "true";
  const row = el("button", { type: "button", class: "band-row", "aria-expanded": "false", "aria-controls": id }, [
    el("span", { class: "band-slot" }, [String(band.slot)]),
    el("span", { class: "band-name" }, [band.name]),
    el("span", { class: "band-key", title: band.key }, [fingerprint(band.key)]),
    el("span", { class: "band-mark" }, [mark(band)]),
    el("span", { class: "band-bytes" }, [`${NUMBER.format(band.bytes)} B`]),
  ]);
  row.addEventListener("click", () => {
    const open = body.hidden;
    body.hidden = !open;
    row.setAttribute("aria-expanded", String(open));
  });
  const item = el("li", { class: "band" }, [row, body]);
  item.dataset.mark = mark(band);
  return item;
}

/**
 * @param {string} label
 * @returns {{ row: HTMLElement, value: HTMLElement }}
 */
function metric(label) {
  const value = el("span", { class: "metric-value" });
  return { row: el("p", { class: "metric" }, [el("span", { class: "metric-label" }, [label]), value]), value };
}

/**
 * The furniture, built once. Split from `createInspector` so that neither this
 * nor the two calls below runs past the forty-line limit.
 * @returns {{ element: HTMLElement, list: HTMLElement, empty: HTMLElement, status: HTMLElement, bytes: HTMLElement, memo: HTMLElement, foot: HTMLElement }}
 */
function panel() {
  const list = el("ol", { class: "bands" });
  const empty = el("p", { class: "inspector-empty" }, [
    "No prompt yet. One appears here the moment the agent assembles it — before the model is called.",
  ]);
  const status = el("p", { class: "inspector-status", role: "status", "aria-live": "polite" });
  const bytes = metric("total");
  const memo = metric("from the memo");
  const foot = el("footer", { class: "totals", hidden: "" }, [
    bytes.row,
    memo.row,
    el("p", { class: "metric-note" }, ["The context band never caches — a cached clock is a wrong clock — so it is not counted."]),
  ]);
  const element = el("aside", { "data-region": "inspector", class: "inspector", "aria-label": "Prompt inspector" }, [
    el("header", { class: "inspector-head" }, [
      el("h2", {}, ["Prompt"]),
      el("p", { class: "inspector-note" }, ["Slot order, as the assembler joined it. Open a band for its exact bytes."]),
      status,
    ]),
    empty,
    list,
    foot,
  ]);
  return { element, list, empty, status, bytes: bytes.value, memo: memo.value, foot };
}

/** The panel, and the two calls that drive it.
 * @returns {{ element: HTMLElement, show: (a: Assembled) => void, clear: () => void }} */
export function createInspector() {
  const parts = panel();

  /** @param {Assembled} assembled @returns {void} */
  function show(assembled) {
    const bands = assembled.bands ?? [];
    parts.list.replaceChildren(...bands.map(bandItem));
    parts.empty.hidden = bands.length > 0;
    parts.foot.hidden = bands.length === 0;
    const cacheable = bands.filter((band) => band.cacheable);
    const hits = cacheable.filter((band) => band.memo).length;
    const share = cacheable.length ? Math.round((hits / cacheable.length) * 100) : 0;
    const total = NUMBER.format(assembled.bytes ?? 0);
    parts.bytes.textContent = `${total} bytes · ${bands.length} components`;
    parts.memo.textContent = `${hits} of ${cacheable.length} · ${share}%`;
    const where = assembled.phase ? ` in phase ${assembled.phase}` : "";
    parts.status.textContent = `Prompt assembled for ${assembled.agent ?? "the agent"}${where}: ${total} bytes, ${share}% from the memo.`;
  }

  /** @returns {void} */
  function clear() {
    parts.list.replaceChildren();
    parts.empty.hidden = false;
    parts.foot.hidden = true;
    parts.status.textContent = "";
  }

  return { element: parts.element, show, clear };
}
