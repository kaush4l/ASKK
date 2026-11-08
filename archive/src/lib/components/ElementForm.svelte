<script>
  // Add / edit an element; the form is built from world.kinds[].config.
  import { untrack } from "svelte";
  import { store } from "../store.svelte.js";
  import { formConfig, coerceConfig } from "../logic/form.js";
  let { engine, element = null, done } = $props();
  const kinds = $derived(store.world?.kinds ?? []);
  const init = untrack(() => element); // the form edits a copy taken once
  let kind = $state(init?.kind ?? store.world?.kinds?.[0]?.kind ?? "note");
  let title = $state(init?.title ?? "");
  let config = $state(formConfig(init, Object.entries(store.world?.kinds?.find((k) => k.kind === init?.kind)?.config ?? {})));
  const fields = $derived(Object.entries(kinds.find((k) => k.kind === kind)?.config ?? {}));
  const coerce = () => coerceConfig(fields, config);
  async function submit(e) {
    e.preventDefault();
    if (element) await store.act(engine, "element.edit", { id: element.id, title, config: coerce() });
    else await store.act(engine, "element.add", { kind, title, config: coerce() });
    done?.();
  }
</script>
<form onsubmit={submit}>
  {#if !element}
    <label>Kind<select bind:value={kind}>{#each kinds as k}<option value={k.kind}>{k.kind} — {k.about}</option>{/each}</select></label>
  {/if}
  <label>Title<input bind:value={title} required /></label>
  {#each fields as [f, t] (f)}
    <label>{f}
      {#if t === "bool"}<input type="checkbox" bind:checked={config[f]} />
      {:else if t === "number"}<input type="number" bind:value={config[f]} />
      {:else if t === "list"}<textarea rows="2" bind:value={config[f]} placeholder="a, b (or a JSON list)"></textarea>
      {:else}<input bind:value={config[f]} />{/if}
    </label>
  {/each}
  <div class="row"><button class="btn primary" type="submit">{element ? "Save" : "Add"}</button><button class="btn" type="button" onclick={done}>Cancel</button></div>
</form>
<style>
  form{display:flex;flex-direction:column;gap:var(--space-2);border:var(--line-hair) dashed color-mix(in oklab,var(--press) 60%,transparent);border-radius:var(--radius-sm);background:color-mix(in oklab,var(--tint) 60%,transparent);padding:var(--space-3)}
  label{display:flex;flex-direction:column;gap:var(--space-1);font-size:var(--text-sm);color:var(--muted)}
  input:not([type=checkbox]),select,textarea{min-height:var(--control-md);padding:0 var(--space-3);border:var(--line-hair) solid var(--border);border-radius:var(--radius-sm);background:color-mix(in oklab,var(--bg) 60%,transparent);color:var(--fg);min-width:0;width:100%}
  textarea{font:inherit;font-size:var(--text-md);font-family:var(--font-mono);padding:var(--space-2) var(--space-3);resize:vertical}
  input[type=checkbox]{width:var(--control-xs);height:var(--control-xs)}
  .row{display:flex;gap:var(--space-2)}
</style>
