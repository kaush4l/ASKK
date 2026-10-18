import { describe, expect, test } from "bun:test"

import { AGENT_H, AGENT_W, ARTIFACT_H, CARD_H, STEM_Y, fitScale, layoutDesk, layoutToFit, nodeRect, placeAt } from "./canvas-layout.js"

const agentsOf = (layout) => layout.nodes.filter((n) => n.kind === "agent")
const byId = (layout, id) => layout.nodes.find((n) => n.kind === "agent" && n.id === id)
const cx = (n) => n.x + n.w / 2
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const inside = (r, f) => r.x >= f.x && r.y >= f.y && r.x + r.w <= f.x + f.w && r.y + r.h <= f.y + f.h

function expectNoOverlap(nodes) {
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) if (overlaps(nodes[i], nodes[j])) throw new Error(`${nodes[i].id} overlaps ${nodes[j].id}`)
}

// Every lead's centre x is the midpoint of its first and last member's centre x (any depth).
function expectCentred(layout, tree) {
  const walk = (node) => {
    const kids = node.children ?? node.agents ?? []
    if (!kids.length) return
    const first = byId(layout, kids[0].name)
    const last = byId(layout, kids.at(-1).name)
    expect(cx(byId(layout, node.name))).toBeCloseTo((cx(first) + cx(last)) / 2, 6)
    kids.forEach(walk)
  }
  walk(tree)
}

const leaf = (name, extra = {}) => ({ name, children: [], ...extra })

// Edge segments that cut through a node box (strictly inside it), other than the edge's own two agents.
function crossings(layout, level = "near") {
  const boxes = layout.nodes.map((n) => placeAt(n, level))
  const hits = []
  for (const e of layout.edges) {
    for (let i = 1; i < e.points.length; i++) {
      const [[x1, y1], [x2, y2]] = [e.points[i - 1], e.points[i]]
      expect(x1 === x2 || y1 === y2).toBe(true) // orthogonal
      for (const b of boxes) {
        if (b.kind === "agent" && (b.id === e.from || b.id === e.to)) continue
        const inX = (x) => x > b.x && x < b.x + b.w
        const inY = (y) => y > b.y && y < b.y + b.h
        const spans = (a1, a2, lo, hi) => Math.max(Math.min(a1, a2), lo) < Math.min(Math.max(a1, a2), hi)
        const hit = x1 === x2 ? inX(x1) && spans(y1, y2, b.y, b.y + b.h) : inY(y1) && spans(x1, x2, b.x, b.x + b.w)
        if (hit) hits.push(`${e.from}>${e.to} through ${b.kind} ${b.id}`)
      }
    }
  }
  return hits
}

