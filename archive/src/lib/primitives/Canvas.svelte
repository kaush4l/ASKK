<script>
  // The page tree's `Canvas` (contract §6, design-rules §11): an infinite dotted grid over the page background;
  // every engine a glass frame (tidy-tree auto-layout until the owner drags one: saved), elements as cards at the
  // zoom-picked size; curved edges parent → child and for every help.ask route (open asks highlighted). Pan with a
  // drag (inertia on release), zoom with the wheel or a pinch, the toolbar (− + Fit) and the minimap. Every prop
  // comes from data/ui/canvas.json: grid, minimap, edges (curve | straight | step | none), zoom thresholds.
  import { untrack } from "svelte";
  import { store } from "../store.svelte.js";
  import { autoLayout, edgesFrom, edgePath, fitView, zoomAt, centreOn, coast, bounds, flatten, ownerPin, estimateSize, FRAME_W, EDGE_STYLES, canvasSize, showsTitle } from "../logic/canvas.js";
  import { reduced, MOTION } from "../logic/motion.js";
  import CanvasFrame from "../components/CanvasFrame.svelte";
  import { getContext, setContext } from "svelte";
  let { source = "engines", zoom = undefined, grid = true, minimap = true, edges = "curve", cascade: kids = null } = $props();
  const outer = getContext("cascade");
  const byId = $derived(Object.fromEntries(nodes.map((n) => [n.id, n])));
  /** the defaults above an engine: its ancestors' children: (nearest first), then the page tree's */
  const chainOf = (n) => { const out = []; for (let p = byId[n.parent]; p; p = byId[p.parent]) if (p.engine.children_defaults) out.push(p.engine.children_defaults); return [...out, kids, ...(outer?.chain ?? [])].filter(Boolean); };

  const style = $derived(EDGE_STYLES.includes(edges) ? edges : "curve");
  let cam = $state({ x: 0, y: 0, z: 1 });
  let vw = $state(0), vh = $state(0), viewport;
  // the zoom picks the size; legibility caps it (no text under 10 px on screen): icon, then the far frame
  const at = $derived(canvasSize(cam.z, zoom ?? undefined));
  const titled = $derived(showsTitle(cam.z));
  let wrap = $state(Infinity);
  setContext("sizeCap", { get size() { return at === "far" ? "icon" : at; } });
  const engines = $derived(source === "engines" ? store.world?.engines ?? [] : []);
  const nodes = $derived(flatten(engines));
  const saved = $derived(store.world?.layouts?.canvas?.positions ?? {});
  let local = $state({});
  let heights = $state({});
  const sizes = $derived(Object.fromEntries(nodes.map((n) => [n.id, { w: FRAME_W[at], h: heights[n.id] || estimateSize(n.engine, at).h }])));
  const rects = $derived(autoLayout(engines, { saved: { ...saved, ...local }, sizes, at, wrap }));
  const lines = $derived(style === "none" ? [] : edgesFrom(engines));
  const pins = $derived([...new Set(lines.filter((l) => l.to === "owner").map((l) => l.from))]);
  let selected = $state(null);

  // ── camera motion ──
  let anim = 0;
  function glide(to, done) {
    cancelAnimationFrame(anim);
    if (reduced()) { cam = to; done?.(); return; }
    const from = { ...cam }, t0 = performance.now(), d = MOTION.slow;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / d), e = 1 - (1 - k) ** 3;
      cam = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, z: from.z + (to.z - from.z) * e };
      if (k < 1) anim = requestAnimationFrame(step); else done?.();
    };
    anim = requestAnimationFrame(step);
  }
  // Fit: the largest legible size whose layout fits (fitView); once the frames are measured at that size, the
  // camera is fitted again to their real sizes (a re-layout when sizes change)
  const sizesFor = (s) => (s === at ? sizes : {});
  const fitNow = () => fitView(engines, vw, vh, { saved: { ...saved, ...local }, sizesFor, zoom: zoom ?? undefined });
  // after a fit lands, the frames are read at their real sizes and the camera fits again (at most twice)
  function settle(n = 2) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!viewport) return;
      const h = { ...heights };
      for (const el of viewport.querySelectorAll(".placed[data-id]")) h[el.dataset.id] = el.offsetHeight;
      heights = h;
      const before = at, v = fitNow();
      wrap = v.wrap; cam = v.cam;
      if (n > 1 && v.at !== before) settle(n - 1);
    }));
  }
  function fit() { const v = fitNow(); wrap = v.wrap; glide(v.cam, () => settle()); }
  const zoomBy = (f) => glide(zoomAt(cam, f, vw / 2, vh / 2));
  let fitted = false;
  $effect(() => { if (!fitted && vw > 0 && nodes.length) { fitted = true; untrack(() => { const v = fitNow(); wrap = v.wrap; cam = v.cam; settle(); }); } });

  // ── pointers: pan, pinch, drag a frame ──
  const pts = new Map();
  let gesture = null, vel = { x: 0, y: 0 }, last = 0;
  const local01 = (e) => { const r = viewport.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function down(e) {
    if (e.target.closest("[data-frame]") || e.target.closest(".tools,.mini")) return;
    cancelAnimationFrame(anim);
    viewport.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, local01(e));
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      gesture = { kind: "pinch", d: Math.hypot(a.x - b.x, a.y - b.y), m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, cam: { ...cam } };
    } else {
      gesture = { kind: "pan", s: local01(e), cam: { ...cam } };
      vel = { x: 0, y: 0 }; last = performance.now();
    }
  }
  function grab(e, id) {
    if (e.button > 0 || e.target.closest("button,input,select,textarea,a")) return;
    e.stopPropagation();
    cancelAnimationFrame(anim);
    viewport.setPointerCapture(e.pointerId);
    const r = rects[id];
    gesture = { kind: "frame", id, s: local01(e), o: { x: r.x, y: r.y }, moved: false };
  }
  function move(e) {
    if (!gesture) return;
    const p = local01(e);
    if (gesture.kind === "frame") {
      const dx = p.x - gesture.s.x, dy = p.y - gesture.s.y;
      if (!gesture.moved && Math.hypot(dx, dy) < 4) return;
      gesture.moved = true;
      local[gesture.id] = { x: Math.round(gesture.o.x + dx / cam.z), y: Math.round(gesture.o.y + dy / cam.z) };
      return;
    }
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, p);
    if (gesture.kind === "pinch" && pts.size >= 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const z = zoomAt(gesture.cam, d / Math.max(1, gesture.d), gesture.m.x, gesture.m.y);
      cam = { x: z.x + (m.x - gesture.m.x), y: z.y + (m.y - gesture.m.y), z: z.z };
    } else if (gesture.kind === "pan") {
      const now = performance.now(), nx = gesture.cam.x + p.x - gesture.s.x, ny = gesture.cam.y + p.y - gesture.s.y;
      const dt = Math.max(1, now - last);
      vel = { x: ((nx - cam.x) / dt) * 16, y: ((ny - cam.y) / dt) * 16 };
      last = now;
      cam = { ...cam, x: nx, y: ny };
    }
  }
  function up(e) {
    pts.delete(e.pointerId);
    const g = gesture;
    if (g?.kind === "frame") {
      gesture = null;
      if (g.moved) store.saveLayout("canvas", { ...(store.world?.layouts?.canvas ?? {}), positions: { ...saved, ...local } });
      else pick(g.id);
      return;
    }
    if (g?.kind === "pinch" && pts.size === 1) { const [p] = pts.values(); gesture = { kind: "pan", s: p, cam: { ...cam } }; return; }
    if (pts.size) return;
    gesture = null;
    if (g?.kind === "pan") {
      const moved = Math.hypot(cam.x - g.cam.x, cam.y - g.cam.y);
      if (moved < 3) { selected = null; return; }
      if (reduced() || performance.now() - last > 80) return;
      let v = vel;
      const tick = () => { v = coast(v); if (!v) return; cam = { ...cam, x: cam.x + v.x, y: cam.y + v.y }; anim = requestAnimationFrame(tick); };
      anim = requestAnimationFrame(tick);
    }
  }
  function wheel(e) {
    e.preventDefault();
    cancelAnimationFrame(anim);
    const p = local01(e);
    const trackpadPan = !e.ctrlKey && (e.deltaX !== 0 || (e.deltaMode === 0 && Math.abs(e.deltaY) < 40 && !Number.isInteger(e.deltaY)));
    if (trackpadPan || e.shiftKey) cam = { ...cam, x: cam.x - (e.shiftKey ? e.deltaY : e.deltaX), y: cam.y - (e.shiftKey ? 0 : e.deltaY) };
    else cam = zoomAt(cam, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), p.x, p.y);
  }
  function pick(id) { selected = id; store.sheet = id; }
  function key(e) {
    const step = 60;
    const k = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (k && e.target === viewport) { e.preventDefault(); glide({ ...cam, x: cam.x + k[0], y: cam.y + k[1] }); }
    else if ((e.key === "+" || e.key === "=") && e.target === viewport) zoomBy(1.25);
    else if (e.key === "-" && e.target === viewport) zoomBy(0.8);
    else if (e.key === "0" && e.target === viewport) fit();
  }

  // ── minimap ──
  const world = $derived(bounds(rects));
  const view = $derived({ x: -cam.x / cam.z, y: -cam.y / cam.z, w: vw / cam.z, h: vh / cam.z });
  const mm = $derived.by(() => {
    if (!world) return null;
    let x = Math.min(world.x, view.x), y = Math.min(world.y, view.y);
    let w = Math.max(world.x + world.w, view.x + view.w) - x, h = Math.max(world.y + world.h, view.y + view.h) - y;
    // the minimap keeps one shape (MINI_RATIO): the shorter side of the world box grows to it, centred
    if (h / w > MINI_RATIO) { const nw = h / MINI_RATIO; x -= (nw - w) / 2; w = nw; } else { const nh = w * MINI_RATIO; y -= (nh - h) / 2; h = nh; }
    const pct = (r) => ({ l: ((r.x - x) / w) * 100, t: ((r.y - y) / h) * 100, w: (r.w / w) * 100, h: (r.h / h) * 100 });
    return { x, y, w, h, pct };
  });
  let mini;
  function miniGo(e) {
    if (!mm) return;
    e.stopPropagation();
    const r = mini.getBoundingClientRect();
    const wx = mm.x + ((e.clientX - r.left) / r.width) * mm.w, wy = mm.y + ((e.clientY - r.top) / r.height) * mm.h;
    if (e.type === "pointerdown") { mini.setPointerCapture(e.pointerId); glide(centreOn(cam, wx, wy, vw, vh)); }
    else if (e.buttons) { cancelAnimationFrame(anim); cam = centreOn(cam, wx, wy, vw, vh); }
  }
  const MINI_RATIO = 0.66;
  const pctStyle = (p) => `left:${p.l}%;top:${p.t}%;width:${p.w}%;height:${p.h}%`;
