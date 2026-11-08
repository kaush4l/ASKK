<script>
  import { getContext } from "svelte";
  import { store } from "../store.svelte.js";
  import { fieldBody } from "../logic/form.js";
  let { label, name = "value", value = "", action, target, args = {}, kind = "text" } = $props();
  const owner = getContext("owner");
  // the submit button says what it does: the action's own word (run → Run, reply → Reply)
  const verb = $derived(String(action ?? "save").split(".").pop().replace(/^./, (c) => c.toUpperCase()));
  let draft = $state("");
  $effect(() => { draft = value; });
  async function submit(e) {
    e.preventDefault();
    const sent = draft;
    await store.act(target ?? owner, action, fieldBody(args, name, sent, kind));
    if (draft === sent) draft = value; // sent: back to the object's own value (empty for an input)
  }
</script>
<form onsubmit={submit}>
  <label><span>{label}</span>
    {#if kind === "number"}<input type="number" bind:value={draft} />{:else}<input type="text" bind:value={draft} />{/if}
  </label>
  <button type="submit">{verb}</button>
</form>
<style>
  form{display:flex;gap:var(--space-2);align-items:flex-end;min-width:0}label{display:flex;flex-direction:column;gap:var(--space-1);flex:1;min-width:0;font-size:var(--text-sm);color:var(--muted)}
  input{font-size:var(--text-md);min-height:var(--control-md);padding:0 var(--space-3);border:var(--line-hair) solid var(--border);border-radius:var(--radius-sm);background:color-mix(in oklab,var(--bg) 60%,transparent);color:var(--fg);min-width:0}input:focus-visible{outline:var(--line-bold) solid var(--press);outline-offset:var(--line-hair)}
  button{min-height:var(--control-md);padding:0 var(--space-3);border:var(--line-hair) solid var(--press);border-radius:var(--radius-sm);background:var(--press);color:var(--press-ink);font:inherit;cursor:pointer}
</style>
