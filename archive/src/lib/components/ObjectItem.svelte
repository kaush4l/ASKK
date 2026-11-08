<script>
  // One embedded object (a Slot's target, a canvas node): its card at the slot's size (the owner steps it), edit tools inline.
  import { store } from "../store.svelte.js";
  import { parentEngine } from "../logic/world.js";
  import CardView from "./CardView.svelte";
  import EditTools from "./EditTools.svelte";
  import EditPanel from "./EditPanel.svelte";
  import { getContext, setContext } from "svelte";
  let { id, at = "small", zoom = null } = $props();
  // an embedded card takes its own engine's `children:` defaults first, then its ancestors', then what is above
  const outer = getContext("cascade");
  setContext("cascade", { get chain() {
    const out = [];
    for (let e = parentEngine(store.world, id); e; e = parentEngine(store.world, e.id)) if (e.children_defaults) out.push(e.children_defaults);
    return [...out, ...(outer?.chain ?? [])];
  } });
  let mode = $state(null);
  const obj = $derived(store.find(id));
  const parent = $derived(parentEngine(store.world, id));
  $effect(() => { if (store.locked) mode = null; });
</script>
<div class="item" class:editing={!store.locked} class:failed={obj?.phase === "failed"}>
  <CardView {id} size={at} {zoom} />
  {#if !store.locked && obj}<div class="tools"><EditTools {obj} {parent} bind:mode /></div>{/if}
  {#if mode && obj}<div class="panel"><EditPanel {obj} {parent} bind:mode /></div>{/if}
</div>
<style>
  .item{display:flex;flex-direction:column;gap:var(--space-1);min-width:0;align-self:stretch;border-radius:var(--radius-md)}
  .failed{box-shadow:inset var(--line-bold) 0 0 var(--error)}
  .editing{outline:var(--line-hair) dashed color-mix(in oklab,var(--press) 45%,transparent);outline-offset:var(--line-bold)}
  .tools{display:flex;justify-content:flex-end}
  .panel{padding-left:var(--space-4)}
</style>
