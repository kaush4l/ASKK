<script>
  import { getContext } from "svelte";
  import { toneVar } from "../logic/tones.js";
  import { store } from "../store.svelte.js";
  let { label = "", action, target, args = {}, tone } = $props();
  const owner = getContext("owner");
  let busy = $state(false);
  async function go() { busy = true; await store.act(target ?? owner, action, args); busy = false; }
</script>
<button disabled={busy} style:--t={toneVar(tone)} onclick={go}>{label}</button>
<style>button{min-height:var(--control-md);min-width:var(--control-md);padding:0 var(--space-3);border:var(--line-hair) solid color-mix(in oklab,var(--t) 60%,var(--border));color:var(--fg);background:color-mix(in oklab,var(--tint) 50%,transparent);border-radius:var(--radius-sm);font:inherit;cursor:pointer;transition:background-color var(--motion-fast) var(--ease-out),transform var(--motion-fast) var(--ease-out)}button:hover{background:color-mix(in oklab,var(--t) 14%,transparent)}button:active:not(:disabled){transform:scale(.98)}button:disabled{opacity:.5;cursor:default}</style>
