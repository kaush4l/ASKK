// The desk on a canvas: every agent a node laid out from the desk's tree, the artifacts each agent keeps in a grid
// under it, a frame around every team and every desk mounted inside this one, an edge from each lead to each member.
// Pure (no React, no host), so the canvas (components/canvas/) and the tests read the same geometry.
//
//   layoutDesk(tree, {artifacts, wrap}) → {nodes, edges, frames, bounds, wrap}
//     tree: a team tree ({name, children}: team-tree.js) or the desk's own ({name, agents}); any depth. A node with
//           `desk` set is a desk mounted inside this one: its whole subtree gets a frame.
//     artifacts: the desk's artifacts ({id: artifact} or a list): each sits under the agent that keeps it — a team's
//           artifact under the team's lead when the lead holds it, else under its first holder.
//     wrap: at most this many members of a team side by side when they are all leaves (default: no limit); more
//           stack in columns, filled top to bottom — so a wide desk can be laid out tall for a tall screen.
//
//     nodes:  {id: name, kind: "agent", x, y, w, h, depth, parent, desk, title, team}
//             {id, kind: "artifact", owner: agent name, view, x, y, w, h}
//             — the geometry up close (near); placeAt(node, level) gives it at any zoom (the card is shorter
//             far and mid, and its artifacts sit right under it)
//     edges:  {from, to, points: [[x, y], …]} lead → member, orthogonal, never through a box but its own two: down
//             from the lead's face (between its artifact columns, or along a rail beside them), along a bar
//             between the rows, then down onto the member — or, for members stacked in a column, down a rail
//             beside the column and in at the member's face
//     frames: {kind: "desk", desk, lead, x, y, w, h} around a mounted desk's subtree;
//             {kind: "team", team, title, lead, x, y, w, h} around a team (a lead below the root with members)
//     bounds: {x, y, w, h} around everything
//
//   layoutToFit(tree, {artifacts}, viewport) → the layout (one of the wraps) that shows the whole desk largest.
//
// Tidy tree, top-down: leaves take consecutive slots left to right, every lead is centred over its first and last
// member, rows by depth. A subtree is packed as a block as wide as everything in it (artifact grids and frames
// included), so no two nodes and no two frames of different subtrees ever overlap.

// Sizes (world px). An agent's box holds its card at every zoom (components/canvas/agent-node.jsx).
export const AGENT_W = 220
export const AGENT_H = 280
export const ARTIFACT_W = 220
export const ARTIFACT_H = 96
export const ARTIFACT_GAP = 10 // between artifacts in a grid
export const ARTIFACT_TOP = 20 // between an agent's box and its artifact grid
export const SIBLING_GAP = 28 // between neighbouring subtrees
export const STACK_GAP = 24 // between members stacked in a column (wrap)
export const ROW_GAP = 112 // between one row's lowest box and the next row
export const STEM_Y = 60 // edges leave a lead, and enter a stacked member, this far down its box (its face)
export const RAIL_GAP = 6 // a rail runs this far beside the boxes it passes (inside the team frame's padding)

// The card's height at each zoom: far (face and name) and mid (the card) are compact, near fills the box.
export const CARD_H = Object.freeze({ far: 200, mid: 200, near: AGENT_H })
export const TEAM_PAD = 10 // a team frame around its subtree
export const DESK_PAD = 24 // a desk frame around its subtree
export const LABEL_H = 26 // a frame's label strip, above its padding

// Artifacts in reading order by view, then id (as desk.js orders a card's).
const ORDER = ["list", "checklist", "quality", "board", "schedule", "text"]
const rank = (a) => (ORDER.includes(a.view) ? ORDER.indexOf(a.view) : ORDER.length)

const kidsOf = (node) => node.children ?? node.agents ?? []

// Where each artifact sits: name → [artifact], ordered.
function homes(root, artifacts, names) {
  const leadOf = new Map() // team → its lead
  const walk = (n) => {
    if (n.team && !leadOf.has(n.team)) leadOf.set(n.team, n.name)
    kidsOf(n).forEach(walk)
  }
  walk(root)
  const list = Array.isArray(artifacts) ? artifacts : Object.values(artifacts ?? {})
  const at = new Map()
  for (const a of list) {
    if (!a?.id) continue
    const holders = (a.holders ?? []).filter((h) => names.has(h))
    const lead = leadOf.get(a.owner)
    const home =
      lead && (!a.holders?.length || a.holders.includes(lead)) ? lead
      : holders[0] ?? lead ?? (names.has(a.owner) ? a.owner : root.name)
    at.set(home, [...(at.get(home) ?? []), a])
  }
  for (const [name, arts] of at) at.set(name, arts.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id)))
  return at
}

