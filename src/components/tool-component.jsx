// Tool component — a tool's own live UI. Shows the tool's
// name, its description (from the tool itself), its lifecycle,
// and its latest call: args, result, duration, error.
//
// Props: { snapshot, signal }. When a signal is given, the
// component subscribes to it itself (useLiveState) and
// re-renders on signal change — signal -> DOM, no refetch.
"use client";

import SnapshotValue from "@/components/snapshot-value";
import { useLiveState } from "@/lib/use-live-state";

export default function ToolComponent({ snapshot, signal }) {
  const live = useLiveState(signal, snapshot) ?? snapshot ?? {};
  return (
    <section
      data-testid={`tool-component-${live.name ?? live.id ?? "tool"}`}
      className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-black dark:text-zinc-50">
          Tool: {live.name ?? live.id ?? "tool"}
        </h3>
        <span className="text-xs text-zinc-500">
          {live.lifecycle ?? "idle"}
        </span>
      </div>
      {live.description ? <p className="text-sm">{live.description}</p> : null}
      <p className="text-xs text-zinc-500">
        Last call: {live.lastCall ? JSON.stringify(live.lastCall) : "—"}
        {live.lastDuration !== null && live.lastDuration !== undefined
          ? ` · ${live.lastDuration}ms`
          : ""}
      </p>
      {live.lastError ? (
        <p className="text-sm text-red-600">Error: {String(live.lastError)}</p>
      ) : live.lastResult !== null && live.lastResult !== undefined ? (
        <div className="text-sm">
          <SnapshotValue value={live.lastResult} />
        </div>
      ) : null}
    </section>
  );
}
