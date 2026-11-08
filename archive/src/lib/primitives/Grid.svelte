<script>
  import { width, space } from "../logic/scale.js";
  let { min = "sm", gap = 3, children } = $props();
</script>
<div style:grid-template-columns="repeat(auto-fill, minmax(min({width(min)}, 100%), 1fr))" style:gap={space(gap, 3)}>{@render children?.()}</div>
<style>div{display:grid}</style>
