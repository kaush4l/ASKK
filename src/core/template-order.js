// Render template — insertion order IS the render order.
//
// The template is an ordered list of elements. insert() appends,
// insertAt() places at an index, remove() drops by id, move()
// repositions by id, and render() renders strictly in the list's
// current order. The order itself is DATA (the list), never a
// hardcoded sequence of segment names inside the renderer: the
// renderer below does not name soul, tools, or any other segment
// — it walks the list it was given.
//
// defaultTemplate(elementsById) inserts in the old default order:
//   soul -> YOU ARE (instructions) -> TOOLS -> artifacts ->
//   REQUEST -> OWNER GUIDANCE -> EARLIER RUNS -> WORK DONE ->
//   RESPONSE
// Only elements actually present in elementsById are inserted;
// an absent segment is absent from the prompt, never an invented
// placeholder. Elements whose id is not in the default order are
// ignored by defaultTemplate() (use createTemplate() + insert()
// for a custom order that includes them).
//
// Elements are the DeskElement objects from elements.js (or any
// object with a toString()); this module does not import
// elements.js, so the order logic stays independent of element
// construction. elements.js renderPrompt() delegates here.

export const DEFAULT_TEMPLATE_ORDER = Object.freeze([
  "soul",
  "instructions",
  "tools",
  "artifact",
  "request",
  "owner-guidance",
  "earlier-runs",
  "work-done",
  "response",
]);

export function createTemplate(elements = []) {
  const list = [...(Array.isArray(elements) ? elements : [])];
  const template = {
    list: () => [...list],
    order: () => list.map((el) => el?.id ?? null),
    insert: (element) => {
      if (!element || typeof element !== "object") {
        throw new Error("template insert needs an element");
      }
      list.push(element);
      return template;
    },
    insertAt: (element, index) => {
      if (!element || typeof element !== "object") {
        throw new Error("template insertAt needs an element");
      }
      const at = Math.max(0, Math.min(index ?? list.length, list.length));
      list.splice(at, 0, element);
      return template;
    },
    remove: (id) => {
      const at = list.findIndex((el) => el?.id === id);
      if (at < 0) {
        return null;
      }
      const [removed] = list.splice(at, 1);
      return removed;
    },
    move: (id, index) => {
      const at = list.findIndex((el) => el?.id === id);
      if (at < 0) {
        throw new Error(`template has no element ${id}`);
      }
      const [element] = list.splice(at, 1);
      const to = Math.max(0, Math.min(index ?? list.length, list.length));
      list.splice(to, 0, element);
      return template;
    },
    render: () => list.map((el) => el.toString()).join("\n\n"),
  };
  return template;
}

export function defaultTemplate(elementsById = {}) {
  const template = createTemplate();
  const byId =
    elementsById && typeof elementsById === "object" ? elementsById : {};
  for (const id of DEFAULT_TEMPLATE_ORDER) {
    if (byId[id]) {
      template.insert(byId[id]);
    }
  }
  return template;
}
