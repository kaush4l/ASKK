import { test, expect } from "bun:test";
import { autoLayout, edgesFrom, edgePath, overlaps, fitCamera, bounds, flatten, zoomAt, coast, ownerPin, EDGE_STYLES, fitView, canvasSize, showsTitle, CANVAS_TEXT, LEGIBLE_PX } from "./canvas.js";

// a random world: engines with elements and children at any depth
function world(seed, n = 18) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  let k = 0;
  const make = (depth) => {
    const id = `e${k++}`;
    const e = { id, elements: Array.from({ length: Math.floor(rnd() * 5) }, (_, i) => ({ id: `${id}/x${i}` })), children: [], state: {} };
    while (depth < 3 && k < n && rnd() < 0.55) e.children.push(make(depth + 1));
    return e;
  };
  const tops = [];
  while (k < n) tops.push(make(0));
  return tops;
}
const noOverlap = (rects) => {
  const r = Object.entries(rects);
  for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++)
    if (overlaps(r[i][1], r[j][1])) return `${r[i][0]} overlaps ${r[j][0]}`;
  return null;
};

test("auto-layout places every engine, never two frames overlapping, parents above children", () => {
  for (let seed = 1; seed < 40; seed++) for (const at of ["icon", "small", "medium", "large"]) {
    const w = world(seed);
    const rects = autoLayout(w, { at });
    expect(Object.keys(rects).length).toBe(flatten(w).length);
    expect(noOverlap(rects)).toBe(null);
    for (const n of flatten(w)) if (n.parent) expect(rects[n.parent].y + rects[n.parent].h).toBeLessThanOrEqual(rects[n.id].y);
  }
});

test("saved positions win and the tidy tree moves clear of them; measured sizes are used", () => {
  for (let seed = 1; seed < 30; seed++) {
    const w = world(seed);
    const ids = flatten(w).map((n) => n.id);
    const saved = { [ids[0]]: { x: 0, y: 0 }, [ids[3]]: { x: 300, y: 40 } };
    const sizes = Object.fromEntries(ids.map((id, i) => [id, { w: 200 + (i % 4) * 90, h: 120 + (i % 5) * 70 }]));
    const rects = autoLayout(w, { saved, sizes });
    expect(rects[ids[0]]).toMatchObject({ x: 0, y: 0, w: sizes[ids[0]].w });
    expect(rects[ids[3]]).toMatchObject({ x: 300, y: 40 });
    expect(noOverlap(rects)).toBe(null);
  }
});

test("edges come from the world: parent → child, and every help.ask route with open ones flagged", () => {
  const w = [{ id: "home", state: { asks: [{ id: "a1", from: "home", to: "owner", status: "open" }] }, elements: [],
    children: [{ id: "home/kid", state: {}, elements: [], children: [{ id: "home/kid/deep", state: {}, elements: [], children: [] }] }] }];
  w[0].children[0].state.asks = [{ id: "a1", from: "home/kid/deep", to: "home/kid", status: "open", question: "why?" }, { id: "a2", from: "home/kid/deep", to: "home/kid", status: "answered" }];
  const e = edgesFrom(w);
  expect(e.filter((x) => x.kind === "child").map((x) => [x.from, x.to])).toEqual([["home", "home/kid"], ["home/kid", "home/kid/deep"]]);
  const asks = e.filter((x) => x.kind === "ask");
  expect(asks.map((x) => [x.from, x.to, x.open])).toEqual([["home", "owner", true], ["home/kid/deep", "home/kid", true], ["home/kid/deep", "home/kid", false]]);
  expect(new Set(e.map((x) => x.id)).size).toBe(e.length);
  expect(edgesFrom([{ id: "x", state: { asks: "nope" } }])).toEqual([]);
});

