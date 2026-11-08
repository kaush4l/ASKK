<script>
  // Edit-mode affordances inline on one object; which ones exist comes from the objects' actions.
  import { affordances } from "../logic/affordances.js";
  import { store } from "../store.svelte.js";
  let { obj, parent = null, mode = $bindable() } = $props();
  const tools = $derived(affordances(obj, parent));
  function pick(t) {
    if (t.key === "remove") {
      if (confirm(`Remove ${obj.title}?`)) store.act(t.target, t.action, { id: obj.id });
      return;
    }
    mode = mode === t.key ? null : t.key;
  }
</script>
{#if tools.length}
  <div class="tools" role="group" aria-label="Edit {obj.title}">
    {#each tools as t (t.key)}
      <button class="tool" class:on={mode === t.key} class:danger={t.key === "remove"} onclick={() => pick(t)}>{t.label}</button>
    {/each}
  </div>
{/if}
<style>
  .tools{display:flex;gap:var(--space-1);flex:none;flex-wrap:wrap;justify-content:flex-end}
  .tool{min-height:var(--control-md);min-width:var(--control-md);padding:0 var(--space-2);border:var(--line-hair) solid transparent;border-radius:var(--radius-sm);background:transparent;color:var(--muted);cursor:pointer;font-size:var(--text-sm);white-space:nowrap}
  .tool:hover,.tool:focus-visible{border-color:var(--border);color:var(--fg)}
  .tool.on{background:var(--press);border-color:var(--press);color:var(--press-ink)}
  .tool.danger:hover,.tool.danger:focus-visible{border-color:var(--error);color:var(--error)}
</style>
