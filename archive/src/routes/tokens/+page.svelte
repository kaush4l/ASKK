<script>
  import { store } from "$lib/store.svelte.js";
  import { goto } from "$app/navigation";
  import Destination from "$lib/components/Destination.svelte";
  import ThemeEditor from "$lib/components/ThemeEditor.svelte";
</script>
<Destination label="Theme">{#if store.locked}<p class="muted">Theme and Page are edit tools: Unlock in the panel to use them.</p>{:else}<ThemeEditor done={() => goto("/")} />{/if}</Destination>
