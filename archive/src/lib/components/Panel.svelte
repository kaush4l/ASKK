<script>
  // The one left panel ("view elements"): views, the engine tree (from world), edit/theme controls, connection.
  import { page } from "$app/state";
  import { store } from "../store.svelte.js";
  import Avatar from "../primitives/Avatar.svelte";
  import { portal } from "../actions/portal.js";
  import { engineTree, summaryLine, readCollapsed, saveCollapsed, isMobile, isRail, nextScheme, readScheme, saveScheme } from "../logic/panel.js";
  import { routeOf, viewOf, isCurrent, engineHref, pageHref, HREF } from "../logic/routes.js";
  const DOT = { live: "ok", connecting: "neutral", reconnecting: "warn", fixture: "warn" };
  const ls = () => { try { return window.localStorage; } catch { return null; } };
  let collapsed = $state(readCollapsed(ls()));
  let width = $state(window.innerWidth);
  const mobile = $derived(isMobile(width));
  let drawer = $state(false);
  let scheme = $state(readScheme(ls()));
  const tree = $derived(engineTree(store.world?.engines));
  const path = $derived(page.url.pathname);
  const route = $derived(routeOf(page.url));
  const cur = (kind, id) => (isCurrent(route, { kind, id }) ? "page" : undefined);
  const rail = $derived(isRail(width, collapsed));
  $effect(() => { if (scheme === "system") document.documentElement.removeAttribute("data-theme"); else document.documentElement.dataset.theme = scheme; });
  $effect(() => { path; drawer = false; }); // navigation closes the drawer
  $effect(() => { document.documentElement.style.setProperty("--shell", mobile ? "0" : rail ? "calc(var(--width-rail) + var(--space-5))" : "calc(var(--width-panel) + var(--space-5))"); });
  function toggle() { collapsed = !collapsed; saveCollapsed(ls(), collapsed); }
  function cycle() { scheme = nextScheme(scheme); saveScheme(ls(), scheme); }
  const open = $derived(!mobile || drawer);
</script>
<svelte:window onresize={() => (width = window.innerWidth)} onkeydown={(e) => { if (e.key === "Escape" && drawer) drawer = false; }} />