describe("layoutDesk", () => {
  test("a 1-agent tree: one node at the origin, no edges, bounds around it", () => {
    const layout = layoutDesk(leaf("solo"))
    expect(agentsOf(layout)).toHaveLength(1)
    expect(layout.nodes[0]).toMatchObject({ id: "solo", kind: "agent", x: 0, y: 0, w: AGENT_W, h: AGENT_H, depth: 0, parent: null, desk: null })
    expect(layout.edges).toEqual([])
    expect(layout.frames).toEqual([])
    expect(layout.bounds).toEqual({ x: 0, y: 0, w: AGENT_W, h: AGENT_H })
  })

  test("a lead with 3 members: one row below, consecutive slots, the lead centred, an edge to each", () => {
    const tree = { name: "lead", children: [leaf("a"), leaf("b"), leaf("c")] }
    const layout = layoutDesk(tree)
    const [a, b, c] = ["a", "b", "c"].map((n) => byId(layout, n))
    expect(new Set([a.y, b.y, c.y]).size).toBe(1)
    expect(a.y).toBeGreaterThan(byId(layout, "lead").y + AGENT_H)
    expect(a.x).toBeLessThan(b.x)
    expect(b.x).toBeLessThan(c.x)
    expect(cx(byId(layout, "lead"))).toBeCloseTo(cx(b), 6)
    expectNoOverlap(agentsOf(layout))
    expectCentred(layout, tree)
    expect(layout.edges.map((e) => `${e.from}>${e.to}`)).toEqual(["lead>a", "lead>b", "lead>c"])
    // Each edge leaves the lead's centre line and ends on its member's top centre.
    for (const e of layout.edges) {
      expect(e.points[0][0]).toBeCloseTo(cx(byId(layout, "lead")), 6)
      expect(e.points.at(-1)).toEqual([cx(byId(layout, e.to)), byId(layout, e.to).y])
    }
    expect(byId(layout, "a")).toMatchObject({ depth: 1, parent: "lead" })
  })

  test("a 3-level tree with a nested desk: tidy, no overlaps, the desk frame holds its whole subtree", () => {
    const tree = {
      name: "lead",
      children: [
        { name: "m1", team: "one", children: [leaf("x1"), leaf("x2"), leaf("x3")] },
        { name: "m2", desk: "inner", children: [{ name: "n1", team: "deep", children: [leaf("y1"), leaf("y2")] }, leaf("n2")] },
        leaf("m3"),
      ],
    }
    const layout = layoutDesk(tree)
    expect(agentsOf(layout)).toHaveLength(11)
    expectNoOverlap(agentsOf(layout))
    expectCentred(layout, tree)
    expect(Math.max(...agentsOf(layout).map((n) => n.depth))).toBe(3)

    const deskFrames = layout.frames.filter((f) => f.kind === "desk")
    expect(deskFrames).toHaveLength(1)
    const frame = deskFrames[0]
    expect(frame.desk).toBe("inner")
    for (const name of ["m2", "n1", "n2", "y1", "y2"]) {
      expect(inside(byId(layout, name), frame)).toBe(true)
      expect(byId(layout, name).desk).toBe("inner")
    }
    // Nothing outside the mounted desk sits in its frame.
    for (const name of ["lead", "m1", "x1", "x2", "x3", "m3"]) {
      expect(overlaps(byId(layout, name), frame)).toBe(false)
      expect(byId(layout, name).desk).toBeNull()
    }
    // Team frames hold their team, and no two frames of different subtrees cross.
    const one = layout.frames.find((f) => f.kind === "team" && f.team === "one")
    for (const name of ["m1", "x1", "x2", "x3"]) expect(inside(byId(layout, name), one)).toBe(true)
    expect(overlaps(one, frame)).toBe(false)
    const deep = layout.frames.find((f) => f.kind === "team" && f.team === "deep")
    expect(inside(deep, frame)).toBe(true)
    // Bounds hold every node and frame.
    for (const r of [...layout.nodes, ...layout.frames]) expect(inside(r, layout.bounds)).toBe(true)
  })

  test("artifacts sit under their agent: a team's under its lead when it holds them, else under the first holder", () => {
    const tree = { name: "lead", team: "desk", children: [{ name: "boss", team: "ops", children: [leaf("w1"), leaf("w2")] }, leaf("solo")] }
    const artifacts = {
      "desk.board": { id: "desk.board", view: "board", owner: "desk", holders: ["lead", "boss"] },
      "ops.board": { id: "ops.board", view: "board", owner: "ops", holders: ["boss", "w1", "w2"] },
      "ops.memory": { id: "ops.memory", view: "text", owner: "ops", holders: ["boss"] },
      "w1.checklist": { id: "w1.checklist", view: "checklist", owner: "ops", holders: ["w1"] },
      "book.memory": { id: "book.memory", view: "text", owner: "book", holders: ["solo"] },
    }
    const layout = layoutDesk(tree, { artifacts })
    const art = (id) => layout.nodes.find((n) => n.kind === "artifact" && n.id === id)
    expect(art("desk.board").owner).toBe("lead")
    expect(art("ops.board").owner).toBe("boss")
    expect(art("ops.memory").owner).toBe("boss")
    expect(art("w1.checklist").owner).toBe("w1")
    expect(art("book.memory").owner).toBe("solo")
    // Under the owner's box, never on an agent, never on each other.
    for (const a of layout.nodes.filter((n) => n.kind === "artifact")) {
      const owner = byId(layout, a.owner)
      expect(a.y).toBeGreaterThanOrEqual(owner.y + owner.h)
      expect(a.h).toBe(ARTIFACT_H)
    }
    expectNoOverlap(layout.nodes)
    // A team's grid spreads under its members: two board-and-memory side by side, one row.
    expect(art("ops.board").y).toBe(art("ops.memory").y)
    // The next row starts below the tallest grid of the row above.
    expect(byId(layout, "w1").y).toBeGreaterThan(art("ops.board").y + ARTIFACT_H)
  })

  test("any number of agents at any depth: wide and deep trees never overlap and stay centred", () => {
    let n = 0
    const grow = (depth) => ({ name: `a${n++}`, team: depth ? `t${n}` : null, children: depth < 3 ? Array.from({ length: 1 + (n % 4) }, () => grow(depth + 1)) : [] })
    const tree = grow(0)
    const artifacts = Object.fromEntries(Array.from({ length: n }, (_, i) => [`x${i}`, { id: `x${i}`, view: "list", owner: "?", holders: [`a${(i * 7) % n}`] }]))
    const layout = layoutDesk(tree, { artifacts })
    expect(agentsOf(layout)).toHaveLength(n)
    expectNoOverlap(layout.nodes)
    expectCentred(layout, tree)
    const teams = layout.frames.filter((f) => f.kind === "team")
    for (let i = 0; i < teams.length; i++)
      for (let j = i + 1; j < teams.length; j++) if (!inside(teams[i], teams[j]) && !inside(teams[j], teams[i])) expect(overlaps(teams[i], teams[j])).toBe(false)
  })

  test("the desk's own tree shape ({agents}) lays out the same as a team tree, repeated names once", () => {
    const kernel = { name: "lead", agents: [{ name: "a", agents: [{ name: "b", agents: [] }] }, { name: "b", agents: [] }] }
    const layout = layoutDesk(kernel)
    expect(agentsOf(layout).map((n) => n.id).sort()).toEqual(["a", "b", "lead"])
    expect(byId(layout, "b").depth).toBe(1)
    expect(nodeRect(layout, "a")).toMatchObject({ kind: "agent", depth: 1 })
    expect(nodeRect(layout, "nobody")).toBeNull()
    expect(layoutDesk(null).nodes).toEqual([])
  })

  test("wrap: a team of leaves stacks into columns filled top to bottom, still centred, never overlapping", () => {
    const tree = { name: "lead", children: [{ name: "t1", team: "one", children: ["a", "b", "c", "d", "e"].map((n) => leaf(n)) }, { name: "t2", team: "two", children: [leaf("f"), leaf("g")] }] }
    const wide = layoutDesk(tree)
    const tall = layoutDesk(tree, { wrap: 2 })
    expect(tall.wrap).toBe(2)
    // 5 members, 2 a row at most → 3 rows: columns [a b c] [d e]; the lead over the first and last column.
    const xs = ["a", "b", "c", "d", "e"].map((n) => byId(tall, n).x)
    expect(new Set(xs.slice(0, 3)).size).toBe(1)
    expect(new Set(xs.slice(3)).size).toBe(1)
    expect(byId(tall, "b").y).toBeGreaterThan(byId(tall, "a").y + AGENT_H)
    expectNoOverlap(tall.nodes)
    expectCentred(tall, tree)
    // A stacked member's edge comes in at its face from the rail beside its column; the others end on its top.
    for (const e of tall.edges) {
      const to = byId(tall, e.to)
      const stacked = tall.nodes.some((n) => n.kind === "agent" && n.id !== to.id && n.parent === to.parent && n.x === to.x)
      expect(e.points.at(-1)).toEqual(stacked ? [cx(to), to.y + STEM_Y] : [cx(to), to.y])
    }
    const team = tall.frames.find((f) => f.team === "one")
    for (const n of ["t1", "a", "b", "c", "d", "e"]) expect(inside(byId(tall, n), team)).toBe(true)
    expect(tall.bounds.w).toBeLessThan(wide.bounds.w)
    expect(tall.bounds.h).toBeGreaterThan(wide.bounds.h)
  })

  test("layoutToFit picks the wrap that shows the whole desk largest for the viewport's shape", () => {
    const team = (name, n) => ({ name, team: name, children: Array.from({ length: n }, (_, i) => leaf(`${name}${i}`)) })
    const tree = { name: "lead", children: [team("p", 4), team("q", 3), team("r", 2), team("s", 4)] }
    const wideScreen = { w: 2400, h: 700 }
    const tallScreen = { w: 390, h: 760 }
    const forWide = layoutToFit(tree, {}, wideScreen)
    const forTall = layoutToFit(tree, {}, tallScreen)
    expect(forWide.wrap).toBe(Infinity)
    expect(forTall.wrap).toBeLessThan(4)
    expect(fitScale(forTall.bounds, tallScreen)).toBeGreaterThan(fitScale(layoutDesk(tree).bounds, tallScreen))
    for (const wrap of [1, 2, 3]) expect(fitScale(forTall.bounds, tallScreen)).toBeGreaterThanOrEqual(fitScale(layoutDesk(tree, { wrap }).bounds, tallScreen) - 1e-9)
    expect(layoutToFit(tree, {}, null).wrap).toBe(Infinity)
  })

  test("stacked teams: every edge is orthogonal and no segment crosses a node box, up close and far", () => {
    const team = (name, n, extra = {}) => ({ name, team: name, children: Array.from({ length: n }, (_, i) => leaf(`${name}${i}`)), ...extra })
    const tree = { name: "lead", team: "desk", children: [team("p", 4), team("q", 3), team("r", 1), leaf("solo")] }
    const artifacts = [
      ...["a", "b", "c"].map((x) => ({ id: `desk.${x}`, view: "list", owner: "desk", holders: ["lead"] })),
      ...["p", "q"].flatMap((t) => ["board", "memory", "checklist"].map((k) => ({ id: `${t}.${k}`, view: k === "board" ? "board" : "text", owner: t, holders: [t] }))),
      { id: "r.board", view: "board", owner: "r", holders: ["r"] },
      { id: "p0.checklist", view: "checklist", owner: "p0", holders: ["p0"] },
      { id: "p1.checklist", view: "checklist", owner: "p1", holders: ["p1"] },
    ]
    for (const wrap of [1, 2, Infinity]) {
      const layout = layoutDesk(tree, { artifacts, wrap })
      expectNoOverlap(layout.nodes)
      for (const level of ["near", "mid", "far"]) expect(crossings(layout, level)).toEqual([])
    }
    // Stacked members hang off a rail beside their column, not off the member above.
    const tall = layoutDesk(tree, { artifacts, wrap: 1 })
    const toP2 = tall.edges.find((e) => e.to === "p2")
    const p2 = byId(tall, "p2")
    expect(toP2.points.at(-2)[0]).toBeLessThan(p2.x)
    expect(toP2.points.at(-1)).toEqual([cx(p2), p2.y + STEM_Y])
  })

  test("placeAt: far and mid, the card is compact and its artifacts sit right under it", () => {
    const layout = layoutDesk({ name: "solo", children: [] }, { artifacts: [{ id: "solo.memory", view: "text", owner: "solo", holders: ["solo"] }] })
    const agent = byId(layout, "solo")
    const art = layout.nodes.find((n) => n.kind === "artifact")
    expect(placeAt(agent, "near")).toBe(agent)
    expect(placeAt(agent, "mid").h).toBe(CARD_H.mid)
    const lifted = placeAt(art, "mid")
    expect(lifted.y - (agent.y + CARD_H.mid)).toBe(art.y - (agent.y + AGENT_H))
    expect(placeAt(art, "far").y).toBe(lifted.y)
  })
})
