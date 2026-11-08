<script>
  // The widget grid (contract §5/§6, design-rules §7): its children (Slots) are cards whose size is a footprint of
  // square cells — icon 1×1, small 2×2, medium 4×2, large 4×4 (tokens `span`). Token-sized cells, as many as fit
  // (never fewer than the widest span); on a phone, or in a narrow container, 4 columns across the full width.
  // Dense packing: mixed sizes tile without holes. A card never grows with its content: its body scrolls.
  import { setContext } from "svelte";
  import { widgetGrid, SPANS } from "../logic/widgets.js";
  import { PHONE_MAX } from "../logic/sizes.js";
  let { children } = $props();
  let w = $state(0), vw = $state(globalThis.innerWidth ?? 1440);
  const g = $derived(widgetGrid(w, { phone: vw <= PHONE_MAX }));
  setContext("widget", true);
</script>
<svelte:window onresize={() => (vw = window.innerWidth)} />
<div class="wrap" bind:clientWidth={w}>
  <div class="w" data-cols={g.cols} style:--cols={g.cols} style:--cell="{g.cell}px" style:--g="{g.gap}px"
    style:--ic={SPANS.icon.cols} style:--ir={SPANS.icon.rows} style:--sc={SPANS.small.cols} style:--sr={SPANS.small.rows}
    style:--mc={SPANS.medium.cols} style:--mr={SPANS.medium.rows} style:--lc={SPANS.large.cols} style:--lr={SPANS.large.rows}>
    {@render children?.()}
  </div>
</div>
<style>
  .wrap{min-width:0;width:100%}
  .w{display:grid;grid-template-columns:repeat(var(--cols),var(--cell));grid-auto-rows:var(--cell);gap:var(--g);grid-auto-flow:dense}
  .w > :global(*){min-width:0;min-height:0;height:100%}
  .w > :global(.item:has(> .cv[data-size="icon"])){grid-column:span var(--ic);grid-row:span var(--ir)}
  .w > :global(.item:has(> .cv[data-size="small"])){grid-column:span var(--sc);grid-row:span var(--sr)}
  .w > :global(.item:has(> .cv[data-size="medium"])){grid-column:span var(--mc);grid-row:span var(--mr)}
  .w > :global(.item:has(> .cv[data-size="large"])){grid-column:span var(--lc);grid-row:span var(--lr)}
  /* the card fills its footprint: header fixed, body scrolls (thin bar, faded edges); never grows with content */
  .w > :global(.item > .cv){flex:1;min-height:0}
  .w > :global(.item > .cv > .card){height:100%;overflow:hidden}
  .w > :global(.item > .cv > .card:not(.icon) > .body){flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:color-mix(in oklab,var(--fg) 25%,transparent) transparent;
    padding-block:var(--space-1);mask-image:linear-gradient(to bottom,transparent,var(--ink) var(--space-2),var(--ink) calc(100% - var(--space-2)),transparent)}
  /* the icon: a 2×2 app tile — the avatar on top, large and centred, the title below, controls inside it */
  .w > :global(.item > .cv > .card.icon){width:100%}
  .w > :global(.item > .cv > .card.icon .av){--s:min(var(--widget-avatar),calc(var(--cell) * 2 + var(--g) - var(--space-6) - var(--space-5)))}
  /* small: header, focus, own body and the actions list; only the body scrolls */
  .w > :global(.item > .cv > .card.small){padding:var(--space-3)}
</style>
