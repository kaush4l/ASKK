<script>
  // The form for the affordance picked in EditTools (forms built from world.kinds[].config).
  import { untrack } from "svelte";
  import { store } from "../store.svelte.js";
  import { affordances } from "../logic/affordances.js";
  import ElementForm from "./ElementForm.svelte";
  import { SIZES } from "../logic/sizes.js";
  let { obj, parent = null, mode = $bindable() } = $props();
  const tool = $derived(affordances(obj, parent).find((t) => t.key === mode));
  let title = $state("");
  let emoji = $state(untrack(() => obj?.icon ?? ""));
  const PICKS = ["🧭", "🧠", "🔁", "🧰", "📚", "📝", "🛰️", "🧪", "🦉", "🌀", "⚡", "🔭"];
  const done = () => { mode = null; title = ""; };
  async function submitTitle(e) {
    e.preventDefault();
    if (!title.trim()) return;
    await store.act(tool.target, tool.action, { title: title.trim() });
    done();
  }
</script>
{#if tool?.key === "edit"}<ElementForm engine={tool.target} element={obj} {done} />
{:else if tool?.key === "add-element"}<ElementForm engine={obj.id} {done} />
{:else if tool?.key === "icon"}
  <form onsubmit={async (e) => { e.preventDefault(); await store.act(tool.target, tool.action, obj.elements ? { icon: emoji.trim() } : { id: obj.id, icon: emoji.trim() }); done(); }}>
    <div class="picks" role="group" aria-label="Pick an icon">{#each PICKS as p}<button type="button" class="pick" class:on={emoji === p} onclick={() => (emoji = p)}>{p}</button>{/each}</div>
    <!-- svelte-ignore a11y_autofocus -->
    <input aria-label="Icon (one emoji; empty = the kind's default)" placeholder="🧭" bind:value={emoji} autofocus />
    <button class="btn primary" type="submit">Set icon</button>
    <button class="btn" type="button" onclick={done}>Cancel</button>
  </form>
{:else if tool?.key === "children"}
  <form onsubmit={(e) => e.preventDefault()}>
    <label class="cs"><span>Children size</span>
      <select aria-label="Default size of {obj.title}'s children" value={obj.children_defaults?.size ?? "auto"}
        onchange={async (e) => { await store.act(obj.id, "engine.children", { size: e.currentTarget.value }); done(); }}>
        {#each ["auto", ...SIZES] as s}<option value={s}>{s}</option>{/each}
      </select></label>
    <button class="btn" type="button" onclick={done}>Close</button>
  </form>
{:else if tool?.key === "add-engine" || tool?.key === "rename"}
  <form onsubmit={submitTitle}>
    <!-- svelte-ignore a11y_autofocus -->
    <input aria-label={tool.key === "rename" ? "New title" : "Child engine title"} placeholder={tool.key === "rename" ? obj.title : "Child engine title"} bind:value={title} autofocus />
    <button class="btn primary" type="submit">{tool.key === "rename" ? "Rename" : "Add engine"}</button>
    <button class="btn" type="button" onclick={done}>Cancel</button>
  </form>
{/if}
<style>
  form{display:flex;gap:var(--space-2);flex-wrap:wrap;border:var(--line-hair) dashed color-mix(in oklab,var(--press) 60%,transparent);border-radius:var(--radius-sm);background:color-mix(in oklab,var(--tint) 60%,transparent);padding:var(--space-2)}
  .picks{display:flex;flex-wrap:wrap;gap:var(--space-1);width:100%}
  .pick{width:var(--control-md);height:var(--control-md);border:var(--line-hair) solid var(--border);border-radius:var(--radius-sm);background:transparent;cursor:pointer;font-size:var(--text-lg)}
  .pick.on{border-color:var(--accent);background:color-mix(in oklab,var(--accent) 16%,transparent)}
  .cs{display:flex;gap:var(--space-2);align-items:center;flex:1;font-size:var(--text-sm);color:var(--muted)}
  select{min-height:var(--control-md);padding:0 var(--space-2);border:var(--line-hair) solid var(--border);border-radius:var(--radius-sm);background:color-mix(in oklab,var(--bg) 60%,transparent);color:var(--fg)}
  input{flex:1 1 var(--width-xs);min-width:0;min-height:var(--control-md);padding:0 var(--space-3);border:var(--line-hair) solid var(--border);border-radius:var(--radius-sm);background:color-mix(in oklab,var(--bg) 60%,transparent)}
</style>
