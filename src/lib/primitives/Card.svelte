<script>
  // Every object's view is rooted in a Card (contract §5). The root card of a view carries `size`, the object's
  // `status` and (large) its `scene`. The four sizes (design-rules §7):
  //   icon   — a 2×2 tile: the avatar large and centred, the label below; its controls live INSIDE the tile, shown on
  //            hover / focus (a long press on touch);
  //   small  — the card: header (avatar, title, phase chip, light + now), the FOCUS line, the object's own small
  //            body, then the actions it performed (newest first) in a scroll area;
  //   medium — the card expanded into the content area (the FocusLayer), its whole detail;
  //   large  — the immersive full-screen scene (/focus), laid out by its `scene`.
  // One size control cycles icon → small → medium → large; ⛶ goes straight to the immersive scene.
  import { getContext } from "svelte";
  import { toneVar, toneOf } from "../logic/tones.js";
  import { nextSize, activityRows, focusLine, chipOf } from "../logic/focus.js";
  import { store } from "../store.svelte.js";
  import Status from "./Status.svelte";
  import Avatar from "./Avatar.svelte";
  let { title, tone, phase, size, status, icon = null, scene = null, children } = $props();
  const owner = getContext("owner");
  const sizer = size ? getContext("sizer") : null;
  const twin = $derived(owner ? store.find(owner) : null);
  const isIcon = $derived(size === "icon");
  const rows = $derived(size && !isIcon ? activityRows(twin, 20) : []);
  const focus = $derived(focusLine(twin ?? { status }));
  const chip = $derived(chipOf(twin ?? { status }));
  const next = $derived(nextSize(size));
  const label = { icon: "Icon", small: "Card", medium: "Expand", large: "Full screen" };
  // a long press reveals an icon tile's controls on touch (no hover there)
  let reveal = $state(false), timer = null;
  const press = () => { clearTimeout(timer); timer = setTimeout(() => (reveal = true), 450); };
  const lift = () => clearTimeout(timer);
  const opener = () => (sizer?.open ? sizer.open("large") : (store.sheet = owner));
  const titleClick = () => (size === "small" && sizer?.open ? sizer.open("medium") : (store.sheet = owner));
  /** a wheel over a body that scrolls scrolls it: the canvas under it neither pans nor zooms */
  const wheel = (e) => { const b = e.currentTarget; if (b.scrollHeight > b.clientHeight + 1) e.stopPropagation(); };
