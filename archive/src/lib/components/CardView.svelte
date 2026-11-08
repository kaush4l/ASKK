<script>
  // One object's card at a size picked from space (its measured width), the device, the canvas zoom or a fixed base,
  // unless the owner stepped it (remembered per object in the page's layout). A size change morphs in place: the
  // height animates from the old to the new, the content fades in; under reduced motion it just changes.
  import { setContext, getContext } from "svelte";
  import { store } from "../store.svelte.js";
  import { autoSize, stepSize, resolveSize } from "../logic/sizes.js";
  import { ms, CALM } from "../logic/motion.js";
  import { nextSize, gridSize, openMode, openFocus, focusHref } from "../logic/focus.js";
  import { goto } from "$app/navigation";
  import ObjectView from "../primitives/ObjectView.svelte";
  let { id, size = "auto", zoom = null, depth = 0 } = $props();
  const view = getContext("pageView") ?? "dashboard";
  let width = $state(0), viewport = $state(globalThis.innerWidth ?? 1440), el;
  // the containers above hand down presentation defaults (nearest first): `cascade` context, see sizes.js
  const cascade = getContext("cascade");
  const auto = $derived(autoSize({ width, viewport, zoom }));
  const chosen = $derived(store.world?.layouts?.[view]?.sizes?.[id]);
  // on the canvas, the zoom's legible size caps whatever the cascade or the owner chose
  const capper = getContext("sizeCap");
  const cur = $derived(resolveSize({ chosen, chain: cascade?.chain ?? [], kind: store.find(id)?.kind, base: size, auto, cap: capper?.size ?? null }));
  // on the widget grid only icon and small take a place: medium expands the card INTO the content area, large opens
  // the immersive scene (/focus?id=…); out of the grid (the featured engine) the card keeps its size in place
  const widget = getContext("widget") ?? false;
  const shown = $derived(widget ? gridSize(cur) : cur);
  const open = (size) => {
    const mode = openMode(size);
    if (mode === "immersive") { if (el) el.style.viewTransitionName = "focus-card"; goto(focusHref(id)); return; }
    const r = el?.getBoundingClientRect();
    store.focus = openFocus(store.focus, { id, size, from: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null });
  };
  setContext("sizer", {
    get size() { return shown; },
    get inPlace() { return !widget; },
    step: (d) => store.setSize(view, id, stepSize(cur, d), auto),
    /** the one size control: icon → small → medium (expand) → large (immersive) → icon */
    cycle: () => { const n = nextSize(shown); if (openMode(n)) open(n); else store.setSize(view, id, n, auto); },
    open,
  });
  let before = null;
  $effect.pre(() => { shown; before = el ? el.getBoundingClientRect().height : null; });
  $effect(() => {
    shown;
    if (!el || before == null) return;
    const d = ms("calm"), h = el.getBoundingClientRect().height;
    if (!d || Math.abs(h - before) < 1) return;
    const node = el; // the card may be gone (a zoom swaps sizes fast) before the morph ends
    node.style.overflow = "hidden";
    const a = node.animate([{ height: before + "px" }, { height: h + "px" }], { duration: d, easing: CALM });
    node.firstElementChild?.animate?.([{ opacity: 0.35 }, { opacity: 1 }], { duration: d, easing: CALM });
    a.onfinish = a.oncancel = () => { node.style.overflow = ""; };
  });
</script>
<svelte:window onresize={() => (viewport = window.innerWidth)} />
<div class="cv" bind:this={el} bind:clientWidth={width} data-object={id} data-size={shown} class:out={store.focus?.id === id}>
  {#key id}<ObjectView {id} at={shown} {depth} />{/key}
</div>
<style>.cv{min-width:0;display:flex;flex-direction:column;transition:opacity var(--motion-calm) var(--ease-calm)}.cv.out{opacity:.25}.cv > :global(*){min-width:0}</style>
