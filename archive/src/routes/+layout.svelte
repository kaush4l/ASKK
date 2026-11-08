<script>
  import "../app.css";
  import { onMount } from "svelte";
  import { store } from "$lib/store.svelte.js";
  import { themeCss, withDefaults } from "$lib/logic/theme.js";
  import { page } from "$app/state";
  import Sheet from "$lib/components/Sheet.svelte";
  import FocusLayer from "$lib/components/FocusLayer.svelte";
  import { onNavigate } from "$app/navigation";
  import { routeOf } from "$lib/logic/routes.js";
  import { reduced } from "$lib/logic/motion.js";
  // large opens and closes with a zoom (View Transitions API: the card and the scene share one name); without the
  // API, or under reduced motion, it just changes
  onNavigate((nav) => {
    if (!document.startViewTransition || reduced()) return;
    return new Promise((resolve) => { document.startViewTransition(async () => { resolve(); await nav.complete; }); });
  });
  let { children } = $props();
  // every destination is a route (logic/routes.js): only "/" renders the dashboard, only "/canvas" the canvas
  const route = $derived(routeOf(page.url));
  const fit = $derived(route.kind === "dashboard");
  onMount(() => { store.start(); return () => store.stop(); });
  const css = $derived(store.world?.theme ? themeCss(withDefaults(store.world.theme)) : "");
  $effect(() => {
    let el = document.getElementById("ph-theme");
    if (!el) { el = document.createElement("style"); el.id = "ph-theme"; document.head.appendChild(el); }
    el.textContent = css;
  });
</script>
<main class:fit>
  {#if store.fixture}<div class="banner pane">Fixture data — the backend is unreachable. Actions are not sent.</div>{/if}
  {#if store.error}<div class="banner pane err" role="alert"><span>{store.error}</span><button class="btn" aria-label="Dismiss" onclick={() => (store.error = "")}>×</button></div>{/if}
  {#if store.world}{@render children()}{:else}<p class="muted pad">Connecting…</p>{/if}
</main>
<FocusLayer />
<Sheet />
<style>
  main{position:relative;z-index:1;min-height:100dvh;padding-left:var(--shell,0);display:flex;flex-direction:column}
  @media (max-width:600px){main{padding-top:calc(var(--control-lg) + var(--space-4))}}
  /* the dashboard's content scrolls in its own area that ends above the composer: nothing is ever under the bar */
  main.fit{height:100dvh;padding-bottom:var(--composer,var(--space-0));overflow:hidden}
  main.fit > :global(.page){flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;scroll-padding-bottom:var(--space-4)}
  .pad{padding:var(--space-4)}
  .banner{position:relative;z-index:2;margin:var(--space-3) var(--space-4) 0;padding:var(--space-2) var(--space-3);border-color:var(--warn);color:var(--warn);font-size:var(--text-sm);display:flex;align-items:center;justify-content:space-between;gap:var(--space-2)}
  .err{border-color:var(--error);color:var(--error)}
</style>