test("edge paths per style; owner asks point at a pin above the frame", () => {
  const a = { x: 0, y: 0, w: 100, h: 50 }, b = { x: 200, y: 200, w: 100, h: 50 };
  const child = { kind: "child" };
  expect(edgePath(child, a, b, "curve")).toMatch(/^M50 50C/);
  expect(edgePath(child, a, b, "straight")).toBe("M50 50L250 200");
  expect(edgePath(child, a, b, "step")).toBe("M50 50V125H250V200");
  expect(edgePath(child, a, b, "none")).toBe("");
  expect(edgePath({ kind: "ask" }, b, a, "curve")).toMatch(/^M300 /);
  const pin = ownerPin(a);
  expect(edgePath({ kind: "ask", to: "owner" }, a, null, "straight")).toBe(`M50 0L${pin.x} ${pin.y}`);
  expect(EDGE_STYLES).toContain("curve");
});

test("fit shows every frame; zoom keeps the pointer's point; inertia decays", () => {
  const rects = { a: { x: -100, y: 50, w: 300, h: 200 }, b: { x: 900, y: 600, w: 300, h: 400 } };
  const cam = fitCamera(rects, 1200, 800);
  const b = bounds(rects);
  expect(b.x * cam.z + cam.x).toBeGreaterThanOrEqual(0);
  expect((b.x + b.w) * cam.z + cam.x).toBeLessThanOrEqual(1200);
  expect((b.y + b.h) * cam.z + cam.y).toBeLessThanOrEqual(800);
  const z = zoomAt({ x: 10, y: 20, z: 1 }, 2, 300, 200);
  expect([(300 - z.x) / z.z, (200 - z.y) / z.z]).toEqual([290, 180]);
  let v = { x: 10, y: 0 }, n = 0;
  while (v && n < 500) { v = coast(v); n++; }
  expect(v).toBe(null);
  expect(n).toBeLessThan(100);
});

// ── 2026-11-08: a compact forest, fit at a readable zoom ──
const leaf = (id, n = 2, children = []) => ({ id, elements: Array.from({ length: n }, (_, i) => ({ id: `${id}/x${i}` })), children, state: {} });

test("top-level engines sit side by side in one row; siblings share a row; children below their parent", () => {
  const w = [leaf("a"), leaf("b", 3, [leaf("b/1"), leaf("b/2", 1, [leaf("b/2/x")])]), leaf("c"), leaf("d", 5)];
  for (const at of ["far", "icon", "small", "medium", "large"]) {
    const r = autoLayout(w, { at });
    expect(new Set(["a", "b", "c", "d"].map((id) => r[id].y)).size).toBe(1);
    expect(r.a.x).toBeLessThan(r.b.x); expect(r.b.x).toBeLessThan(r.c.x); expect(r.c.x).toBeLessThan(r.d.x);
    expect(r["b/1"].y).toBe(r["b/2"].y);
    expect(r["b/1"].x + r["b/1"].w).toBeLessThanOrEqual(r["b/2"].x);
    expect(r["b/2/x"].y).toBeGreaterThanOrEqual(r["b/2"].y + r["b/2"].h);
    expect(noOverlap(r)).toBe(null);
    const b = bounds(r);
    expect(b.w).toBeGreaterThan(b.h); // a row, never one tall column
  }
});

test("tidy packing: a short subtree tucks under a tall neighbour's gap (contours, not whole-subtree boxes)", () => {
  // a wide child row under 'a' must not push 'b' right of the whole row when 'b' has no children
  const w = [leaf("a", 1, [leaf("a/1"), leaf("a/2"), leaf("a/3")]), leaf("b", 1)];
  const sizes = { a: { w: 100, h: 50 }, "a/1": { w: 300, h: 50 }, "a/2": { w: 300, h: 50 }, "a/3": { w: 300, h: 50 }, b: { w: 100, h: 50 } };
  const r = autoLayout(w, { sizes, gap: 20 });
  expect(noOverlap(r)).toBe(null);
  expect(r.b.y).toBe(r.a.y);
  // b only has to clear 'a' itself and the top row; it may sit above a/3's span
  expect(r.b.x).toBeLessThan(r["a/3"].x + r["a/3"].w);
});

