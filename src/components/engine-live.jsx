// Engine live object — the live panel for the current engine.
// Plain data only: model id, provider, endpoint, a short
// instructions preview, desk default status, inference count, and
// the session message count. No keys, no secrets, ever.
export default function EngineLive({ live, messageCount }) {
  const ready = Boolean(live?.hasDefault);
  const inference = live?.defaultInference ?? null;
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold">Live engine</h2>
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
            <dd>{live.engine?.model ?? inference?.model ?? "—"}</dd>
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
        </dl>
      )}
    </section>
  );
}
