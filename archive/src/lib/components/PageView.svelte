<script>
  // A route rendered purely from its page tree (world.ui[view], else the default tree).
  import { setContext } from "svelte";
  import { store } from "../store.svelte.js";
  import { pageTree } from "../logic/page.js";
  import Node from "../primitives/Node.svelte";
  let { view } = $props();
  setContext("pageView", view);
  const tree = $derived(pageTree(store.world, view));
</script>
<Node node={tree} />
