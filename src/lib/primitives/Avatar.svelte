<script>
  // An object's avatar (contract §5): its emoji or image (else initials), a status ring in its tone that pulses
  // while it runs, a badge (💬 asking, ⚠️ failed), dim when stopped or offline. Sizes are steps: sm · md · lg.
  import { store } from "../store.svelte.js";
  import { toneVar } from "../logic/tones.js";
  import { avatarState, initials, isAsset } from "../logic/avatar.js";
  let { icon = null, label = "", phase = "idle", tone = null, running = 0, asks = 0, failed = 0, size = "md" } = $props();
  const st = $derived(avatarState({ phase, running, asks, failed, online: store.status !== "reconnecting" && store.status !== "connecting" }));
</script>
<span class="av {size}" class:dim={st.dim} class:pulse={st.ring === "pulse"} class:ring={st.ring !== "none"}
  style:--t={toneVar(st.tone)} title="{label} · {st.word}" role="img" aria-label="{label}, {st.word}">
  {#if isAsset(icon)}<img src={icon} alt="" />{:else if icon}<span class="emoji" aria-hidden="true">{icon}</span>{:else}<span class="ini mono" aria-hidden="true">{initials(label)}</span>{/if}
  {#if st.badge}<span class="badge" aria-hidden="true">{st.badge}</span>{:else if st.dot}<i class="dot" aria-hidden="true"></i>{/if}
</span>
<style>
  .av{--s:var(--control-md);position:relative;flex:none;display:inline-grid;place-items:center;width:var(--s);height:var(--s);border-radius:50%;
    background:radial-gradient(circle at 30% 25%,color-mix(in oklab,var(--accent) 22%,var(--tint)),var(--tint) 70%);
    border:var(--line-hair) solid color-mix(in oklab,var(--t) 45%,var(--border));transition:opacity var(--motion-slow) var(--ease-calm),box-shadow var(--motion-slow) var(--ease-calm)}
  .av.sm{--s:var(--control-sm)}.av.xl{--s:var(--widget-avatar)}.av.lg{--s:calc(var(--control-lg) * 1.4)}
  .ring{box-shadow:0 0 0 var(--line-bold) color-mix(in oklab,var(--t) 70%,transparent)}
  .pulse{animation:halo var(--motion-pulse) var(--ease-calm) infinite}
  @keyframes halo{50%{box-shadow:0 0 0 var(--space-1) color-mix(in oklab,var(--t) 35%,transparent),0 0 var(--space-4) var(--line-hair) color-mix(in oklab,var(--t) 55%,transparent)}}
  .dim{opacity:.45;filter:grayscale(.8)}
  .emoji{font-size:calc(var(--s) * .55);line-height:1}
  .ini{font-size:calc(var(--s) * .36);color:var(--fg)}
  img{width:100%;height:100%;border-radius:50%;object-fit:cover}
  .badge{position:absolute;right:calc(var(--space-1) * -1);bottom:calc(var(--space-1) * -1);font-size:calc(var(--s) * .38);line-height:1}
  .dot{position:absolute;right:0;bottom:0;width:calc(var(--s) * .26);height:calc(var(--s) * .26);border-radius:50%;background:var(--t);border:var(--line-bold) solid var(--bg)}
  @media (prefers-reduced-motion: reduce){.pulse{animation:none}}
</style>
