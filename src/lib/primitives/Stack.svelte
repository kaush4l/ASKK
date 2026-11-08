<script>
  import { space } from "../logic/scale.js";
  let { dir = "col", gap = 2, pad = 0, align = "start", wrap = false, children } = $props();
  const j = { start: "flex-start", center: "center", end: "flex-end", between: "space-between" };
</script>
<div class:line={dir === "row" && !wrap} style:flex-direction={dir === "row" ? "row" : "column"} style:gap={space(gap, 2)} style:padding={pad ? space(pad, 0) : null}
  style:justify-content={dir === "row" ? j[align] : null} style:align-items={dir === "row" ? "center" : (align === "between" ? "stretch" : j[align] ?? "stretch")}
  style:flex-wrap={wrap ? "wrap" : "nowrap"}>{@render children?.()}</div>
<style>
  div{display:flex;min-width:0}
  /* Nothing a stack holds is wider than the stack (a long badge ellipsizes, a wrapped row wraps inside its card). */
  div > :global(*){max-width:100%}
  /* One-line rows: the first item is the title (never broken mid-word, ellipsis), values flex, badges keep their size. */
  .line > :global(*){flex:none;min-width:0}
  .line > :global(.t){white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .line > :global(.t:first-child){flex:0 1 auto;max-width:60%}
  .line > :global(.t:not(:first-child)){flex:1 1 0}
  .line > :global(.m){flex:1 1 0;min-width:0}
  .line > :global(.md *){display:inline;margin:0;font-size:inherit}
</style>
