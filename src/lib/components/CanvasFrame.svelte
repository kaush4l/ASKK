<script>
  // One engine on the canvas: a glass frame. Its header is the engine's light, title, status now and depth; its
  // body holds the engine's elements as cards at the zoom-picked size. Running glows (status light, never size).
  // Legibility (design-rules §11): at `icon` the frame is its avatar, title and its elements' avatars (no small
  // chips); at `far` it collapses to its avatar and a large title (the title hidden while it would be illegible).
  import ObjectItem from "./ObjectItem.svelte";
  import Widgets from "../primitives/Widgets.svelte";
  import EditTools from "./EditTools.svelte";
  import EditPanel from "./EditPanel.svelte";
  import Status from "../primitives/Status.svelte";
  import Avatar from "../primitives/Avatar.svelte";
  import { iconOf } from "../logic/avatar.js";
  import { store } from "../store.svelte.js";
  import { toneVar, toneOf } from "../logic/tones.js";
  import { setContext } from "svelte";
  let { engine, at, depth = 0, parent = null, chain = [], selected = false, titled = true, onpick, ongrab } = $props();
  const far = $derived(at === "far");
  const compact = $derived(at === "icon" || at === "far");
  // this engine's `children:` defaults, then its ancestors' and the page's: its elements' cards follow them
  setContext("cascade", { get chain() { return [engine.children_defaults, ...chain].filter(Boolean); } });
  let mode = $state(null);
  const busy = $derived(engine.phase === "running" || engine.phase === "waiting");
  const asks = $derived((Array.isArray(engine.state?.asks) ? engine.state.asks : []).filter((a) => a?.status === "open").length);
  const els = $derived(engine.elements ?? []);
  $effect(() => { if (store.locked) mode = null; });
</script>
<div class="frame glass" class:busy class:sel={selected} class:failed={engine.phase === "failed"} class:icon={at === "icon"} class:far
  style:--t={toneVar(engine.status?.light, engine.phase)} data-frame={engine.id} data-size={at}>
  <div class="head" role="button" tabindex="0" aria-label="{engine.title}: {engine.status?.now ?? engine.phase}. Open"
    onpointerdown={(e) => ongrab?.(e)} onclick={(e) => onpick?.(e)} onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onpick?.(e); } }}>
    <div class="top">
      {#if depth > 0 && !compact}<span class="depth mono" title="Child of {parent}">{"›".repeat(Math.min(depth, 3))}</span>{/if}
      <Avatar icon={iconOf(engine)} label={engine.title} phase={engine.phase} running={(engine.summary?.running ?? 0) + (engine.phase === "running" ? 1 : 0)} asks={asks} failed={engine.summary?.failed ?? 0} size={compact ? "lg" : "md"} />
      <span class="title" class:hidden={far && !titled}>{engine.title}</span>
      {#if !compact}
        {#if asks}<span class="ask mono">{asks} {asks === 1 ? "ask" : "asks"}</span>{/if}
        <span class="phase mono" style:--p={toneVar(toneOf(null, engine.phase))}>{engine.phase}</span>
      {/if}
    </div>
    {#if !compact}<Status status={engine.status} phase={engine.phase} />{/if}
  </div>
  {#if !store.locked && !compact}<div class="edit"><EditTools obj={engine} bind:mode /></div>{/if}
  {#if mode && !store.locked && !compact}<EditPanel obj={engine} bind:mode />{/if}
  {#if far}<!-- far: the avatar and the title only -->
  {:else if els.length}
    <!-- the same footprints as the dashboard (the widget grid), scaled by the camera -->
    <div class="nodes"><Widgets>{#each els as el (el.id)}<ObjectItem id={el.id} {at} />{/each}</Widgets></div>
  {:else if at !== "icon"}<span class="none muted">No elements</span>{/if}
</div>
<style>
  .frame{display:flex;flex-direction:column;gap:var(--space-2);padding:var(--space-3);border-radius:var(--radius-lg);width:100%;
    transition:box-shadow var(--motion-slow) var(--ease-calm),border-color var(--motion-slow) var(--ease-calm)}
  .frame.busy{border-color:color-mix(in oklab,var(--t) 60%,transparent);
    box-shadow:inset 0 var(--line-hair) 0 color-mix(in oklab,var(--edge) 70%,transparent),0 0 0 var(--line-hair) color-mix(in oklab,var(--t) 40%,transparent),0 0 var(--space-6) calc(var(--space-1) * -1) var(--t),var(--elev);
    animation:glow var(--motion-pulse) var(--ease-calm) infinite}
  @keyframes glow{50%{box-shadow:inset 0 var(--line-hair) 0 color-mix(in oklab,var(--edge) 70%,transparent),0 0 0 var(--line-bold) color-mix(in oklab,var(--t) 25%,transparent),0 0 var(--space-6) var(--space-1) color-mix(in oklab,var(--t) 55%,transparent),var(--elev)}}
  .frame.failed{border-color:var(--error)}
  .frame.sel{outline:var(--line-bold) solid var(--press);outline-offset:var(--space-1)}
  .head{display:flex;flex-direction:column;gap:var(--space-1);cursor:grab;border-radius:var(--radius-sm);padding:var(--space-1);margin:calc(var(--space-1) * -1);touch-action:none;user-select:none}
  .head:active{cursor:grabbing}
  .head:focus-visible{outline:var(--line-bold) solid var(--press);outline-offset:var(--line-bold)}
  .top{display:flex;align-items:center;gap:var(--space-2);min-width:0;min-height:var(--control-sm)}
  .title{font-size:var(--text-lg);line-height:1.2;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .icon .title{font-size:var(--text-md)}
  .far .title{font-size:var(--text-xl);line-height:1.1}
  .far .nodes{display:none}
  .hidden{position:absolute;width:var(--line-hair);height:var(--line-hair);overflow:hidden;clip-path:inset(50%)}
  .depth{color:var(--muted);font-size:var(--text-sm)}
  .phase{flex:none;font-size:var(--text-xs);color:var(--p);border:var(--line-hair) solid color-mix(in oklab,var(--p) 60%,transparent);border-radius:var(--radius-full);padding:0 var(--space-2)}
  .ask{flex:none;font-size:var(--text-xs);color:var(--accent);border:var(--line-hair) solid var(--accent);border-radius:var(--radius-full);padding:0 var(--space-2);background:color-mix(in oklab,var(--accent) 12%,transparent)}
  .edit{display:flex;justify-content:flex-end;border-top:var(--line-hair) solid var(--border);padding-top:var(--space-1)}
  .nodes{display:flex;flex-direction:column;gap:var(--space-2);min-width:0;border-top:var(--line-hair) solid var(--border);padding-top:var(--space-2)}
  .none{font-size:var(--text-sm)}
  @media (prefers-reduced-motion: reduce){.frame.busy{animation:none}}
</style>
