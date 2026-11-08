<script>
  // The page tree's `Composer` (contract §6): the footer text area of the content, a glass bar fixed at its bottom
  // (beside the panel, above the safe area). It talks to one engine — its `target`, else the page's `default`:
  // a phase picker (the selected phase is the mode: `set {phase}` on its phases element), a text area (Enter sends
  // `run {input}` to the loop, Shift+Enter a newline), a Run workflow menu (the text runs through a workflow's phases
  // in order), Stop (`cancel`) and the step while it runs, and the engine's open asks as reply chips above it.
  import { getContext, tick } from "svelte";
  import { store } from "../store.svelte.js";
  import { portal } from "../actions/portal.js"; // fixed chrome lives at the body root (Safari clips fixed children of a scroller)
  import { defaultEngineId, composerTarget, phasesOf, phaseAction, workflowsOf, workflowAction, submitAction, cancelAction, ownerAsks, keyIntent, growRows, composerStatus } from "../logic/composer.js";
  let { target = null, phases = true, placeholder = "" } = $props();
  const page = getContext("page");
  const engine = $derived(composerTarget(store.world, target, defaultEngineId(store.world, { props: { default: page?.default } })));
  const list = $derived(phases ? phasesOf(engine) : []);
  const flows = $derived(workflowsOf(engine));
  let menu = $state(false);
  const asks = $derived(ownerAsks(engine));
  const status = $derived(composerStatus(engine));
  let text = $state(""), ask = $state(null), busy = $state(false), height = $state(0), area;
  $effect(() => { if (ask && !asks.some((a) => a.id === ask)) ask = null; });
  const hint = $derived(ask ? `Reply to ${ask}…` : placeholder || `Message ${engine?.title ?? ""}…`);
  async function post(a) { if (!a) return false; busy = true; await store.act(a.target, a.action, a.args); busy = false; return !store.error; }
  async function send() {
    const a = submitAction(engine, text, ask);
    if (!a) return;
    if (await post(a)) { text = ""; ask = null; await tick(); area?.focus(); }
  }
  async function runFlow(id) {
    menu = false;
    if (await post(workflowAction(engine, id, text))) { text = ""; await tick(); area?.focus(); }
  }
  function key(e) {
    const k = keyIntent(e);
    if (k === "send") { e.preventDefault(); send(); }
    else if (k === "blur") area?.blur();
  }
  // the canvas lifts its floating chrome (toolbar, minimap) above the bar: no glass on glass, nothing hidden
  $effect(() => { document.documentElement.style.setProperty("--composer", `${height}px`); return () => document.documentElement.style.removeProperty("--composer"); });
  const canSend = $derived(!busy && !!submitAction(engine, text, ask));
