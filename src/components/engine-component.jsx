// Engine component — the engine's own live UI, not a generic
// snapshot. The engine's general state is a LOOP, so this
// component shows loop state: current phase, current tool call,
// subagents created, waiting / running / done — never a chat
// transcript.
//
// Props: { snapshot, signal }. When a signal is given, the
// component SUBSCRIBES to it itself (useLiveState) and
// re-renders when the signal's value changes — that is the
// signal -> DOM path. Without a signal it renders the snapshot
// it was given (static, e.g. server-rendered first paint).
"use client";

import { useLiveState } from "@/lib/use-live-state";

export default function EngineComponent({ snapshot, signal }) {
  const live = useLiveState(signal, snapshot) ?? snapshot ?? {};
  const loopState = live.loopState ?? live.state?.loopState ?? {};
  const subagents = Array.isArray(loopState.subagents)
    ? loopState.subagents
    : [];
  const toolCalls = loopState.toolCalls ?? {};
  const calls = Array.isArray(live.calls) ? live.calls : [];
  return (
    <section
      data-testid={`engine-component-${live.id ?? live.name ?? "engine"}`}
      className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-black dark:text-zinc-50">
          Engine: {live.name ?? live.id ?? "engine"}
        </h3>
        <span className="text-xs text-zinc-500">
          {live.lifecycle ?? live.status ?? "idle"}
        </span>
      </div>
      <p className="text-sm">
        Phase:{" "}
        <span className="font-medium">{loopState.currentPhase ?? "—"}</span>
        {" · "}Current tool call:{" "}
        <span className="font-medium">{loopState.currentToolCall ?? "—"}</span>
      </p>
      <p className="text-xs text-zinc-500">
        Subagents: {subagents.length} · waiting {loopState.waiting ?? 0} ·
        running {loopState.running ?? 0} · done {loopState.done ?? 0} · tool
        calls done {toolCalls.done ?? 0} · failed {toolCalls.failed ?? 0}
      </p>
      {subagents.length > 0 && (
        <ul className="flex flex-col gap-1 pl-4">
          {subagents.map((sub) => (
            <li
              key={sub.name ?? sub.id ?? String(sub)}
              className="list-disc text-sm"
            >
              {sub.name ?? sub.id ?? String(sub)} — {sub.status ?? "running"}
            </li>
          ))}
        </ul>
      )}
      {calls.length > 0 && (
        <ul className="flex flex-col gap-1 pl-4">
          {calls.slice(-5).map((call) => (
            <li
              key={`${call.name}-${call.duration ?? 0}`}
              className="list-disc text-sm"
            >
              {call.name}
              {call.error ? ` — error: ${call.error}` : " — done"}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
