<script>
  // Cards of a source (today: the top engines, in saved order) in a grid that fills the width. Each card picks its
  // size from the width it gets (`size: auto`) or takes `size`; the owner steps and reorders. Moves animate (flip).
  // The page's `default` engine is featured: centred and wide (large); any other top engine is a smaller card below.
  import { flip } from "svelte/animate";
  import { store } from "../store.svelte.js";
  import { orderEngines, moveId, moveTo, dashboardGrid, featuredSplit } from "../logic/layout.js";
  import { defaultEngineId } from "../logic/composer.js";
  import { ms } from "../logic/motion.js";
  import { width, space, widthStep } from "../logic/scale.js";
  import CardView from "../components/CardView.svelte";
  import EditTools from "../components/EditTools.svelte";
  import EditPanel from "../components/EditPanel.svelte";
  let { source = "engines", size = "auto", min = "md", gap = 4, max = "page", cascade: kids = null } = $props();
  // the page tree's `children:` defaults reach every card below (the engine card and, through it, its slots)
  import { setContext, getContext } from "svelte";
  const page = getContext("page");
  setContext("cascade", { get chain() { return [kids].filter(Boolean); } });
  const engines = $derived(source === "engines" ? orderEngines(store.world.engines, store.world.layouts?.dashboard) : []);
  const grid = $derived(dashboardGrid(engines.length, { min: width(widthStep(min)), max: width(widthStep(max, "page")) }));
  let modes = $state({});
  let drag = $state(null);
  const shown = $derived(drag ? drag.ids.map((id) => engines.find((e) => e.id === id)).filter(Boolean) : engines);
  const split = $derived(featuredSplit(shown, defaultEngineId(store.world, { props: { default: page?.default } })));
  const restGrid = $derived(dashboardGrid(split.rest.length + 1, { min: width("sm"), max: width(widthStep(max, "page")) }));
  const save = (order) => store.saveLayout("dashboard", { ...(store.world.layouts?.dashboard ?? {}), order });
  const move = (id, d) => save(moveId(engines.map((e) => e.id), id, d));
  function key(e, id) {
    const d = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (d) { e.preventDefault(); move(id, d); requestAnimationFrame(() => document.querySelector(`[data-handle="${id}"]`)?.focus()); }
  }
  function down(e, id) { e.currentTarget.setPointerCapture(e.pointerId); drag = { id, ids: engines.map((x) => x.id), moved: false }; }
  function over(e) {
    if (!drag) return;
    const cell = document.elementsFromPoint(e.clientX, e.clientY).find((n) => n.dataset?.cell);
    if (!cell || cell.dataset.cell === drag.id) return;
    drag.ids = moveTo(drag.ids, drag.id, drag.ids.indexOf(cell.dataset.cell));
    drag.moved = true;
  }
  function up() { if (drag?.moved) save(drag.ids); drag = null; }
  $effect(() => { if (store.locked) modes = {}; });
</script>
{#snippet cell(e, sz)}
  {@const i = shown.indexOf(e)}
    {#if !store.locked}
      <div class="bar">
        <button class="handle" data-handle={e.id} aria-label="Reorder {e.title} (drag, or arrow keys)" title="Drag to reorder"
          onpointerdown={(ev) => down(ev, e.id)} onpointermove={over} onpointerup={up} onpointercancel={up} onkeydown={(ev) => key(ev, e.id)}>
          <svg class="ico sm" viewBox="0 0 16 16" aria-hidden="true"><g fill="currentColor"><circle cx="5" cy="4" r="1.3"/><circle cx="11" cy="4" r="1.3"/><circle cx="5" cy="8" r="1.3"/><circle cx="11" cy="8" r="1.3"/><circle cx="5" cy="12" r="1.3"/><circle cx="11" cy="12" r="1.3"/></g></svg>
        </button>
        <button class="tool" disabled={i === 0} onclick={() => move(e.id, -1)} aria-label="Move {e.title} earlier">←</button>
        <button class="tool" disabled={i === shown.length - 1} onclick={() => move(e.id, 1)} aria-label="Move {e.title} later">→</button>
        <span class="sp"></span>
        <EditTools obj={e} bind:mode={modes[e.id]} />
      </div>
      {#if modes[e.id]}<EditPanel obj={e} bind:mode={modes[e.id]} />{/if}
    {/if}
    <CardView id={e.id} size={sz} />
{/snippet}
{#if split.rest.length === 0}
  <div class="grid lone" style:--max={grid.max} style:--lone={grid.lone ?? "var(--width-wide)"} style:gap={space(gap, 4)}>
    {#each shown as e (e.id)}<div class="cell" data-cell={e.id} tabindex="-1" class:dragging={drag?.id === e.id} animate:flip={{ duration: ms("calm") }}>{@render cell(e, size)}</div>{/each}
  </div>
{:else}
  <div class="grid lone featured" style:--max={grid.max} style:--lone="var(--width-wide)" style:gap={space(gap, 4)}>
    {#each [split.featured] as e (e.id)}<div class="cell" data-cell={e.id} tabindex="-1" class:dragging={drag?.id === e.id} animate:flip={{ duration: ms("calm") }}>{@render cell(e, size)}</div>{/each}
  </div>
  <div class="grid rest" style:--max={restGrid.max} style:gap={space(gap, 4)} style:grid-template-columns={restGrid.columns}>
    {#each split.rest as e (e.id)}<div class="cell" data-cell={e.id} tabindex="-1" class:dragging={drag?.id === e.id} animate:flip={{ duration: ms("calm") }}>{@render cell(e, size === "auto" ? "small" : size)}</div>{/each}
  </div>
{/if}
<style>
  .grid{display:grid;padding:var(--space-4);margin:0 auto;max-width:var(--max);width:100%;align-items:start}
  .grid.lone{grid-template-columns:minmax(0,var(--lone));justify-content:center}
  .grid.featured{padding-bottom:0}
  @media (min-width:768px){.grid{padding:var(--space-5)}}
  .cell{min-width:0;display:flex;flex-direction:column;gap:var(--space-2);scroll-margin-top:var(--space-4);border-radius:var(--radius-md)}
  .cell:focus-visible{outline:var(--line-bold) solid var(--press);outline-offset:var(--space-1)}
  .dragging{opacity:.6}
  .bar{display:flex;align-items:center;gap:var(--space-1);flex-wrap:wrap}.sp{flex:1}
  .handle{flex:none;width:var(--control-md);height:var(--control-md);display:grid;place-items:center;border:var(--line-hair) solid var(--border);border-radius:var(--radius-sm);background:color-mix(in oklab,var(--tint) 60%,transparent);color:var(--muted);cursor:grab;touch-action:none}
  .handle:active{cursor:grabbing}.handle:focus-visible{outline:var(--line-bold) solid var(--press)}
  .tool{min-height:var(--control-md);min-width:var(--control-md);border:var(--line-hair) solid transparent;border-radius:var(--radius-sm);background:transparent;color:var(--muted);cursor:pointer}
  .tool:hover:not(:disabled){border-color:var(--border);color:var(--fg)}.tool:disabled{opacity:.3;cursor:default}
</style>
