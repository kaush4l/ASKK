<script>
  // Embeds another object's own card at a size; the embedded object is interactive where it is shown.
  import ObjectItem from "../components/ObjectItem.svelte";
  let { of, at = "small" } = $props();
</script>
{#key of}<ObjectItem id={of} {at} />{/key}
