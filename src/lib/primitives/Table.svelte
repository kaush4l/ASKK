<script>let { columns = [], rows = [] } = $props();</script>
<div class="wrap"><table>
  <thead><tr>{#each columns as c}<th>{c}</th>{/each}</tr></thead>
  <tbody>{#each rows as r}<tr>{#each r as v}<td>{v}</td>{/each}</tr>{/each}</tbody>
</table></div>
<style>.wrap{overflow-x:auto;max-width:100%}table{border-collapse:collapse;font-size:var(--text-sm);width:100%}th,td{border-bottom:var(--line-hair) solid var(--border);padding:var(--space-1) var(--space-2);text-align:left;white-space:nowrap}th{color:var(--muted);font-weight:400}td{font-family:var(--font-mono);font-variant-numeric:tabular-nums}</style>
