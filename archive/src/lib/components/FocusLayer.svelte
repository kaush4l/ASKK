<script>
  // medium = the card expanded INTO the content area (design-rules §7): it grows in place from its grid rect to the
  // content box (right of the panel, above the composer) while the rest recedes behind a frosted scrim. Escape, the
  // scrim or Close return it; the size control goes on to the immersive scene (large, /focus?id=…).
  import { setContext } from "svelte";
  import { goto } from "$app/navigation";
  import { store } from "../store.svelte.js";
  import { expandBox, focusKey, focusHref } from "../logic/focus.js";
  import { ms, CALM } from "../logic/motion.js";
  import ObjectView from "../primitives/ObjectView.svelte";
  let box = $state(null), el = $state(null);
  const f = $derived(store.focus?.mode === "expand" ? store.focus : null);
  const close = () => (store.focus = null);
  const cssPx = (name) => { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); const d = document.createElement("div"); d.style.width = v || "0"; document.body.appendChild(d); const w = d.getBoundingClientRect().width; d.remove(); return w; };
  function measure() {
    const phone = innerWidth <= 768;
    const gap = phone ? cssPx("--space-2") : cssPx("--space-4");
    box = expandBox({ vw: innerWidth, vh: innerHeight, shell: phone ? 0 : cssPx("--shell"), composer: cssPx("--composer"), gap, top: phone ? cssPx("--control-lg") + cssPx("--space-4") : gap });
  }
  $effect(() => { if (f) measure(); });
  // the morph: from the card's rect in the grid to the content box (≤ 300 ms, none under reduced motion)
  $effect(() => {
    if (!el || !f?.from || !box) return;
    const d = ms("calm"); if (!d) return;
    const s = f.from;
    el.animate([{ transform: `translate(${s.x - box.x}px, ${s.y - box.y}px) scale(${s.w / box.w}, ${s.h / box.h})`, opacity: 0.6 }, { transform: "none", opacity: 1 }], { duration: d, easing: CALM, fill: "backwards" });
  });
  setContext("sizer", { get size() { return "medium"; }, inPlace: false, cycle: () => { const id = f.id; close(); goto(focusHref(id)); }, open: (size) => { if (size === "large") { const id = f.id; close(); goto(focusHref(id)); } }, close });
</script>
<svelte:window onkeydown={(e) => { if (f) store.focus = focusKey(store.focus, e.key); }} onresize={() => f && measure()} />
{#if f && box}
  <div class="recede" onclick={close} role="presentation"></div>
  <div class="exp" bind:this={el} role="dialog" aria-modal="true" aria-label="{store.find(f.id)?.title ?? f.id} (expanded)"
    style:left="{box.x}px" style:top="{box.y}px" style:width="{box.w}px" style:height="{box.h}px">
    {#key f.id}<ObjectView id={f.id} at="medium" />{/key}
  </div>
{/if}
<style>
  /* the rest recedes: dimmed and blurred behind (the frost is this layer; the card on it is a pane, never glass) */
  .recede{position:fixed;inset:0 0 var(--composer,var(--space-0)) 0;z-index:35;background:color-mix(in oklab,var(--bg) var(--glass-scrim),transparent);-webkit-backdrop-filter:blur(var(--space-2)) saturate(140%);backdrop-filter:blur(var(--space-2)) saturate(140%)}
  .exp{position:fixed;z-index:36;display:flex;flex-direction:column;transform-origin:0 0;border-radius:var(--radius-lg);box-shadow:var(--elev)}
  .exp > :global(.card){flex:1;min-height:0;overflow:hidden;border-radius:var(--radius-lg);background:color-mix(in oklab,var(--tint) 92%,transparent)}
  .exp > :global(.card > .main){flex:1;min-height:0}
  .exp > :global(.card > .main > .body){overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}
  @media (prefers-reduced-transparency: reduce){.recede{-webkit-backdrop-filter:none;backdrop-filter:none;background:var(--bg)}}
</style>
