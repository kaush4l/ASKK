// Agent dashboard + canvas — the screen space the agent is sent to.
//
// ONE prop for data: renderTree, the tree from renderAgentForScreen
// (src/core/agent-render.js) — the agent, rendered from what it
// holds. PLUS an optional signal prop: when given, this component
// SUBSCRIBES to that signal itself (useLiveState) and re-renders
// when the signal's value changes — signal -> DOM, no refetch by
// this component, no poll by this component. The transport that
// feeds the signal lives in src/lib/component-transport.js
// (SSE first, polling fallback); this component only subscribes.
//
// This component renders dashboard = the agent's elements and
// canvas = the agent's children + artifacts + goal, by ITERATING
// the render tree. It contains no list of element names, tool
// names, panels, or model defaults of its own: every section/card
// it renders comes from an entry in the tree, so a different
// agent renders a different dashboard/canvas with no change to
// this component.
//
// Per-kind live UI (not generic snapshot only): tools render as
// ToolComponent, artifacts as ArtifactComponent (script, watcher,
// goal, generic kinds), subagents as AgentComponent, the agent
// element as EngineComponent. SnapshotValue remains ONLY as the
// fallback for entries no per-kind component knows.
//
// This is NOT a chat window, and chat is not added here: chat is
// secondary input elsewhere on the page. This space is the
// agent's live elements and its live canvas objects, rendered
// dynamically from the tree.
"use client";

import AgentComponent from "@/components/agent-component";
import ArtifactComponent from "@/components/artifact-component";
import EngineComponent from "@/components/engine-component";
import SnapshotValue from "@/components/snapshot-value";
import ToolComponent from "@/components/tool-component";
import { useLiveState } from "@/lib/use-live-state";

function TreeEntry({ entry }) {
  return (
    <section
      data-testid={`agent-tree-${entry.id}`}
      className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-black dark:text-zinc-50">
          {entry.id}
        </h3>
        <span className="text-xs text-zinc-500">{entry.kind}</span>
      </div>
      {Array.isArray(entry.attributes) && entry.attributes.length > 0 && (
        <p className="text-xs text-zinc-500">{entry.attributes.join(" · ")}</p>
      )}
      <SnapshotValue value={entry.snapshot} />
    </section>
  );
}

function DashboardEntry({ entry }) {
  if (entry.id === "agent") {
    return <EngineComponent snapshot={entry.snapshot} />;
  }
  if (entry.id === "tools" && Array.isArray(entry.snapshot?.tools)) {
    return (
      <>
        {entry.snapshot.tools.map((tool, index) => (
          <ToolComponent
            key={tool?.name ?? index}
            snapshot={typeof tool === "string" ? { name: tool } : tool}
          />
        ))}
      </>
    );
  }
  if (entry.id === "artifacts" && Array.isArray(entry.snapshot?.artifacts)) {
    return (
      <>
        {entry.snapshot.artifacts.map((artifact, index) => (
          <ArtifactComponent key={artifact?.id ?? index} snapshot={artifact} />
        ))}
      </>
    );
  }
  return <TreeEntry entry={entry} />;
}

function CanvasEntry({ entry }) {
  if (entry.kind === "artifact" || entry.kind === "goal") {
    return <ArtifactComponent snapshot={entry.snapshot} />;
  }
  if (entry.kind === "subagent") {
    return <AgentComponent snapshot={entry.snapshot} />;
  }
  return <TreeEntry entry={entry} />;
}

export default function AgentDashboardCanvas({ renderTree, signal }) {
  const liveTree = useLiveState(signal, renderTree) ?? renderTree;
  if (!liveTree || typeof liveTree !== "object") {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Agent dashboard and canvas unavailable: no agent render tree.
      </p>
    );
  }
  const dashboard = Array.isArray(liveTree.dashboard) ? liveTree.dashboard : [];
  const canvas = Array.isArray(liveTree.canvas) ? liveTree.canvas : [];
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-black dark:text-zinc-50">
          Dashboard
        </h2>
        {dashboard.length === 0 && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            This agent holds no elements.
          </p>
        )}
        {dashboard.map((entry) => (
          <DashboardEntry key={entry.id} entry={entry} />
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-black dark:text-zinc-50">
          Canvas
        </h2>
        {canvas.length === 0 && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            This agent has no canvas objects.
          </p>
        )}
        {canvas.map((entry) => (
          <CanvasEntry key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}