{#if mobile}
  <button use:portal class="menu glass" aria-label="Open panel" aria-expanded={drawer} aria-controls="panel" onclick={() => (drawer = true)}>
    <svg class="ico" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>
    <i class="dot" style:background="var(--{DOT[store.status]})"></i>
  </button>
  {#if drawer}<div use:portal class="scrim" role="presentation" onclick={() => (drawer = false)}></div>{/if}
{/if}

{#if open}
<nav use:portal id="panel" class="panel glass" class:rail class:drawer={mobile} aria-label="View elements">
  <div class="head">
    {#if !rail}<span class="brand wordmark">Askk</span>{/if}
    {#if mobile}
      <button class="ic" aria-label="Close panel" onclick={() => (drawer = false)}>×</button>
    {:else}
      <button class="ic" aria-label={rail ? "Expand panel" : "Collapse panel"} aria-expanded={!rail} onclick={toggle}>
        <svg class="ico" viewBox="0 0 20 20" aria-hidden="true" class:flip={rail}><path d="M12 5l-5 5 5 5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>
      </button>
    {/if}
  </div>

  <div class="sec">
    {#if !rail}<span class="eyebrow">Views</span>{/if}
    <a class="item" href={HREF.dashboard} aria-current={cur("dashboard")} title="Dashboard">
      <svg class="ico" viewBox="0 0 20 20" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="11" y="3" width="6" height="6" rx="1.5"/><rect x="3" y="11" width="6" height="6" rx="1.5"/><rect x="11" y="11" width="6" height="6" rx="1.5"/></g></svg>
      <span class="label">Dashboard</span></a>
    <a class="item" href={HREF.canvas} aria-current={cur("canvas")} title="Canvas">
      <svg class="ico" viewBox="0 0 20 20" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2.5" y="4" width="8" height="6" rx="1.5"/><rect x="9.5" y="11" width="8" height="5" rx="1.5"/><path d="M6.5 10v3.5h3"/></g></svg>
      <span class="label">Canvas</span></a>
    <a class="item" href={HREF.models} aria-current={cur("models")} title="Models: the desk's model library and default">
      <svg class="ico" viewBox="0 0 20 20" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="5" width="10" height="10" rx="2"/><path d="M8 2.5v2.5M12 2.5v2.5M8 15v2.5M12 15v2.5M2.5 8h2.5M2.5 12h2.5M15 8h2.5M15 12h2.5"/></g></svg>
      <span class="label">Models</span></a>
  </div>

  <div class="sec tree">
    {#if !rail}<span class="eyebrow">Engines</span>{/if}
    <ul>
      {#each tree as it (it.id)}
        <li style:--depth={rail ? 0 : it.depth}>
          <a class="item eng" href={engineHref(it.id)} aria-current={cur("engine", it.id)} class:failed={it.failed} title="{it.title} · {it.phase}{summaryLine(it.summary) ? ` · ${summaryLine(it.summary)}` : ''}">
            <span class="av"><Avatar icon={it.icon} label={it.title} phase={it.phase} running={it.summary.running + (it.phase === "running" ? 1 : 0)} asks={it.asks} failed={it.summary.failed} size="sm" /></span>
            {#if !rail}<span class="label">{it.title}</span><span class="ph mono">{it.phase}</span>
              {#if it.summary.running || it.summary.failed || it.asks}<span class="chips">{#if it.summary.running}<span class="sum mono" style:--t="var(--busy)">{it.summary.running} running</span>{/if}{#if it.summary.failed}<span class="sum mono" style:--t="var(--error)">{it.summary.failed} failed</span>{/if}{#if it.asks}<span class="sum mono" style:--t="var(--accent)">{it.asks} {it.asks === 1 ? "ask" : "asks"}</span>{/if}</span>{/if}{/if}
          </a>
        </li>
      {/each}
    </ul>
  </div>

  <div class="sec foot">
    <button class="item" class:on={!store.locked} aria-pressed={!store.locked} title={store.locked ? "Unlock (edit mode)" : "Lock"} onclick={() => (store.locked = !store.locked)}>
      <svg class="ico" viewBox="0 0 20 20" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="9" width="12" height="8" rx="2"/>{#if store.locked}<path d="M7 9V6.5a3 3 0 0 1 6 0V9"/>{:else}<path d="M7 9V6.5a3 3 0 0 1 5.8-1"/>{/if}</g></svg>
      <span class="label">{store.locked ? "Unlock" : "Lock"}</span></button>
    {#if !store.locked}
      <a class="item" href={HREF.theme} aria-current={cur("theme")} title="Theme tokens">
        <svg class="ico" viewBox="0 0 20 20" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="7"/><circle cx="7" cy="8" r="1"/><circle cx="12" cy="7" r="1"/><circle cx="13" cy="11.5" r="1"/></g></svg>
        <span class="label">Theme</span></a>
      <a class="item" href={pageHref(viewOf(route))} aria-current={cur("page")} title="Page: background and layout">
        <svg class="ico" viewBox="0 0 20 20" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="14" height="12" rx="2"/><path d="M3 13l4-4 3 3 2-2 5 5"/></g></svg>
        <span class="label">Page</span></a>
    {/if}
    <button class="item" title="Appearance: {scheme}" onclick={cycle}>
      <svg class="ico" viewBox="0 0 20 20" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="6.5"/><path d="M10 3.5a6.5 6.5 0 0 1 0 13z" fill="currentColor"/></g></svg>
      <span class="label">Appearance · {scheme}</span></button>
    <span class="item status" title="Connection: {store.status}" aria-live="polite">
      <i class="dot" style:background="var(--{DOT[store.status]})"></i><span class="label mono">{store.status}</span></span>
  </div>
</nav>
{/if}

<style>
  .panel{position:fixed;z-index:30;top:var(--space-3);bottom:var(--space-3);left:var(--space-3);width:var(--width-panel);border-radius:var(--radius-lg);
    display:flex;flex-direction:column;gap:var(--space-2);padding:var(--space-2);overflow:hidden;transition:width var(--motion-calm) var(--ease-calm)}
  .panel.rail{width:var(--width-rail)}
  .panel.drawer{width:min(var(--width-panel),86vw);top:var(--space-2);bottom:var(--space-2);left:var(--space-2);z-index:50}
  .scrim{position:fixed;inset:0;z-index:45;background:color-mix(in srgb,var(--ink) 35%,transparent)}
  .menu{position:fixed;z-index:30;top:max(var(--space-2),env(safe-area-inset-top));left:var(--space-2);width:var(--control-lg);height:var(--control-lg);border-radius:var(--radius-md);display:grid;place-items:center;color:var(--fg);cursor:pointer}
  .menu .dot{position:absolute;top:var(--space-2);right:var(--space-2)}
  .head{display:flex;align-items:center;justify-content:space-between;gap:var(--space-1);min-height:var(--control-md);padding-left:var(--space-2)}
  .rail .head{justify-content:center;padding:0}
  .brand{font-size:var(--text-lg);white-space:nowrap}
  .ic{width:var(--control-md);height:var(--control-md);border:0;border-radius:var(--radius-sm);background:transparent;display:grid;place-items:center;cursor:pointer;color:var(--muted);font-size:var(--text-lg)}
  .ic:hover{background:color-mix(in oklab,var(--fg) 8%,transparent);color:var(--fg)}
  .flip{transform:rotate(180deg)}
  .sec{display:flex;flex-direction:column;gap:var(--line-bold)}
  .tree{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden}
  .eyebrow{font-size:var(--text-xs);color:var(--muted);padding:var(--space-2) var(--space-3) var(--space-1)}
  ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--line-bold)}
  li{padding-left:calc(var(--depth) * var(--space-4))}
  .item{display:flex;align-items:center;gap:var(--space-3);width:100%;min-height:var(--control-md);padding:0 var(--space-3);border:0;border-radius:var(--radius-sm);
    background:transparent;color:var(--fg);text-decoration:none;text-align:left;cursor:pointer;transition:background-color var(--motion-fast) var(--ease-out)}
  .item:hover{background:color-mix(in oklab,var(--fg) 8%,transparent)}
  .item[aria-current="page"],.item.on{background:var(--press);color:var(--press-ink)}
  .item svg{flex:none}
  .rail .item{justify-content:center;padding:0}
  .rail .label,.rail .ph{position:absolute;width:var(--line-hair);height:var(--line-hair);overflow:hidden;clip-path:inset(50%)}
  .label{flex:1;min-width:calc(var(--control-lg) * 1.5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ph{font-size:var(--text-xs);color:var(--muted)}
  /* an engine row is a grid: avatar | title | phase, the summary chips on a second line under the title (never
     wrapped under the avatar, never over the phase) */
  .eng{display:grid;grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"av label ph" "av chips chips";
    column-gap:var(--space-3);row-gap:var(--space-1);align-items:center;padding-block:var(--space-1)}
  .eng .av{grid-area:av;display:inline-grid}
  .eng .label{grid-area:label;min-width:0}
  .eng .ph{grid-area:ph}
  .chips{grid-area:chips;display:flex;flex-wrap:wrap;gap:var(--space-1);min-width:0}
  .rail .eng{display:flex}
  .eng.failed .label{color:var(--error)}
  .dot{width:var(--icon-xs);height:var(--icon-xs);border-radius:50%;flex:none;display:inline-block}
  .sum{flex:none;font-size:var(--text-xs);color:var(--t);border:var(--line-hair) solid color-mix(in oklab,var(--t) 70%,transparent);border-radius:var(--radius-full);padding:0 var(--space-1)}
  .foot{border-top:var(--line-hair) solid var(--border);padding-top:var(--space-2)}
  .status{cursor:default;color:var(--muted);font-size:var(--text-sm)}.status:hover{background:transparent}
  @media (prefers-reduced-motion: reduce){.panel{transition:none}}
</style>
