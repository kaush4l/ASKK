<script>
  // The immersive scene (design-rules §7, docs/glass.md): a full-viewport layer over the page's background made
  // deeper and more vivid; the object's large view floats in it as one sheet of glass laid out per component.
  import { setContext } from "svelte";
  import { goto, afterNavigate } from "$app/navigation";
  import { store } from "../store.svelte.js";
  import { pageTree } from "../logic/page.js";
  import Background from "../primitives/Background.svelte";
  import ObjectView from "../primitives/ObjectView.svelte";
  let { id } = $props();
  const bg = $derived(pageTree(store.world, "dashboard")?.props?.background ?? null);
  const obj = $derived(store.find(id));
  // back where we came from (an in-app open), else home
  let from = null;
  afterNavigate((n) => { if (n.from) from = n.from; });
  const close = () => (from ? history.back() : goto("/"));
  setContext("sizer", { get size() { return "large"; }, inPlace: false, cycle: () => { store.setSize("dashboard", id, "icon", null); close(); }, open: () => {}, close });
  setContext("pageView", "dashboard");
</script>
<svelte:window onkeydown={(e) => { if (e.key === "Escape" && !store.sheet) close(); }} />
<div class="scene" role="region" aria-label="{obj?.title ?? id} — full screen">
  <div class="wall">{#if bg}<Background {...bg} />{/if}</div>
  <div class="deep" aria-hidden="true"></div>
  <div class="stage glass">
    {#if obj}<ObjectView {id} at="large" />{:else}<p class="muted">No object {id}.</p><button class="btn" onclick={close}>Back</button>{/if}
  </div>
</div>
<style>
  .scene{position:fixed;inset:0 0 0 var(--shell,0);z-index:60;display:grid;padding:var(--space-5);view-transition-name:focus-card;background:var(--bg)}
  /* the backdrop: the page background intensified — more saturated and brighter fields, a soft vignette */
  .wall{position:absolute;inset:0;filter:saturate(170%) brightness(1.15)}
  .wall :global(.bg){position:absolute}
  .deep{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 40%,transparent 40%,color-mix(in oklab,var(--bg) 55%,transparent))}
  .stage{position:relative;min-height:0;border-radius:calc(var(--radius-lg) + var(--space-1));display:flex;flex-direction:column;overflow:hidden;
    background:linear-gradient(180deg,color-mix(in oklab,var(--edge) 26%,transparent),transparent 30%),color-mix(in oklab,var(--tint) var(--glass-deep),transparent)}
  .stage > :global(.card){flex:1;min-height:0;background:transparent;border:0;box-shadow:none}
  .stage > :global(.card > .main){flex:1;min-height:0}
  @media (max-width:768px){.scene{padding:var(--space-2)}}
  @media (prefers-reduced-transparency: reduce){.stage{background:var(--tint)}.wall{filter:none}}
</style>
