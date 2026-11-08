<script>
  // The desk's model library (world.desk): rows of name + connector + base_url with Make default /
  // Test / Edit (base_url, key_env, context) / Remove, and "Add models": find a server's names and
  // click one to save it. Keys are never typed here: key_env names the env var that holds one.
  import { store } from "../store.svelte.js";
  import { modelRows, whereLine, DEFAULT_URL, needsUrl, discoverArgs, addArgs, sourceProblem, draftOf, saveArgs, draftProblem, testLine, EDIT_FIELDS } from "../logic/models.js";
  let { done } = $props();
  const rows = $derived(modelRows(store.world));
  const connectors = $derived(store.world?.desk?.connectors ?? ["echo"]);
  const errors = $derived(store.world?.desk?.errors ?? []);
  const desk = (action, args) => store.act("desk", action, args);

  // editing one row
  let draft = $state(null);
  let problem = $state("");
  function edit(m) { draft = draftOf(m); problem = ""; }
  async function save() {
    problem = draftProblem(draft);
    if (problem) return;
    await desk("model.save", saveArgs($state.snapshot(draft)));
    if (!store.error) draft = null;
  }
  async function remove(slug) { await desk("model.remove", { slug }); if (!store.error && draft?.slug === slug) draft = null; }

  // adding: a source (connector, url, key_env), the names it lists, the ones saved
  let src = $state({ connector: "openai", base_url: DEFAULT_URL.openai, key_env: "" });
  let found = $state(null);
  let added = $state([]);
  let finding = $state(false);
  let addProblem = $state("");
  let manual = $state("");
  function pick(c) { src.connector = c; src.base_url = DEFAULT_URL[c] ?? ""; found = null; added = []; addProblem = ""; }
  async function find() {
    addProblem = sourceProblem(src);
    if (addProblem) return;
    finding = true;
    const got = await store.ask("desk", "model.discover", discoverArgs($state.snapshot(src)));
    finding = false;
    if (got) { found = got.models ?? []; added = got.already ?? []; }
    else { found = null; addProblem = store.error; store.error = ""; }
  }
  async function add(name) {
    name = String(name).trim();
    if (!name || added.includes(name)) return;
    addProblem = sourceProblem(src);
    if (addProblem) return;
    await desk("model.save", addArgs($state.snapshot(src), name));
    if (!store.error) added = [...added, name];
  }
