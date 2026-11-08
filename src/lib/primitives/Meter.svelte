<script>
  import { toneVar } from "../logic/tones.js";
  let { label, value = 0, max = 100, tone } = $props();
  const pct = $derived(max > 0 ? Math.max(0, Math.min(100, (Number(value) / Number(max)) * 100)) : 0);
</script>
<div class="m">
  {#if label}<span class="l">{label}</span>{/if}
  <div class="bar" role="meter" aria-valuenow={value} aria-valuemax={max} aria-valuemin="0"><div style:width="{pct}%" style:background={toneVar(tone ?? "accent")}></div></div>
  <span class="v">{value}/{max}</span>
</div>
<style>
  .m{display:flex;align-items:center;gap:var(--space-2);min-width:0;flex:1;width:100%}.l{font-size:var(--text-sm)}
  .bar{flex:1;min-width:var(--control-xs);height:var(--space-2);border:var(--line-hair) solid var(--border);background:color-mix(in oklab,var(--fg) 6%,transparent);border-radius:var(--radius-full);overflow:hidden}.bar div{height:100%;border-radius:var(--radius-full);transition:width var(--motion-slow) var(--ease-calm)}
  .v{flex:none;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:var(--text-xs);color:var(--muted)}
</style>
