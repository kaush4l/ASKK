<script>
  import { toneVar } from "../logic/tones.js";
  import { text } from "../logic/scale.js";
  import { renderMarkdown, renderInline, mdInline, plainText } from "../logic/markdown.js";
  let { value = "", size = "md", tone, mono = false, md = false } = $props();
  const fs = $derived(text(size));
</script>
{#if md && mdInline(value)}
  <span class="t md inl" title={plainText(value)} class:mono style:font-size={fs} style:color={tone ? toneVar(tone) : null}>{@html renderInline(value)}</span>
{:else if md}
  <div class="t md" title={value} style:font-size={fs} style:color={tone ? toneVar(tone) : null}>{@html renderMarkdown(value)}</div>
{:else}
  <span class="t" title={value} class:mono style:font-size={fs} style:color={tone ? toneVar(tone) : null}>{value}</span>
{/if}
<style>
  .t{overflow-wrap:break-word;line-height:1.4;max-width:var(--width-text)}.mono{font-family:var(--font-mono);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
  .md :global(code){overflow-wrap:anywhere;word-break:break-word}
  .md :global(p),.md :global(ul){margin:var(--space-1) 0}.md :global(h3),.md :global(h4),.md :global(h5){margin:var(--space-1) 0}
</style>
