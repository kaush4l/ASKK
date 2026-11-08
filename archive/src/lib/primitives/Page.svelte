<script>
  // A whole route as a tree (contract §6): its background, then its children (Panel, CardGrid, Canvas, Composer …).
  // `default` names the engine the page centres on and the Composer talks to (the first top engine when absent).
  import { setContext } from "svelte";
  import Background from "./Background.svelte";
  let { background = null, default: dflt = null, children } = $props();
  setContext("page", { get default() { return dflt; } });
</script>
{#if background}<Background {...background} />{/if}
<div class="page">{@render children?.()}</div>
<style>.page{position:relative;z-index:1;flex:1;display:flex;flex-direction:column;min-width:0}</style>
