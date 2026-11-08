<script>
  // /focus?id=… — large: the immersive full-screen scene of one object (linkable). The backdrop is the page's own
  // background, intensified; the object's `large` view lays itself out by its `scene`. Escape, Close or back return.
  import { page } from "$app/state";
  import { focusId } from "$lib/logic/focus.js";
  import Immersive from "$lib/components/Immersive.svelte";
  import Node from "$lib/primitives/Node.svelte";
  import { store } from "$lib/store.svelte.js";
  // the page's own Panel node (from the dashboard tree) stays beside the scene, so navigation is never lost
  const findPanel = (n) => !n ? null : n.c === "Panel" ? n : (n.children ?? []).map(findPanel).find(Boolean) ?? null;
  const panel = $derived(findPanel(store.world?.ui?.dashboard));
  const id = $derived(focusId(page.url));
</script>
{#if panel}<Node node={panel} />{/if}
{#if id}{#key id}<Immersive {id} />{/key}{:else}<p class="muted miss">No object named: /focus?id=&lt;object id&gt;</p>{/if}
<style>.miss{padding:var(--space-4)}</style>
