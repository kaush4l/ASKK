<script>
  import { store } from "$lib/store.svelte.js";
  // /page?view=dashboard|canvas — the page tree editor for that view.
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { routeOf, homeOf } from "$lib/logic/routes.js";
  import Destination from "$lib/components/Destination.svelte";
  import PageEditor from "$lib/components/PageEditor.svelte";
  const r = $derived(routeOf(page.url));
</script>
{#key r.view}<Destination view={r.view} label="Page">{#if store.locked}<p class="muted">Theme and Page are edit tools: Unlock in the panel to use them.</p>{:else}<PageEditor view={r.view} done={() => goto(homeOf(r))} />{/if}</Destination>{/key}
