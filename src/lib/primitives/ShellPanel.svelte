<script>
  // The page tree's `Panel`: the one left panel of the shell (design-rules §5).
  import { getContext } from "svelte";
  import Panel from "../components/Panel.svelte";
  const shell = getContext("shell") ?? {};
</script>
<Panel onTheme={() => shell.theme?.()} onPage={() => shell.page?.()} />
