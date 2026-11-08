<script>
  import { store } from "../store.svelte.js";
  import { withDefaults } from "../logic/theme.js";
  let { done } = $props();
  const orig = JSON.parse(JSON.stringify(store.world?.theme?.tokens ?? store.world?.theme ?? {}));
  // every token the design rules use, the saved ones first; new ones from DEFAULT_TOKENS
  let tokens = $state(withDefaults(JSON.parse(JSON.stringify(orig))));
  // live preview: the layout renders theme CSS from store.world.theme
  $effect(() => { if (store.world) store.world.theme = $state.snapshot(tokens); });
  const groups = $derived(Object.entries(tokens).filter(([, m]) => m && typeof m === "object"));
  const isColor = (v) => /^#[0-9a-f]{6}$/i.test(String(v));
  function set(group, k, v) { tokens[group][k] = v; }
  function cancel() { store.world.theme = orig; done(); }
  async function save() { await store.saveTheme($state.snapshot(tokens)); done(); }
</script>
<div class="te">
  {#each groups as [g, map]}
    <h3>{g}</h3>
    {#each Object.entries(map).filter(([, v]) => typeof v !== "object") as [k, v] (k)}
      <label><span>{k}</span>
        {#if isColor(v)}<input type="color" value={v} oninput={(e) => set(g, k, e.currentTarget.value)} />{/if}
        <input value={v} oninput={(e) => set(g, k, e.currentTarget.value)} />
      </label>
    {/each}
  {/each}
  <div class="row"><button class="btn primary" onclick={save}>Save theme</button><button class="btn" onclick={cancel}>Cancel</button></div>
</div>
<style>
  .te{display:flex;flex-direction:column;gap:var(--space-2)}h3{margin:var(--space-2) 0 0;font-weight:400;font-size:var(--text-md);color:var(--muted)}
  label{display:flex;gap:var(--space-2);align-items:center}label span{width:var(--width-label);font-family:var(--font-mono);font-size:var(--text-xs)}
  input{min-height:var(--control-md);flex:1;min-width:0;padding:0 var(--space-2);border:var(--line-hair) solid var(--border);border-radius:var(--radius-sm);background:color-mix(in oklab,var(--bg) 60%,transparent)}
  input[type=color]{flex:0 0 var(--control-lg);padding:var(--line-bold)}.row{display:flex;gap:var(--space-2);margin-top:var(--space-2)}
</style>
