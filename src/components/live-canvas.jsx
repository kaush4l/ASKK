// Live canvas — a node-graph view, data-driven from the same
// snapshot as the agent card (src/core/ui-data.js canvasData).
// Nodes: agents, goal artifacts, tool calls. Edges: spawn,
// report, phase-transition. Nothing here is a static page: a
// node or edge appears only when the snapshot carries it.
"use client";

import { canvasData } from "@/core/ui-data.js";

export default function LiveCanvas({ snapshot }) {
  if (!snapshot) {
    return (
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No live snapshot yet — the canvas renders from the same snapshot as
          the agent card once it loads.
        </p>
      </section>
    );
  }
  const data = canvasData(snapshot);
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <span className="font-mono text-base">Live canvas</span>
      {data.nodes.length === 0 && (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          No nodes in this snapshot.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {data.nodes.map((node) => (
          <span
            key={node.id}
            data-node-kind={node.kind}
            className="rounded-full border px-3 py-1 text-sm"
          >
            {node.kind}: {node.label}
            {node.status ? ` · ${node.status}` : ""}
          </span>
        ))}
      </div>
      {data.edges.length > 0 && (
        <div className="mt-3">
          {data.edges.map((edge, index) => (
            <p
              key={`${edge.from}-${edge.to}-${index}`}
              className="font-mono text-sm text-zinc-600 dark:text-zinc-400"
            >
              {edge.from} --{edge.kind}--&gt; {edge.to}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