</script>
{#if engine}
  <!-- in flow on the dashboard, so the last card scrolls clear of the bar; the canvas fills its height under it -->
  <div use:portal class="dock" bind:clientHeight={height}>
    <form class="bar glass" onsubmit={(e) => { e.preventDefault(); send(); }} aria-label="Message {engine.title}">
      {#if asks.length}
        <div class="asks" role="group" aria-label="Open asks">
          {#each asks as a (a.id)}
            <button type="button" class="chip ask" aria-pressed={ask === a.id} title={a.question} onclick={() => { ask = ask === a.id ? null : a.id; area?.focus(); }}>
              <span aria-hidden="true">💬</span><span class="mono">{a.id}</span><span class="q">{a.question}</span>
            </button>
          {/each}
        </div>
      {/if}
      {#if list.length}
        <div class="modes" role="radiogroup" aria-label="Phase (mode)">
          {#each list as m (m.id)}
            <button type="button" role="radio" class="chip" aria-checked={m.current} disabled={busy || status.running}
              title={m.tools == null ? "every listed tool" : m.tools.length ? m.tools.join(", ") : "No tools"} onclick={() => post(phaseAction(engine, m.id))}>
              {#if m.icon}<span aria-hidden="true">{m.icon}</span>{/if}<span>{m.title}</span>
            </button>
          {/each}
          {#if flows.length}
            <span class="flowwrap">
              <button type="button" class="chip flow" aria-haspopup="menu" aria-expanded={menu} disabled={status.running} onclick={() => (menu = !menu)}>Run workflow ▾</button>
              {#if menu}
                <span class="menu" role="menu">
                  {#each flows as f (f.id)}
                    <button type="button" role="menuitem" disabled={!workflowAction(engine, f.id, text)} title={text.trim() ? "" : "Type the input first"} onclick={() => runFlow(f.id)}>
                      <span aria-hidden="true">{f.icon}</span><span>{f.title}</span><span class="mono muted">{f.phases.join(" → ")}</span>
                    </button>
                  {/each}
                </span>
              {/if}
            </span>
          {/if}
        </div>
      {/if}
      <div class="row">
        <textarea bind:this={area} bind:value={text} rows={growRows(text)} placeholder={hint} aria-label={hint} onkeydown={key} enterkeyhint="send"></textarea>
        {#if status.running && !ask}
          <button type="button" class="act stop" onclick={() => post(cancelAction(engine))} aria-label="Stop the run">Stop</button>
        {:else}
          <button type="submit" class="act" disabled={!canSend}>{ask ? "Reply" : "Send"}</button>
        {/if}
      </div>
      <p class="status mono" class:running={status.running} aria-live="polite"><span class="light" aria-hidden="true"></span>{status.line}</p>
    </form>
  </div>
{/if}
<style>
  .dock{position:fixed;z-index:30;left:var(--shell,0);right:0;bottom:0;padding:0 var(--space-4) calc(var(--space-3) + env(safe-area-inset-bottom));pointer-events:none}
  @media (min-width:768px){.dock{padding-left:var(--space-5);padding-right:var(--space-5)}}
  .bar{pointer-events:auto;margin:0 auto;max-width:var(--width-xl);display:flex;flex-direction:column;gap:var(--space-2);padding:var(--space-2) var(--space-3);border-radius:calc(var(--radius-md) + var(--space-1))}
  .modes,.asks{display:flex;gap:var(--space-1);flex-wrap:wrap}
  .chip{min-height:var(--control-sm);padding:0 var(--space-3);display:inline-flex;align-items:center;gap:var(--space-1);border:var(--line-hair) solid var(--border);border-radius:var(--radius-full);background:transparent;color:var(--muted);font-size:var(--text-sm);cursor:pointer;max-width:100%;transition:background-color var(--motion-fast) var(--ease-out),color var(--motion-fast) var(--ease-out)}
  @media (pointer:coarse){.chip{min-height:var(--control-md)}}
  .chip:hover:not(:disabled):not([aria-pressed="true"]):not([aria-checked="true"]){color:var(--fg);background:color-mix(in oklab,var(--fg) 6%,transparent)}
  .chip:disabled{opacity:.55;cursor:default}
  .flowwrap{position:relative;margin-left:auto}
  .menu{position:absolute;right:0;background:var(--surface);border:var(--line-hair) solid var(--border);box-shadow:var(--elev);bottom:calc(100% + var(--space-1));display:flex;flex-direction:column;min-width:var(--width-sm);padding:var(--space-1);border-radius:var(--radius-md);z-index:2}
  .menu button{min-height:var(--control-md);display:flex;align-items:center;gap:var(--space-2);padding:0 var(--space-3);border:0;border-radius:var(--radius-sm);background:transparent;color:var(--fg);cursor:pointer;text-align:left}
  .menu button:hover:not(:disabled){background:color-mix(in oklab,var(--fg) 7%,transparent)}.menu button:disabled{opacity:.5;cursor:default}
  .menu .mono{font-size:var(--text-xs);margin-left:auto}
  .chip.ask{border-color:color-mix(in oklab,var(--accent) 60%,var(--border));color:var(--fg)}
  .chip[aria-checked="true"],.chip[aria-pressed="true"]{background:var(--press);border-color:var(--press);color:var(--press-ink)}
  .q{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
  .row{display:flex;gap:var(--space-2);align-items:flex-end}
  textarea{flex:1;min-width:0;resize:none;font-size:var(--text-md);line-height:1.5;min-height:var(--control-md);max-height:calc(var(--text-md) * 12);padding:var(--space-2) var(--space-3);border:var(--line-hair) solid var(--border);border-radius:var(--radius-sm);background:color-mix(in oklab,var(--bg) 60%,transparent);color:var(--fg)}
  textarea:focus-visible{outline:var(--line-bold) solid var(--press);outline-offset:var(--line-hair)}
  .act{flex:none;min-height:var(--control-md);min-width:var(--control-md);padding:0 var(--space-4);border:var(--line-hair) solid var(--press);border-radius:var(--radius-sm);background:var(--press);color:var(--press-ink);cursor:pointer}
  .act:disabled{opacity:.45;cursor:default}
  .act.stop{background:transparent;color:var(--error);border-color:var(--error)}
  .status{margin:0;display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-xs);color:var(--muted);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  .light{flex:none;width:var(--icon-xs);height:var(--icon-xs);border-radius:var(--radius-full);background:var(--neutral)}
  .running .light{background:var(--busy);animation:pulse var(--motion-pulse) var(--ease-calm) infinite}
  .running{color:var(--busy)}
  @keyframes pulse{50%{opacity:.35}}
</style>