// An artifact grid at most `avail` wide (at least one column), as few rows as fit. A lead's (`even`) has an even
// number of columns when it has two or more, so its trunk runs down the gap in the middle.
function gridOf(count, avail, even = false) {
  if (!count) return { cols: 0, rows: 0, w: 0, h: 0 }
  const fit = Math.max(1, Math.floor((avail + ARTIFACT_GAP) / (ARTIFACT_W + ARTIFACT_GAP)))
  let cols = Math.min(count, fit)
  if (even && cols > 1 && cols % 2) cols = cols + 1 <= Math.min(count, fit) ? cols + 1 : cols - 1
  const rows = Math.ceil(count / cols)
  return { cols, rows, w: cols * ARTIFACT_W + (cols - 1) * ARTIFACT_GAP, h: rows * ARTIFACT_H + (rows - 1) * ARTIFACT_GAP }
}

// How tall an agent's box is with its artifact grid.
const blockH = (b) => AGENT_H + (b.grid.rows ? ARTIFACT_TOP + b.grid.h : 0)

const union = (rects) => {
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y }
}

const EMPTY = Object.freeze({ nodes: [], edges: [], frames: [], bounds: { x: 0, y: 0, w: 0, h: 0 }, wrap: Infinity })

export function layoutDesk(tree, { artifacts = null, wrap = Infinity } = {}) {
  if (!tree?.name) return EMPTY
  const perRow = Math.max(1, Math.floor(wrap) || Infinity)
  // Every name once (a repeated name keeps its shallowest place).
  const names = new Set()
  const norm = (n, depth) => {
    names.add(n.name)
    const kids = kidsOf(n).filter((k) => k?.name && !names.has(k.name))
    kids.forEach((k) => names.add(k.name))
    return { name: n.name, title: n.title ?? null, team: n.team ?? null, desk: n.desk ?? null, depth, kids: kids.map((k) => norm(k, depth + 1)) }
  }
  const root = norm(tree, 0)
  const artsAt = homes(tree, artifacts, names)

  // Pass 1, bottom-up: each subtree as a block [min, max] around its lead's centre; members' centres relative to it
  // (rel) and, when stacked, how far down their row they start (dy).
  const measure = (n) => {
    const kids = n.kids.map(measure)
    // Columns of members: one each, or — all leaves and more than `wrap` — filled top to bottom.
    const rows = kids.length > perRow && kids.every((k) => !k.kids.length) ? Math.ceil(kids.length / perRow) : 1
    const columns = []
    for (let i = 0; i < kids.length; i += rows) columns.push(kids.slice(i, i + rows))
    const at = []
    let right = 0
    columns.forEach((col, c) => {
      const min = Math.min(...col.map((k) => k.min))
      const max = Math.max(...col.map((k) => k.max))
      const cx = c === 0 ? 0 : right + SIBLING_GAP - min
      right = cx + max
      let dy = 0
      for (const k of col) {
        at.push(cx)
        k.dy = dy
        dy += blockH(k) + STACK_GAP
      }
    })
    const mid = kids.length ? (at[0] + at.at(-1)) / 2 : 0
    const rel = at.map((cx) => cx - mid)
    const arts = artsAt.get(n.name) ?? []
    const grid = gridOf(arts.length, kids.length ? rel.at(-1) - rel[0] + AGENT_W : AGENT_W, kids.length > 0)
    const stacked = new Set(columns.filter((col) => col.length > 1).flat().map((k) => k.name))
    let min = -Math.max(AGENT_W, grid.w) / 2
    let max = -min
    kids.forEach((k, i) => {
      min = Math.min(min, rel[i] + k.min)
      max = Math.max(max, rel[i] + k.max)
    })
    const frame = n.desk ? "desk" : n.depth > 0 && kids.length ? "team" : null
    const pad = frame === "desk" ? DESK_PAD : frame === "team" ? TEAM_PAD : 0
    return { ...n, kids, rel, arts, grid, stacked, frame, pad, dy: 0, min: min - pad, max: max + pad }
  }
  const top = measure(root)

  // Rows: each as tall as its tallest stack of boxes with their artifact grids.
  const rowH = []
  const rows = (b) => {
    rowH[b.depth] = Math.max(rowH[b.depth] ?? 0, b.dy + blockH(b))
    b.kids.forEach(rows)
  }
  rows(top)
  const rowY = [0]
  for (let d = 1; d < rowH.length; d++) rowY[d] = rowY[d - 1] + rowH[d - 1] + ROW_GAP

  // Pass 2, top-down: absolute places; frames close bottom-up.
  const nodes = []
  const edges = []
  const frames = []
  const place = (b, cx, parent, desk) => {
    const inDesk = b.desk ?? desk
    const y = rowY[b.depth] + b.dy
    const agent = { id: b.name, kind: "agent", x: cx - AGENT_W / 2, y, w: AGENT_W, h: AGENT_H, depth: b.depth, parent, desk: inDesk, title: b.title, team: b.team }
    const mine = [agent]
    nodes.push(agent)
    const gx = cx - b.grid.w / 2
    const gy = y + AGENT_H + ARTIFACT_TOP
    b.arts.forEach((a, i) => {
      const node = {
        id: a.id,
        kind: "artifact",
        owner: b.name,
        view: a.view ?? null,
        x: gx + (i % b.grid.cols) * (ARTIFACT_W + ARTIFACT_GAP),
        y: gy + Math.floor(i / b.grid.cols) * (ARTIFACT_H + ARTIFACT_GAP),
        w: ARTIFACT_W,
        h: ARTIFACT_H,
      }
      nodes.push(node)
      mine.push(node)
    })
    // The trunk: straight down from the face, between the artifact columns — or, with one column of them under
    // the lead, out at the face to a rail beside the lead and its artifacts.
    const trunk = b.grid.cols === 1 ? Math.min(cx - AGENT_W / 2, gx) - RAIL_GAP : cx
    b.kids.forEach((k, i) => {
      const kx = cx + b.rel[i]
      const ky = rowY[k.depth] + k.dy
      const bar = rowY[k.depth] - ROW_GAP / 2
      const start = [[cx, y + STEM_Y], [trunk, y + STEM_Y], [trunk, bar]]
      // A stacked member: down the rail beside its column, in at its face; else down onto its top.
      const rail = kx - AGENT_W / 2 - RAIL_GAP
      const end = b.stacked.has(k.name) ? [[rail, bar], [rail, ky + STEM_Y], [kx, ky + STEM_Y]] : [[kx, bar], [kx, ky]]
      edges.push({ from: b.name, to: k.name, points: simplify([...start, ...end]) })
      mine.push(place(k, kx, b.name, inDesk))
    })
    const box = union(mine)
    if (!b.frame) return box
    const frame = { x: box.x - b.pad, y: box.y - b.pad - LABEL_H, w: box.w + 2 * b.pad, h: box.h + 2 * b.pad + LABEL_H }
    frames.push(b.frame === "desk" ? { kind: "desk", desk: b.desk, lead: b.name, ...frame } : { kind: "team", team: b.team ?? b.name, title: b.title ?? b.team ?? b.name, lead: b.name, ...frame })
    return frame
  }
  place(top, -top.min, null, null)

  return { nodes, edges, frames, bounds: union([...nodes, ...frames]), wrap: perRow }
}

