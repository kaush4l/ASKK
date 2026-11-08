// Edit-mode affordances an object offers, read only from the actions the objects carry.
// An element is edited through its engine's structure actions; an engine through its own.

const has = (o, name) => (o?.actions ?? []).some((a) => a.name === name);

/** [{key, label, action, target}] for obj (parent = the engine that holds it, if any). */
export function affordances(obj, parent) {
  if (!obj) return [];
  const out = [];
  if (obj.elements) {
    if (has(obj, "element.add")) out.push({ key: "add-element", label: "+ Element", action: "element.add", target: obj.id });
    if (has(obj, "engine.add")) out.push({ key: "add-engine", label: "+ Engine", action: "engine.add", target: obj.id });
    for (const name of ["engine.edit", "engine.rename"])
      if (has(obj, name)) { out.push({ key: "rename", label: "Rename", action: name, target: obj.id }); break; }
    if (has(obj, "engine.edit")) out.push({ key: "icon", label: "Icon", action: "engine.edit", target: obj.id });
    if (has(obj, "engine.children")) out.push({ key: "children", label: "Children", action: "engine.children", target: obj.id });
    // a child engine is removed by its parent; a top engine removes itself (the backend refuses the last one)
    const remover = parent ?? obj;
    if (has(remover, "engine.remove")) out.push({ key: "remove", label: "Remove", action: "engine.remove", target: remover.id });
  } else if (parent) {
    // A failed element (its .md does not load) has no kind config to edit: fix the file, or remove it.
    if (has(parent, "element.edit") && obj.phase !== "failed") out.push({ key: "edit", label: "Edit", action: "element.edit", target: parent.id });
    if (has(parent, "element.edit") && obj.phase !== "failed") out.push({ key: "icon", label: "Icon", action: "element.edit", target: parent.id });
    if (has(parent, "element.remove")) out.push({ key: "remove", label: "Remove", action: "element.remove", target: parent.id });
  }
  return out;
}

/** True when a click inside an item came from a control of its own (not the item itself). */
export function fromControl(target, item) {
  for (let n = target; n && n !== item; n = n.parentElement)
    if (/^(BUTTON|A|INPUT|SELECT|TEXTAREA|LABEL)$/.test(n.tagName)) return true;
  return false;
}