</script>

<div class="vp" class:grid bind:this={viewport} bind:clientWidth={vw} bind:clientHeight={vh} tabindex="0"
  style:--cx="{cam.x}px" style:--cy="{cam.y}px" style:--z={cam.z} class:dense={cam.z < 0.4}
  onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onwheel={wheel} onkeydown={key}
  role="application" aria-label="Canvas: drag to pan, wheel or pinch to zoom, 0 fits">
  <div class="world" style:transform="translate({cam.x}px,{cam.y}px) scale({cam.z})">
    <svg class="edges" aria-hidden="true">
      <defs>
        <marker id="cv-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1L9 5L0 9z" class="tip" /></marker>
        <marker id="cv-arrow-ask" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1L9 5L0 9z" class="tip ask" /></marker>
      </defs>
      {#each lines as l (l.id)}
        {@const d = edgePath(l, rects[l.from], rects[l.to], style)}
        {#if d}<path {d} class="edge {l.kind}" class:open={l.open} marker-end={l.kind === "ask" ? "url(#cv-arrow-ask)" : "url(#cv-arrow)"}><title>{l.kind === "ask" ? `ask ${l.ask}${l.open ? " (open)" : ""}${l.question ? `: ${l.question}` : ""}` : `${l.from} → ${l.to}`}</title></path>{/if}
      {/each}
    </svg>
    {#each pins as id (id)}
      {@const r = rects[id]}
      {#if r}{@const p = ownerPin(r)}<span class="pin glass" style:left="{p.x}px" style:top="{p.y}px">You</span>{/if}
    {/each}
    {#each nodes as n (n.id)}
      {@const r = rects[n.id]}
      {#if r}
        <div class="placed" data-id={n.id} class:moving={gesture?.kind === "frame" && gesture.id === n.id} style:left="{r.x}px" style:top="{r.y}px" style:width="{r.w}px" bind:clientHeight={heights[n.id]}>
          <CanvasFrame engine={n.engine} {at} {titled} depth={n.depth} parent={n.parent} chain={chainOf(n)} selected={selected === n.id}
            ongrab={(e) => grab(e, n.id)} onpick={() => pick(n.id)} />
        </div>
      {/if}
    {/each}
  </div>

  {#if minimap && mm}
    <div class="mini glass" bind:this={mini} onpointerdown={miniGo} onpointermove={miniGo} role="slider" tabindex="-1" aria-label="Minimap" aria-valuenow={Math.round(cam.z * 100)}>
      {#each nodes as n (n.id)}{@const r = rects[n.id]}{#if r}<i class="mm-frame" class:busy={n.engine.phase === "running" || n.engine.phase === "waiting"} class:failed={n.engine.phase === "failed"} style={pctStyle(mm.pct(r))}></i>{/if}{/each}
      <i class="mm-view" style={pctStyle(mm.pct(view))}></i>
    </div>
  {/if}
  <div class="tools glass" role="toolbar" aria-label="Canvas zoom">
    <button class="btn" onclick={() => zoomBy(0.8)} aria-label="Zoom out">−</button>
    <span class="z mono" title="cards at {at}">{Math.round(cam.z * 100)}%</span>
    <button class="btn" onclick={() => zoomBy(1.25)} aria-label="Zoom in">+</button>
    <button class="btn" onclick={fit} aria-label="Fit everything">Fit</button>
  </div>
</div>

<style>
  .vp{position:relative;flex:1;height:100dvh;overflow:clip;touch-action:none;cursor:grab;outline:none;
    --dot:calc(var(--background-dot) * var(--z));--major:calc(var(--background-grid) * var(--z))}
  .vp:active{cursor:grabbing}
  .vp:focus-visible{box-shadow:inset 0 0 0 var(--line-bold) var(--press)}
  /* the infinite backdrop: dots on the minor step, faint lines on the major one, both moving with the camera */
  .vp.grid{background-image:
      radial-gradient(circle,color-mix(in oklab,var(--fg) 22%,transparent) var(--line-hair),transparent calc(var(--line-hair) * 1.6)),
      linear-gradient(color-mix(in oklab,var(--fg) 6%,transparent) var(--line-hair),transparent var(--line-hair)),
      linear-gradient(90deg,color-mix(in oklab,var(--fg) 6%,transparent) var(--line-hair),transparent var(--line-hair));
    background-size:var(--dot) var(--dot),var(--major) var(--major),var(--major) var(--major);
    background-position:var(--cx) var(--cy),var(--cx) var(--cy),var(--cx) var(--cy)}
  .vp.grid.dense{background-image:
      linear-gradient(color-mix(in oklab,var(--fg) 8%,transparent) var(--line-hair),transparent var(--line-hair)),
      linear-gradient(90deg,color-mix(in oklab,var(--fg) 8%,transparent) var(--line-hair),transparent var(--line-hair));
    background-size:var(--major) var(--major),var(--major) var(--major);background-position:var(--cx) var(--cy),var(--cx) var(--cy)}
  .world{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}
  .placed{position:absolute;transition:left var(--motion-calm) var(--ease-calm),top var(--motion-calm) var(--ease-calm)}
  .placed.moving{transition:none;z-index:2}
  .edges{position:absolute;left:0;top:0;width:var(--line-hair);height:var(--line-hair);overflow:visible;pointer-events:none}
  .edge{fill:none;stroke:color-mix(in oklab,var(--fg) 45%,transparent);stroke-width:var(--line-bold);vector-effect:non-scaling-stroke;pointer-events:stroke}
  .edge.ask{stroke:color-mix(in oklab,var(--accent) 45%,transparent);stroke-dasharray:var(--space-1) var(--space-1)}
  .edge.ask.open{stroke:var(--accent);stroke-width:calc(var(--line-bold) * 1.5);stroke-dasharray:var(--space-2) var(--space-1);animation:flow var(--motion-pulse) linear infinite;
    filter:drop-shadow(0 0 var(--space-1) color-mix(in oklab,var(--accent) 60%,transparent))}
  @keyframes flow{to{stroke-dashoffset:calc(var(--space-3) * -1)}}
  .tip{fill:color-mix(in oklab,var(--fg) 40%,transparent)}.tip.ask{fill:var(--accent)}
  .pin{position:absolute;transform:translate(-50%,-100%);font-size:max(var(--text-sm),calc(var(--text-xs) / var(--z)));color:var(--accent);border-color:var(--accent);border-radius:var(--radius-full);padding:var(--space-1) var(--space-3);white-space:nowrap}
  .tools{position:absolute;right:var(--space-4);bottom:calc(max(var(--space-4),env(safe-area-inset-bottom)) + var(--composer,var(--space-0)));display:flex;gap:var(--space-1);align-items:center;border-radius:var(--radius-lg);padding:var(--space-1);z-index:3}
  .z{font-size:var(--text-xs);min-width:var(--control-lg);text-align:center}
  .mini{position:absolute;left:var(--space-4);bottom:calc(max(var(--space-4),env(safe-area-inset-bottom)) + var(--composer,var(--space-0)));width:var(--width-sm);height:calc(var(--width-sm) * .66);border-radius:var(--radius-md);overflow:hidden;cursor:crosshair;z-index:3;touch-action:none}
  .mini i{position:absolute;display:block;border-radius:var(--line-bold)}
  .mm-frame{background:color-mix(in oklab,var(--fg) 30%,transparent)}
  .mm-frame.busy{background:var(--busy)}.mm-frame.failed{background:var(--error)}
  .mm-view{border:var(--line-bold) solid var(--press);background:color-mix(in oklab,var(--press) 12%,transparent)}
  @media (max-width:768px){
    .vp{height:calc(100dvh - var(--control-lg) - var(--space-4))}
    .mini{width:var(--width-xs);height:calc(var(--width-xs) * .66)}
    .tools .btn{min-width:var(--control-lg);min-height:var(--control-lg)}
  }
  @media (prefers-reduced-motion: reduce){.edge.ask.open{animation:none}.placed{transition:none}}
</style>
