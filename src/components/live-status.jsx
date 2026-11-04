// Live status — the typing-icon status indicator for the
// live-agent section. It shows the working with a status (glyph
// + word + current step/call name + animated dots while
// running, settled when idle/done) and, below it, the live steps
// list: stable call ids, parallel groups, partial results, and
// failed calls all visible. Everything is data-driven from the
// snapshot (or from a signal holding one) — no hardcoded steps,
// agents, or tool names.
//
// Two inputs, one view: `snapshot` renders directly, `signal`
// subscribes via useLiveState and re-renders on state change
// only. The home page's live-agent section passes the engine
// signal; the card section passes its snapshot. Code-level
// verification only (build + dev HTTP): no live-browser clicks
// are claimed for this component.
"use client";

import { liveStatusData } from "@/core/ui-data.js";
import { useLiveState } from "@/lib/use-live-state.js";

function LiveStatusView({ snapshot }) {
  const data = liveStatusData(snapshot);
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-sm">
        <span aria-hidden="true">{data.glyph}</span> {data.word}
        {data.currentStep ? ` · ${data.currentStep}` : ""}
        {data.running && (
          <span aria-hidden="true" className="ml-2 inline-flex gap-1">
            <span className="animate-pulse">•</span>
            <span className="animate-pulse" style={{ animationDelay: "150ms" }}>
              •
            </span>
            <span className="animate-pulse" style={{ animationDelay: "300ms" }}>
              •
            </span>
          </span>
        )}
      </p>
      {data.steps.length > 0 && (
        <ul className="mt-3 space-y-1">
          {data.steps.map((step) => (
            <li key={step.id} className="font-mono text-sm">
              {step.name} · {step.status}
              {step.parallelGroup && step.parallelGroup !== "sequential"
                ? ` · group ${step.parallelGroup}`
                : ""}
              {step.partial ? " · partial" : ""}
            </li>
          ))}
        </ul>
      )}
      {data.steps.length === 0 && !data.running && (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Settled — nothing running.
        </p>
      )}
    </div>
  );
}

function LiveStatusSignal({ signal, fallback }) {
  const snapshot = useLiveState(signal, fallback);
  return <LiveStatusView snapshot={snapshot} />;
}

export default function LiveStatus({ snapshot = null, signal = null }) {
  if (signal) {
    return <LiveStatusSignal signal={signal} fallback={snapshot} />;
  }
  return <LiveStatusView snapshot={snapshot} />;
}
