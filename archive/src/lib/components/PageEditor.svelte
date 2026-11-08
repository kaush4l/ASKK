<script>
  // Edit mode: the page tree's properties with live preview — the background (image by URL or upload, fields,
  // ripples, tint, blur, dim), the card grid (min width, gap) and the canvas (grid, minimap, edges), each a scale
  // step (docs/design-rules.md). Save → POST /ui (a raw value is refused there); Cancel puts it back.
  import { untrack } from "svelte";
  import { store } from "../store.svelte.js";
  import { pageTree, findNode, withProps, DEFAULT_BACKGROUND } from "../logic/page.js";
  import { SPACE_MAX, spaceStep, widthStep, blurStep, dimStep } from "../logic/scale.js";
  import { EDGE_STYLES as EDGES } from "../logic/canvas.js";
  import { TONES } from "../logic/tones.js";
  const TINTS = [...TONES, "wall-a", "wall-b", "wall-c", "wall-d"];
  const WIDTHS = ["xs", "sm", "md", "lg", "xl"];
  let { view, done } = $props();
  const orig = structuredClone($state.snapshot(pageTree(store.world, view)));
  let tree = $state(structuredClone(orig));
  const bg = $derived(tree.props?.background ?? {});
  const grid = $derived(findNode(tree, "CardGrid"));
  // live preview: the route renders world.ui[view]
  $effect(() => { const t = $state.snapshot(tree); untrack(() => { if (store.world) store.world.ui = { ...(store.world.ui ?? {}), [view]: t }; }); });
  const snap = () => $state.snapshot(tree);
  const setBg = (k, v) => { const t = snap(); tree = withProps(t, [], { background: { ...(t.props?.background ?? {}), [k]: v } }); };
  const setGrid = (k, v) => { if (grid) tree = withProps(snap(), grid.path, { [k]: v }); };
  const canvas = $derived(findNode(tree, "Canvas"));
  const setCanvas = (k, v) => { if (canvas) tree = withProps(snap(), canvas.path, { [k]: v }); };
  let uploading = $state(false);
  async function upload(e) {
    const f = e.currentTarget.files?.[0];
    if (!f) return;
    uploading = true;
    const url = await store.uploadAsset(f);
    uploading = false;
    if (url) setBg("image", url);
  }
  function cancel() { if (store.world) store.world.ui = { ...(store.world.ui ?? {}), [view]: orig }; done(); }
  async function save() { await store.saveUi(view, $state.snapshot(tree)); done(); }
  const fieldsOn = $derived((bg.fields ?? []).length > 0);
</script>
<div class="pe">
  <h3>Page · {view}</h3>
  <label><span>image URL</span><input value={bg.image ?? ""} placeholder="/ui/assets/wall.jpg or https://…" oninput={(e) => setBg("image", e.currentTarget.value || null)} /></label>
  <label><span>upload</span><input type="file" accept="image/*" onchange={upload} disabled={uploading} /></label>
  <label class="chk"><input type="checkbox" checked={fieldsOn} onchange={(e) => setBg("fields", e.currentTarget.checked ? DEFAULT_BACKGROUND.fields : [])} /><span>colour fields</span></label>
  <label class="chk"><input type="checkbox" checked={!!bg.wash} onchange={(e) => setBg("wash", e.currentTarget.checked)} /><span>wash</span></label>
  <label class="chk"><input type="checkbox" checked={!!bg.ripples} onchange={(e) => setBg("ripples", e.currentTarget.checked)} /><span>ripples</span></label>
  <label><span>tint</span><select value={bg.tint ?? ""} onchange={(e) => setBg("tint", e.currentTarget.value || null)}><option value="">none</option>{#each TINTS as t}<option value={t}>{t}</option>{/each}</select></label>
  <label><span>blur {blurStep(bg.blur)}</span><input type="range" min="0" max={SPACE_MAX} value={blurStep(bg.blur)} oninput={(e) => setBg("blur", Number(e.currentTarget.value))} /></label>
  <label><span>dim {dimStep(bg.dim)}</span><input type="range" min="0" max={SPACE_MAX} value={dimStep(bg.dim)} oninput={(e) => setBg("dim", Number(e.currentTarget.value))} /></label>
  {#if grid}
    <h3>Card grid</h3>
    <label><span>min width</span><select value={widthStep(grid.node.props?.min)} onchange={(e) => setGrid("min", e.currentTarget.value)}>{#each WIDTHS as w}<option value={w}>{w}</option>{/each}</select></label>
    <label><span>gap {spaceStep(grid.node.props?.gap, 4)}</span><input type="range" min="0" max={SPACE_MAX} value={spaceStep(grid.node.props?.gap, 4)} oninput={(e) => setGrid("gap", Number(e.currentTarget.value))} /></label>
  {/if}
  {#if canvas}
    <h3>Canvas</h3>
    <label class="chk"><input type="checkbox" checked={canvas.node.props?.grid !== false} onchange={(e) => setCanvas("grid", e.currentTarget.checked)} /><span>grid</span></label>
    <label class="chk"><input type="checkbox" checked={canvas.node.props?.minimap !== false} onchange={(e) => setCanvas("minimap", e.currentTarget.checked)} /><span>minimap</span></label>
    <label><span>edges</span><select value={canvas.node.props?.edges ?? "curve"} onchange={(e) => setCanvas("edges", e.currentTarget.value)}>{#each EDGES as x}<option value={x}>{x}</option>{/each}</select></label>
  {/if}
  <div class="row"><button class="btn primary" onclick={save}>Save page</button><button class="btn" onclick={cancel}>Cancel</button></div>
</div>
<style>
  .pe{display:flex;flex-direction:column;gap:var(--space-2)}h3{margin:var(--space-2) 0 0;font-weight:400;font-size:var(--text-md);color:var(--muted)}
  label{display:flex;gap:var(--space-2);align-items:center;min-height:var(--control-md)}label span{width:var(--width-label);flex:none;font-family:var(--font-mono);font-size:var(--text-xs)}
  input:not([type=checkbox]),select{min-height:var(--control-md);flex:1;min-width:0;padding:0 var(--space-2);border:var(--line-hair) solid var(--border);border-radius:var(--radius-sm);background:color-mix(in oklab,var(--bg) 60%,transparent);color:var(--fg)}
  input[type=range]{padding:0}.chk input{width:var(--control-xs);height:var(--control-xs)}.chk span{width:auto}
  .row{display:flex;gap:var(--space-2);margin-top:var(--space-2)}
</style>
