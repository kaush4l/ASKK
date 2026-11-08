<script>
  // The live status of an object: a light in its phase tone (pulsing while it works) and one line of what
  // it does now. A change cross-fades in place: the old and new line share one grid cell, nothing moves.
  import { fade } from "svelte/transition";
  import { toneVar } from "../logic/tones.js";
  import { ms, clock } from "../logic/motion.js";
  let { status, phase, compact = false } = $props();
  const busy = $derived(phase === "running" || phase === "waiting");
  const line = $derived(String(status?.now ?? phase ?? ""));
  const since = $derived(!compact && !busy && status?.since ? clock(status.since) : "");
</script>
<span class="st" class:compact title="{line}{since ? ` · since ${since}` : ''}" aria-live="polite">
  <i class="light" class:pulse={busy} style:--t={toneVar(status?.light, phase)} aria-hidden="true"></i>
  <span class="now">{#key line + since}<span class="txt" in:fade={{ duration: ms("base") }} out:fade={{ duration: ms("fast") }}>{line}{#if since}<span class="since">&nbsp;· since {since}</span>{/if}</span>{/key}</span>
</span>
<style>
  .st{display:flex;align-items:center;gap:var(--space-2);min-width:0;font-family:var(--font-mono);font-size:var(--text-xs);color:var(--muted);font-variant-numeric:tabular-nums}
  .light{flex:none;width:var(--icon-xs);height:var(--icon-xs);border-radius:50%;background:var(--t);box-shadow:0 0 0 calc(var(--space-1) - var(--line-hair)) color-mix(in oklab,var(--t) 18%,transparent);transition:background-color var(--motion-slow) var(--ease-calm),box-shadow var(--motion-slow) var(--ease-calm)}
  .pulse{animation:pulse var(--motion-pulse) var(--ease-calm) infinite}
  @keyframes pulse{50%{box-shadow:0 0 0 var(--space-2) color-mix(in oklab,var(--t) 0%,transparent),0 0 var(--space-3) var(--line-hair) color-mix(in oklab,var(--t) 60%,transparent)}}
  .now{display:grid;min-width:0;flex:1}
  .txt{grid-area:1/1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .since{opacity:.8}
  @media (prefers-reduced-motion: reduce){.pulse{animation:none}}
</style>
