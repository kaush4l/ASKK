// Engine live object — the live panel for the current engine.
// Plain data only: model id, provider, endpoint, a short
// instructions preview, desk default status, inference count, and
// the session message count. No keys, no secrets, ever.
//
// The panel also shows the live activity state (see
// src/core/activity.js): a dot + text from engineTone(activity).
// Activity is real, not decorative: the chat client sets it to
// llm while a /api/chat request is in flight, idle when nothing
// is working, error on failure, connecting while the live object
// loads, and no-model when the desk has no default. Tool, tools
// and waiting are defined in the activity module but never fire
// here — this skeleton has no tools yet.
import { describeActivity, engineTone } from "@/core/activity.js";
import { cn } from "@/lib/utils";

export default function EngineLive({ live, messageCount, activity, stats }) {
  const ready = Boolean(live?.hasDefault);
  const inference = live?.defaultInference ?? null;
  const tone = engineTone(activity ?? { phase: live ? "idle" : "connecting" });
  const model = live?.engine?.model ?? inference?.model ?? "—";
  const modelSource =
    live?.engine?.model && inference?.id && live.engine.model !== inference.id
      ? "engine override"
      : "desk default";
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold">Live engine</h2>
      <div className="flex items-center gap-2 text-sm" aria-live="polite">
        <span
          aria-hidden
          className={cn("size-2 shrink-0 rounded-full", tone.dot)}
        />
        <span>
          {describeActivity(
            activity ?? { phase: live ? "idle" : "connecting" },
          )}
        </span>
      </div>
      {!live && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Loading engine…
        </p>
      )}
      {live && (
        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex gap-2">
            <dt className="w-32 shrink-0 text-zinc-500">Status</dt>
            <dd>{ready ? "Ready" : "No model configured"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-32 shrink-0 text-zinc-500">Model</dt>
            <dd>
              {model} <span className="text-zinc-500">({modelSource})</span>
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-32 shrink-0 text-zinc-500">Provider</dt>
            <dd>{inference?.provider ?? "—"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-32 shrink-0 text-zinc-500">Endpoint</dt>
            <dd className="break-all">{inference?.endpoint ?? "—"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-32 shrink-0 text-zinc-500">Instructions</dt>
            <dd>{live.engine?.instructionsPreview ?? "—"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-32 shrink-0 text-zinc-500">Models in store</dt>
            <dd>{live.inferenceCount}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-32 shrink-0 text-zinc-500">Messages</dt>
            <dd>{messageCount}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-32 shrink-0 text-zinc-500">Model calls</dt>
            <dd>
              {stats
                ? `${stats.calls}×${stats.lastMs == null ? "" : ` · last ${stats.lastMs} ms`}`
                : "—"}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
