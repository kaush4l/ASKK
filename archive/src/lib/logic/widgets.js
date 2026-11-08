// The widget grid (contract §6, design-rules §7): every card size is a footprint of square cells, like home-screen
// widgets — icon 1×1, small 2×2, medium 4×2, large 4×4. The cell, the gap and the spans are tokens.
import TOKENS from "../../../design/tokens.json";

const px = (s) => parseFloat(String(s)) || 0;
export const CELL = px(TOKENS.widget.cell), GAP = px(TOKENS.widget.gap);
/** {cols, rows} of a card size; an unknown size is medium. */
export const SPANS = Object.fromEntries(Object.entries(TOKENS.span).map(([k, v]) => { const [c, r] = v.split(/\s+/).map(Number); return [k, { cols: c, rows: r }]; }));
export const spanOf = (size) => SPANS[size] ?? SPANS.medium;
/** The widest span: no grid has fewer columns, so every footprint fits. */
export const MIN_COLS = Math.max(...Object.values(SPANS).map((s) => s.cols));

/**
 * The grid for a container `width` px wide: as many token-sized cells as fit (at least MIN_COLS); a phone, or a
 * container too narrow for MIN_COLS cells, gets exactly MIN_COLS columns stretched to the full width, still square.
 */
export function widgetGrid(width, { phone = false, cell = CELL, gap = GAP } = {}) {
  const w = Math.max(0, Number(width) || 0);
  const fit = Math.floor((w + gap) / (cell + gap));
  if (phone || fit < MIN_COLS) {
    const c = w > 0 ? Math.max(1, (w - gap * (MIN_COLS - 1)) / MIN_COLS) : cell;
    return { cols: MIN_COLS, cell: c, gap };
  }
  return { cols: fit, cell, gap };
}

/** The pixel box of a size on a grid: width and height of its span (gaps between its cells included). */
export function footprint(size, grid = { cell: CELL, gap: GAP }) {
  const s = spanOf(size);
  return { w: s.cols * grid.cell + (s.cols - 1) * grid.gap, h: s.rows * grid.cell + (s.rows - 1) * grid.gap };
}

/**
 * Dense packing, as CSS `grid-auto-flow: dense` does: each item (in order) takes the first free place, scanning
 * rows then columns, so smaller items fill the holes larger ones leave. → [{id, col, row, cols, rows}] (0-based).
 */
export function pack(items, cols) {
  const used = [];
  const free = (r, c, s) => { for (let y = r; y < r + s.rows; y++) for (let x = c; x < c + s.cols; x++) if (x >= cols || used[y]?.[x]) return false; return true; };
  return items.map(({ id, size }) => {
    const s = spanOf(size), w = Math.min(s.cols, cols);
    const sp = { cols: w, rows: s.rows };
    for (let r = 0; ; r++) for (let c = 0; c + w <= cols; c++) if (free(r, c, sp)) {
      for (let y = r; y < r + sp.rows; y++) for (let x = c; x < c + w; x++) (used[y] ??= [])[x] = true;
      return { id, col: c, row: r, ...sp };
    }
  });
}
