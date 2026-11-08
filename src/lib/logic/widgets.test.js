import { test, expect } from "bun:test";
import { SPANS, spanOf, widgetGrid, footprint, pack, MIN_COLS, CELL, GAP } from "./widgets.js";

test("in-grid footprints: icon a 2×2 tile, small a 4×3 card; medium and large open out of the grid so they keep the small footprint", () => {
  expect(SPANS).toEqual({ icon: { cols: 2, rows: 2 }, small: { cols: 4, rows: 3 }, medium: { cols: 4, rows: 3 }, large: { cols: 4, rows: 3 } });
  expect(spanOf("nope")).toEqual(SPANS.medium);
  const i = footprint("icon"), s = footprint("small");
  expect(i.w).toBe(i.h);
  expect(s.w * s.h).toBeGreaterThan(i.w * i.h);
});

test("the grid: token cells as many as fit, never fewer than the widest span; phones take 4 full-width columns", () => {
  expect(widgetGrid(960)).toEqual({ cols: Math.floor((960 + GAP) / (CELL + GAP)), cell: CELL, gap: GAP });
  const narrow = widgetGrid(300);
  expect(narrow.cols).toBe(MIN_COLS);
  expect(narrow.cols * narrow.cell + (narrow.cols - 1) * narrow.gap).toBeCloseTo(300);
  const phone = widgetGrid(358, { phone: true });
  expect(phone.cols).toBe(4);
  expect(phone.cols * phone.cell + 3 * phone.gap).toBeCloseTo(358);
});

test("dense packing tiles mixed sizes without overlap and fills holes", () => {
  const sizes = ["small", "icon", "small", "icon", "icon", "small", "icon", "icon", "small", "small"];
  for (const cols of [4, 6, 8, 11]) {
    const placed = pack(sizes.map((size, i) => ({ id: `x${i}`, size })), cols);
    const seen = new Set();
    for (const p of placed) {
      expect(p.col + p.cols).toBeLessThanOrEqual(cols);
      for (let y = p.row; y < p.row + p.rows; y++) for (let x = p.col; x < p.col + p.cols; x++) {
        expect(seen.has(`${x},${y}`)).toBe(false);
        seen.add(`${x},${y}`);
      }
    }
  }
  // the icon after a small fills the row beside it, not a new row
  const [l, i] = pack([{ id: "l", size: "small" }, { id: "i", size: "icon" }], 6);
  expect([l.col, l.row, i.col, i.row]).toEqual([0, 0, 4, 0]);
});
