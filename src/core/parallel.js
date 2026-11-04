// Parallel rendering — independent elements render together.
//
// renderElementsParallel(elements, cache?) via Promise.all:
// each element is { id, kind, version, data, render(), toString(),
// cacheKey }. An element whose cacheKey matches the cache is
// SKIPPED (its render() is never called); only changed elements
// re-render. cacheKey may be a function, a string, or absent —
// absent falls back to id + version + stable JSON of data.
// Returns { rendered: [{ id, text, cached }], renderedCount,
// skippedCount }. Rendering is never stop-the-world: one element's
// failure is recorded on that element, not thrown for the batch.

function stable(value) {
  return JSON.stringify(value ?? null);
}

export function elementCacheKey(element) {
  if (typeof element?.cacheKey === "function") {
    return element.cacheKey();
  }
  if (typeof element?.cacheKey === "string") {
    return element.cacheKey;
  }
  if (typeof element?.toString === "function" && element?.kind) {
    // DeskElement (elements.js) already carries a cacheKey().
    return `${element.kind}:${element.id}:v${element.version ?? 1}:${stable(element.data)}`;
  }
  return `${element?.id ?? "element"}:v${element?.version ?? 1}:${stable(element?.data)}`;
}

export async function renderElementsParallel(elements, cache = new Map()) {
  const list = Array.isArray(elements) ? elements : [];
  const results = await Promise.all(
    list.map(async (element) => {
      const id = element?.id ?? "element";
      const key = elementCacheKey(element);
      if (cache.has(key)) {
        return { id, text: cache.get(key), cached: true };
      }
      try {
        const out =
          typeof element?.render === "function"
            ? await element.render()
            : typeof element?.toString === "function"
              ? element.toString()
              : String(element?.data ?? "");
        const text = String(out);
        cache.set(key, text);
        return { id, text, cached: false };
      } catch (error) {
        return { id, text: "", cached: false, error: error.message };
      }
    }),
  );
  return {
    rendered: results,
    renderedCount: results.filter((r) => !r.cached).length,
    skippedCount: results.filter((r) => r.cached).length,
  };
}
