<script>
  // Renders one object's own view at a size; the object is the owner for Button/Field.
  import { setContext, untrack } from "svelte";
  import { store } from "../store.svelte.js";
  import { viewAt } from "../logic/sizes.js";
  import Node from "./Node.svelte";
  let { id, at = "medium", depth = 0 } = $props();
  setContext("owner", untrack(() => id)); // callers key this view by id
  const obj = $derived(store.find(id));
</script>
{#if depth > 6}<span class="miss">slot too deep: {id}</span>
{:else if obj}<Node node={viewAt(obj.views, at)} />
{:else}<span class="miss">no object: {id}</span>{/if}
<style>.miss{color:var(--warn);font-size:var(--text-sm)}</style>
