<script>
  import { store } from "../store.svelte.js";
  import ObjectView from "../primitives/ObjectView.svelte";
  const obj = $derived(store.sheet ? store.find(store.sheet) : null);
  const close = () => (store.sheet = null);
</script>
<svelte:window onkeydown={(e) => e.key === "Escape" && close()} />
{#if store.sheet}
  <div class="scrim" onclick={close} role="presentation"></div>
  <div class="sheet glass" role="dialog" aria-modal="true" tabindex="-1" aria-label={obj?.title ?? store.sheet}>
    <div class="head"><span class="muted">{store.sheet}</span><button class="btn" onclick={close}>Close</button></div>
    {#key store.sheet}<ObjectView id={store.sheet} at="large" />{/key}
  </div>
{/if}
<style>
  .scrim{position:fixed;inset:0;background:color-mix(in srgb,var(--ink) 30%,transparent);z-index:40}
  .sheet{position:fixed;z-index:41;padding:var(--space-4);overflow:auto;display:flex;flex-direction:column;gap:var(--space-3);
    left:0;right:0;bottom:0;max-height:85dvh;border-radius:var(--radius-lg) var(--radius-lg) 0 0}
  @media (min-width:640px){.sheet{left:auto;right:var(--space-3);top:var(--space-3);bottom:var(--space-3);width:min(var(--width-lg),90vw);max-height:none;border-radius:var(--radius-lg)}}
  .head{display:flex;justify-content:space-between;align-items:center;font-family:var(--font-mono);font-size:var(--text-xs)}
</style>
