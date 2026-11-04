// Agent component — a spawned subagent's own live UI. This is
// a DERIVED kind (an engine instance for that agent), not a
// core base: core bases are engine, tool, artifact. Shows the
// agent's name, role, status, current phase, and tool names.
//
// Props: { snapshot, signal }. When a signal is given, the
// component subscribes to it itself (useLiveState) and
// re-renders on signal change — signal -> DOM, no refetch.
"use client";

import { useLiveState } from "@/lib/use-live-state";

export default function AgentComponent({ snapshot, signal }) {
  const live = useLiveState(signal, snapshot) ?? snapshot ?? {};
  const tools = Array.isArray(live.tools) ? live.tools : [];
  return (
    <section
      data-testid={`agent-component-${live.name ?? live.id ?? "agent"}`}
      className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-black dark:text-zinc-50">
          Subagent: {live.name ?? live.id ?? "agent"}
        </h3>
        <span className="text-xs text-zinc-500">
          {live.status ?? live.lifecycle ?? "running"}
        </span>
      </div>
      {live.role ? <p className="text-sm">{live.role}</p> : null}
      <p className="text-xs text-zinc-500">
        Phase: {live.currentPhase ?? "—"}
        {tools.length > 0 ? ` · tools: ${tools.join(", ")}` : ""}
      </p>
    </section>
  );
}
