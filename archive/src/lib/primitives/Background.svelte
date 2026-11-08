<script>
  // The wall behind everything (design-rules §2): colour fields in the wall tokens (hard-edged so the glass has
  // something to soften), an optional image, a fine ripple, then a tint and a dim. Fixed, painted once, no events.
  // Every value is a step: blur 0–6 (the space scale), dim 0–6 (tenths), tint a colour token.
  import { fieldsCss, imageUrl, colorOf } from "../logic/page.js";
  import { blurStep, dimStep } from "../logic/scale.js";
  let { image = null, fields = [], wash = false, ripples = false, tint = null, blur = 0, dim = 0, fit = "cover" } = $props();
  const shapes = $derived(fieldsCss(fields, wash));
  const img = $derived(imageUrl(image));
  const tinted = $derived(colorOf(tint));
  const b = $derived(blurStep(blur)), d = $derived(dimStep(dim));
</script>
<div class="bg" aria-hidden="true">
  {#if shapes}<div class="layer shapes" style:background={shapes}></div>{/if}
  {#if img}<div class="layer img" style:background-image="url({img})" style:background-size={fit === "contain" ? "contain" : "cover"} style:filter={b > 0 ? `blur(var(--space-${b}))` : null}></div>{/if}
  {#if ripples}<div class="layer ripples"></div>{/if}
  {#if tinted}<div class="layer" style:background="color-mix(in oklab,{tinted} 28%,transparent)"></div>{/if}
  {#if d > 0}<div class="layer dim" style:opacity={d / 10}></div>{/if}
</div>
<style>
  .bg{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;background:var(--bg);transition:background-color var(--motion-slow) var(--ease-calm)}
  .layer{position:absolute;inset:0;transition:opacity var(--motion-slow) var(--ease-calm)}
  .shapes{inset:-6vh -2vw}
  .img{inset:calc(var(--space-6) * -1.25);background-position:center;background-repeat:no-repeat}
  .ripples{inset:-6vh -2vw;background-color:var(--ripple);
    --r:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1800' height='1200'%3E%3Cfilter id='r' x='0' y='0' width='100%25' height='100%25'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.0013 .0034' numOctaves='2' seed='23'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 2.4 0 0 0 -.7'/%3E%3CfeComponentTransfer%3E%3CfeFuncA type='table' tableValues='0 .9 .1 0 .8 .1 0 .9 .1 0'/%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23r)'/%3E%3C/svg%3E");
    -webkit-mask:var(--r) center/cover;mask:var(--r) center/cover}
  .dim{background:var(--ink)}
  @media (prefers-reduced-transparency: reduce){.shapes,.ripples,.img{display:none}}
</style>