</script>
<div class="me">
  <div class="top"><h3>Models</h3><button class="btn" onclick={done}>Close</button></div>
  {#each errors as e}<p class="warn mono">{e}</p>{/each}
  <ul>
    {#each rows as m (m.slug)}
      <li>
        <div class="name"><span class="mono">{m.name}</span>{#if m.isDefault}<span class="chip">desk default</span>{/if}
          <span class="mono muted small">{whereLine(m)}</span></div>
        <span class="mono muted small">{testLine(m)}{m.used_by?.length ? ` · used by ${m.used_by.join(", ")}` : ""}</span>
        <div class="acts">
          {#if !m.isDefault}<button class="btn" onclick={() => desk("model.default", { slug: m.slug })}>Make default</button>{/if}
          <button class="btn" disabled={m.test?.running} onclick={() => desk("model.test", { slug: m.slug })}>Test</button>
          <button class="btn" onclick={() => edit(m)}>Edit</button>
          {#if !m.isDefault}<button class="btn" onclick={() => remove(m.slug)}>Remove</button>{/if}
        </div>
        {#if draft?.slug === m.slug}
          <form onsubmit={(e) => { e.preventDefault(); save(); }}>
            {#each EDIT_FIELDS as f (f)}
              <label><span>{f}</span><input bind:value={draft[f]} inputmode={f === "context" ? "numeric" : "text"} placeholder={f === "key_env" ? "env var NAME, e.g. OPENAI_API_KEY" : f === "base_url" ? (DEFAULT_URL[draft.connector] ?? "") : ""} /></label>
            {/each}
            {#if problem}<p class="warn">{problem}</p>{/if}
            <div class="acts">
              <button class="btn primary" type="submit">Save</button>
              <button class="btn" type="button" onclick={() => (draft = null)}>Cancel</button>
            </div>
          </form>
        {/if}
      </li>
    {/each}
  </ul>

  <section class="add" aria-label="Add models">
    <h3>Add models</h3>
    <label><span>connector</span>
      <select value={src.connector} onchange={(e) => pick(e.currentTarget.value)}>{#each connectors as c}<option value={c}>{c}</option>{/each}</select>
    </label>
    {#if needsUrl(src.connector)}
      <label><span>base_url</span><input bind:value={src.base_url} placeholder={DEFAULT_URL[src.connector]} /></label>
    {/if}
    <label><span>key_env</span><input bind:value={src.key_env} placeholder="env var NAME (optional)" /></label>
    <div class="acts"><button class="btn primary" disabled={finding} onclick={find}>{finding ? "Finding…" : "Find models"}</button></div>
    {#if addProblem}<p class="warn">{addProblem}</p>{/if}
    {#if found}
      {#if found.length}
        <div class="chips">
          {#each found as n (n)}
            {@const on = added.includes(n)}
            <button class="pick mono" class:on disabled={on} aria-pressed={on} title={on ? "in the library" : "add to the library"} onclick={() => add(n)}>{n}{on ? " · added" : ""}</button>
          {/each}
        </div>
      {:else}<p class="muted small">the server lists no models</p>{/if}
    {/if}
    <form class="manual" onsubmit={(e) => { e.preventDefault(); add(manual); manual = ""; }}>
      <label><span>by name</span><input bind:value={manual} placeholder="model id, e.g. gpt-5.1" /></label>
      <button class="btn" type="submit" disabled={!manual.trim()}>Add</button>
    </form>
  </section>
</div>
<style>
  .me{display:flex;flex-direction:column;gap:var(--space-2)}.top{display:flex;justify-content:space-between;align-items:center}
  h3{margin:0;font-weight:400;font-size:var(--text-md);color:var(--muted)}
  ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--space-2)}
  li{display:flex;flex-direction:column;gap:var(--space-1);padding:var(--space-2) 0;border-bottom:var(--line-hair) solid var(--border)}
  .name{display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap}.chip{font-size:var(--text-xs);color:var(--accent);border:var(--line-hair) solid var(--accent);border-radius:var(--radius-sm);padding:0 var(--space-1)}
  .muted{color:var(--muted)}.small{font-size:var(--text-xs)}.warn{color:var(--warn);font-size:var(--text-sm);margin:0}
  .acts{display:flex;gap:var(--space-2);flex-wrap:wrap}
  form,.add{display:flex;flex-direction:column;gap:var(--space-2)}
  .add{padding-top:var(--space-2)}
  .manual{flex-direction:row;align-items:center}.manual label{flex:1}
  .chips{display:flex;flex-wrap:wrap;gap:var(--space-1)}
  .pick{font-size:var(--text-xs);min-height:var(--control-md);padding:0 var(--space-2);border:var(--line-hair) solid var(--border);border-radius:var(--radius-sm);background:transparent;color:var(--fg);cursor:pointer}
  .pick:hover:not(:disabled){border-color:var(--accent)}
  .pick.on{color:var(--accent);border-color:var(--accent);cursor:default}
  label{display:flex;gap:var(--space-2);align-items:center}label span{width:var(--width-label);font-family:var(--font-mono);font-size:var(--text-xs)}
  input,select{min-height:var(--control-md);flex:1;min-width:0;padding:0 var(--space-2);border:var(--line-hair) solid var(--border);border-radius:var(--radius-sm);background:color-mix(in oklab,var(--bg) 60%,transparent);color:var(--fg);font:inherit}
</style>
