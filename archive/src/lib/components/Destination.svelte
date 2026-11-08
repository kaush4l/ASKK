<script>
  // A shell destination (Models, Theme, Page, an engine): it owns the whole centre. The view's own Panel node stays
  // on the left and its background behind; the dashboard's cards and the canvas are not rendered at all.
  import { setContext } from "svelte";
  import { store } from "../store.svelte.js";
  import { pageTree, findNode } from "../logic/page.js";
  import Node from "../primitives/Node.svelte";
  import Background from "../primitives/Background.svelte";
  let { view = "dashboard", label, children } = $props();
  setContext("pageView", view);
  const tree = $derived(pageTree(store.world, view));
  const panel = $derived(findNode(tree, "Panel")?.node ?? null);
  const bg = $derived(tree?.props?.background ?? null);
</script>
{#if bg}<Background {...bg} />{/if}
{#if panel}<Node node={panel} />{/if}
<section class="dest" aria-label={label}><div class="body pane">{@render children?.()}</div></section>
<style>
  .dest{position:relative;z-index:1;flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;padding:var(--space-4)}
  .body{flex:1;min-height:0;overflow:auto;padding:var(--space-3) var(--space-4)}
  @media (max-width:600px){.dest{padding:var(--space-2)}}
</style>