// An orthogonal path without repeated points or straight-through corners.
function simplify(points) {
  const out = []
  for (const p of points) {
    if (out.length && out.at(-1)[0] === p[0] && out.at(-1)[1] === p[1]) continue
    if (out.length >= 2) {
      const [a, b] = out.slice(-2)
      if ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1])) out.pop()
    }
    out.push(p)
  }
  return out
}

// A node's rect at a zoom level: far and mid, an agent's card is CARD_H tall and its artifacts move up under it.
export function placeAt(node, level = "near") {
  const lift = AGENT_H - (CARD_H[level] ?? AGENT_H)
  if (!lift) return node
  return node.kind === "artifact" ? { ...node, y: node.y - lift } : { ...node, h: node.h - lift }
}

// The zoom at which a layout's bounds fill the viewport (padding inside), unclamped.
export const fitScale = (bounds, viewport, padding = 32) =>
  bounds.w && bounds.h ? Math.min((viewport.w - 2 * padding) / bounds.w, (viewport.h - 2 * padding) / bounds.h) : 0

// The layout that shows the whole desk largest in this viewport: side by side (no wrap), or teams of leaves wrapped
// into columns of 1 … the widest team. Ties keep the wider (tidier) one. Without a viewport: no wrap.
export function layoutToFit(tree, options = {}, viewport = null, padding = 32) {
  // viewport: {w, h} of the area the desk must fit in (the canvas less the controls over it)
  const wide = layoutDesk(tree, options)
  if (!viewport?.w || !viewport?.h || !wide.nodes.length) return wide
  let widest = 1
  const walk = (n) => {
    const kids = kidsOf(n)
    if (kids.length && kids.every((k) => !kidsOf(k).length)) widest = Math.max(widest, kids.length)
    kids.forEach(walk)
  }
  walk(tree)
  let best = wide
  let bestZ = fitScale(wide.bounds, viewport, padding)
  for (let wrap = widest - 1; wrap >= 1; wrap--) {
    const layout = layoutDesk(tree, { ...options, wrap })
    const z = fitScale(layout.bounds, viewport, padding)
    if (z > bestZ + 1e-9) [best, bestZ] = [layout, z]
  }
  return best
}

// The rect of one node by id (agent name or artifact id), or null.
export function nodeRect(layout, id, kind = "agent") {
  return layout?.nodes.find((n) => n.id === id && n.kind === kind) ?? null
}
