<script>
  import { goto } from "$app/navigation";
  import Destination from "$lib/components/Destination.svelte";
  import ModelsEditor from "$lib/components/ModelsEditor.svelte";
</script>
<Destination label="Models"><ModelsEditor done={() => goto("/")} /></Destination>
