// Pure helpers over the world tree (engines → elements, children at any depth).

/** Every object (engines and elements) depth-first. */
export function* walk(engines = []) {
  for (const e of engines) {
    yield e;
    for (const el of e.elements ?? []) yield el;
    yield* walk(e.children ?? []);
  }
}

export function findObject(world, id) {
  for (const o of walk(world?.engines)) if (o.id === id) return o;
  return null;
}

/** The engine that holds an element (or the parent of a child engine). */
export function parentEngine(world, id) {
  for (const o of walk(world?.engines)) {
    if (!o.elements) continue;
    if (o.elements.some((x) => x.id === id) || (o.children ?? []).some((x) => x.id === id)) return o;
  }
  return null;
}

/**
 * Replace one object by id in place (returns true when found). An engine twin keeps its
 * elements/children unless the incoming twin carries them.
 */
export function replaceTwin(world, id, twin) {
  const swap = (list) => {
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) return false;
    const old = list[i];
    const next = { ...twin };
    if (old.elements && !next.elements) next.elements = old.elements;
    if (old.children && !next.children) next.children = old.children;
    list[i] = next;
    return true;
  };
  const visit = (engines) => {
    if (!engines) return false;
    if (swap(engines)) return true;
    for (const e of engines) {
      if (e.elements && swap(e.elements)) return true;
      if (visit(e.children)) return true;
    }
    return false;
  };
  return visit(world?.engines);
}