</script>
{#snippet controls()}
  {#if sizer}
    <span class="ctl" class:show={reveal} role="group" aria-label="Card size: {size}">
      {#if sizer.cycle && !sizer.inPlace}
        <button class="sz" aria-label="{label[next]} ({title})" title="{label[next]}" onclick={() => { reveal = false; sizer.cycle(); }}>
          <svg class="ico sm" viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.5" d={next === "icon" ? "M3 8h10" : "M9 3h4v4M7 13H3V9M13 3 9 7M3 13l4-4"} /></svg>
        </button>
      {/if}
      {#if size !== "large"}
        <button class="sz" aria-label="Full screen ({title})" title="Full screen" onclick={() => { reveal = false; opener(); }}>
          <svg class="ico sm" viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.5" d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" /></svg>
        </button>
      {/if}
      {#if sizer.close}
        <button class="sz" aria-label="Close ({title})" title="Close (Esc)" onclick={() => sizer.close()}>
          <svg class="ico sm" viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.5" d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      {/if}
    </span>
  {/if}
{/snippet}
{#snippet acts()}
  {#if rows.length}
    <ol class="acts" aria-label="What {title} did, newest first">
      {#each rows as r, i (i)}
        <li class:bad={!r.ok}><span class="t mono">{r.time}</span><span class="a mono">{r.action}</span><span class="x">{r.text}</span><span class="ok" aria-label={r.ok ? "ok" : "failed"}>{r.ok ? "✓" : "✕"}</span></li>
      {/each}
    </ol>
  {:else if size === "small"}<p class="none">No actions yet</p>{/if}
{/snippet}
<section class="card pane {size ?? ''} {scene ? `scene-${scene}` : ''}" class:lit={toneOf(tone, phase) !== "neutral"} class:failed={phase === "failed"} style:--t={toneVar(tone, phase)}
  aria-busy={phase === "running" || phase === "waiting"} data-size={size} data-scene={scene} title={isIcon ? `${title} · ${status?.now ?? phase}` : null}
  onpointerdown={isIcon ? press : null} onpointerup={lift} onpointerleave={() => { lift(); }} oncontextmenu={isIcon ? (e) => e.preventDefault() : null}>
  {#if isIcon && size}
    <div class="body" onwheel={wheel}>{@render children?.()}</div>
    <button class="label" onclick={titleClick}>{title}</button>
    {@render controls()}
  {:else if size}
    <div class="head">
      {#if icon}<Avatar {icon} label={title} {phase} tone={status?.light} size={size === "large" ? "lg" : "sm"} />{/if}
      <div class="who">
        <button class="title" onclick={titleClick} title={title}>{title}</button>
        <Status {status} {phase} compact={size === "small"} />
      </div>
      {#if chip}<span class="chip">{chip}</span>{/if}
      {@render controls()}
    </div>
    {#if focus && focus !== status?.now}<p class="focus" title={focus}><span class="fl mono">focus</span> {focus}</p>{/if}
    {#if size === "small"}
      <div class="body" onwheel={wheel}>
        <div class="own">{@render children?.()}</div>
        {@render acts()}
      </div>
    {:else}
      <div class="main">
        <div class="body" onwheel={wheel}>{@render children?.()}</div>
        {#if rows.length}<aside class="side" onwheel={wheel}><h3 class="eyebrow">Activity</h3>{@render acts()}</aside>{/if}
      </div>
    {/if}
  {:else}
    {#if title}<button class="title" onclick={() => (store.sheet = owner)}>{title}</button>{/if}
    <div class="body">{@render children?.()}</div>
  {/if}
</section>
<style>
  /* Phase shows as a backlight (shadow + edge colour): it never changes the card's size or place. */
  .card{padding:var(--space-3) var(--space-4);display:flex;flex-direction:column;gap:var(--space-2);min-width:0;position:relative;transition:box-shadow var(--motion-slow) var(--ease-calm),border-color var(--motion-slow) var(--ease-calm)}
  .card.lit{border-color:color-mix(in oklab,var(--t) 55%,var(--border));box-shadow:inset 0 var(--line-hair) 0 color-mix(in oklab,var(--edge) 40%,transparent),0 var(--space-3) var(--space-6) calc(var(--space-4) * -1) var(--t)}
  .card.failed{border-color:var(--error)}
  .head{display:flex;align-items:center;gap:var(--space-2);min-width:0}
  .who{display:flex;flex-direction:column;min-width:0;flex:1}
  .title{all:unset;cursor:pointer;font-size:var(--text-lg);line-height:1.25;overflow-wrap:break-word;min-width:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .card.small > .head .title{font-size:var(--text-md)}
  .card.large > .head .title{font-size:var(--text-xl)}
  .title:focus-visible,.label:focus-visible{outline:var(--line-bold) solid var(--press);outline-offset:var(--line-bold);border-radius:var(--radius-sm)}
  .title:hover{text-decoration:underline}
  .chip{flex:none;font-size:var(--text-xs);padding:0 var(--space-2);line-height:var(--control-xs);border-radius:var(--radius-full);border:var(--line-hair) solid color-mix(in oklab,var(--accent) 55%,var(--border));background:color-mix(in oklab,var(--accent) 12%,transparent);white-space:nowrap}
  .focus{margin:0;font-size:var(--text-sm);line-height:1.35;color:var(--fg);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .fl{font-size:var(--text-xs);color:var(--accent);margin-right:var(--space-1)}
  .body{display:flex;flex-direction:column;gap:var(--space-2);min-width:0}
  .own:empty{display:none}
  .main{display:flex;gap:var(--space-4);min-height:0;flex:1;min-width:0}
  .main > .body{flex:1}
  .side{flex:0 0 var(--width-sm);min-width:0;border-left:var(--line-hair) solid var(--border);padding-left:var(--space-3);overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}
  .eyebrow{margin:0 0 var(--space-2);font-size:var(--text-xs);color:var(--muted)}
  .acts{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
  .acts li{display:grid;grid-template-columns:auto auto minmax(0,1fr) auto;gap:var(--space-2);align-items:baseline;padding:var(--space-1) 0;border-top:var(--line-hair) solid color-mix(in oklab,var(--border) 70%,transparent);font-size:var(--text-xs)}
  .acts li:first-child{border-top:0}
  .t{color:var(--muted)}.a{color:var(--accent)}
  .x{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ok{color:var(--ok)}.bad .ok,.bad .x{color:var(--error)}
  .none{margin:0;font-size:var(--text-xs);color:var(--muted)}
  /* the controls: inside the card, top right; revealed on hover / keyboard focus (always on touch but on icons) */
  .ctl{display:flex;flex:none;gap:var(--space-1);opacity:0;transition:opacity var(--motion-fast) var(--ease-out)}
  .card:hover > .head .ctl,.card:hover > .ctl,.ctl:focus-within,.ctl.show,.card.medium > .head .ctl,.card.large > .head .ctl{opacity:1}
  .sz{width:var(--control-sm);height:var(--control-sm);display:grid;place-items:center;border:var(--line-hair) solid transparent;border-radius:var(--radius-sm);background:color-mix(in oklab,var(--tint) 70%,transparent);color:var(--muted);cursor:pointer}
  .sz:hover{border-color:var(--border);color:var(--fg)}
  @media (pointer:coarse){.sz{width:var(--control-md);height:var(--control-md)}.card:not(.icon) > .head .ctl{opacity:1}}
  /* icon: the tile — avatar on top, centred and large; the label below; controls inside its top-right corner */
  .card.icon{padding:var(--space-2);align-items:center;justify-content:center;gap:var(--space-2);overflow:hidden}
  .card.icon > .body{flex-direction:row;justify-content:center}
  .card.icon > .ctl{position:absolute;top:var(--space-1);right:var(--space-1)}
  .label{all:unset;cursor:pointer;font-size:var(--text-sm);max-width:100%;text-align:center;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
  /* large: the scene lays the body out per component (immersive, full screen) */
  .card.large{padding:var(--space-5) var(--space-6);gap:var(--space-3);height:100%}
  .card.large > .main > .body{overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;gap:var(--space-4)}
  .scene-conversation > .main > .body > :global(*){max-width:var(--width-text);width:100%;margin-inline:auto}
  .scene-meters > .main > .body :global(.meter){font-size:var(--text-md)}
  .scene-reader > .main > .body{font-size:var(--text-lg);line-height:1.6}
  .scene-reader > .main > .body > :global(*){max-width:var(--width-text);margin-inline:auto;width:100%}
  @media (max-width:768px){.main{flex-direction:column}.side{flex:none;border-left:0;border-top:var(--line-hair) solid var(--border);padding:var(--space-2) 0 0;max-height:var(--width-sm)}.card.large{padding:var(--space-4)}}
</style>
