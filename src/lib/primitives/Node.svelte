<script>
  import Stack from "./Stack.svelte"; import Grid from "./Grid.svelte"; import Card from "./Card.svelte";
  import Text from "./Text.svelte"; import Badge from "./Badge.svelte"; import Meter from "./Meter.svelte";
  import Button from "./Button.svelte"; import Field from "./Field.svelte"; import Table from "./Table.svelte";
  import Code from "./Code.svelte"; import Divider from "./Divider.svelte"; import Slot from "./Slot.svelte";
  import Page from "./Page.svelte"; import Panel from "./ShellPanel.svelte"; import CardGrid from "./CardGrid.svelte";
  import Canvas from "./Canvas.svelte"; import Background from "./Background.svelte";
  import Unknown from "./Unknown.svelte"; import Avatar from "./Avatar.svelte"; import Composer from "./Composer.svelte"; import Widgets from "./Widgets.svelte";
  import Self from "./Node.svelte";
  import { primitiveFor } from "../logic/page.js";
  // view primitives (contract §5) and page primitives (contract §6): one registry, one renderer
  const REG = { Stack, Grid, Card, Text, Badge, Meter, Button, Field, Table, Code, Divider, Slot, Page, Panel, CardGrid, Canvas, Background, Avatar, Composer, Widgets, Unknown };
  let { node } = $props();
  const Comp = $derived(primitiveFor(REG, node?.c));
</script>

{#if node}
  <!-- a container's `children:` defaults travel as `cascade` (Svelte keeps `children` for the content) -->
  <Comp {...node.props ?? {}} cascade={node.props?.children} c={node.c}>
    {#each node.children ?? [] as child, i (i)}<Self node={child} />{/each}
  </Comp>
{/if}
