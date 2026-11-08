<script>
  // /e/<engine or element id> — that object's full view, in the centre.
  import { page } from "$app/state";
  import { routeOf } from "$lib/logic/routes.js";
  import { store } from "$lib/store.svelte.js";
  import Destination from "$lib/components/Destination.svelte";
  import ObjectView from "$lib/primitives/ObjectView.svelte";
  const r = $derived(routeOf(page.url));
  const obj = $derived(r.id ? store.find(r.id) : null);
</script>
<Destination label={obj?.title ?? r.id}>
  {#if obj}{#key r.id}<ObjectView id={r.id} at="large" />{/key}{:else}<p class="muted">No object {r.id}. <a href="/">Back to the dashboard</a></p>{/if}
</Destination>