test("measured sizes: random worlds with random real sizes never overlap, every size", () => {
  for (let seed = 1; seed < 60; seed++) {
    const w = world(seed, 24);
    const ids = flatten(w).map((n) => n.id);
    let s = seed * 7;
    const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    const sizes = Object.fromEntries(ids.map((id) => [id, { w: 120 + rnd() * 600, h: 40 + rnd() * 900 }]));
    for (const wrap of [Infinity, 500, 1200]) {
      const r = autoLayout(w, { sizes, wrap });
      expect(noOverlap(r)).toBe(null);
      for (const n of flatten(w)) if (n.parent) expect(r[n.parent].y + r[n.parent].h).toBeLessThanOrEqual(r[n.id].y);
    }
  }
});

test("fitView picks the largest legible size whose layout fits; 4 engines on 1160x900 at ≥ 60 %", () => {
  const w = [leaf("home", 6, [leaf("home/research", 4, [leaf("home/research/scout", 3)]), leaf("home/notes", 2)]), leaf("bare", 2), leaf("ops", 3)];
  const v = fitView(w, 1160, 900);
  expect(v.cam.z).toBeGreaterThanOrEqual(0.6);
  expect(canvasSize(v.cam.z)).toBe(v.at);
  const b = bounds(v.rects);
  expect(b.x * v.cam.z + v.cam.x).toBeGreaterThanOrEqual(0);
  expect((b.x + b.w) * v.cam.z + v.cam.x).toBeLessThanOrEqual(1160);
  expect((b.y + b.h) * v.cam.z + v.cam.y).toBeLessThanOrEqual(900);
  // legible: the smallest text of the picked size is ≥ 10 px on screen (far only shows its title when legible)
  expect(CANVAS_TEXT[v.at] * v.cam.z).toBeGreaterThanOrEqual(LEGIBLE_PX);
  // a phone still fits, legibly, collapsing as needed
  const p = fitView(w, 390, 780);
  expect(CANVAS_TEXT[p.at] * p.cam.z).toBeGreaterThanOrEqual(LEGIBLE_PX);
  const pb = bounds(p.rects);
  expect((pb.x + pb.w) * p.cam.z + p.cam.x).toBeLessThanOrEqual(390 + 0.5);
});

test("zoom → size is capped by legibility: text under 10 px on screen renders as icon, then the far frame", () => {
  // the owner's thresholds say small at 0.4, but 12 px card text at 0.4 is 4.8 px: icon / far instead
  expect(canvasSize(0.4, { icon: 0.35, small: 0.6, medium: 1.25 })).toBe("far");
  expect(canvasSize(0.7)).toBe("icon");
  expect(canvasSize(1)).toBe("medium");
  expect(canvasSize(2)).toBe("large");
  expect(canvasSize(0.2)).toBe("far");
  for (let z = 0.1; z < 2.5; z += 0.01) { const s = canvasSize(z); expect(s === "far" || CANVAS_TEXT[s] * z >= LEGIBLE_PX).toBe(true); }
  expect(showsTitle(0.2)).toBe(false);
  expect(showsTitle(0.4)).toBe(true);
});

test("a free child of a dragged (saved) parent hangs below that parent, overlapping nothing", () => {
  const w = [leaf("a", 2, [leaf("a/k", 2, [leaf("a/k/s", 1)])]), leaf("b")];
  const r = autoLayout(w, { saved: { "a/k": { x: -500, y: 300 } } });
  expect(r["a/k/s"].y).toBeGreaterThanOrEqual(r["a/k"].y + r["a/k"].h);
  expect(Math.abs(r["a/k/s"].x + r["a/k/s"].w / 2 - (r["a/k"].x + r["a/k"].w / 2))).toBeLessThan(1);
  expect(noOverlap(r)).toBe(null);
});
