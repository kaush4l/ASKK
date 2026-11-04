// Models — TEMPLATE page (separate view, not a dashboard section).
// Renders providers from the desk snapshot on load: saved ones only,
// no built-ins, no defaults to fill a void. Empty state if none added.
// No real model calls in this PR: Use/Test/Edit/Delete are template
// actions — Test is mocked server-side in providers.js, and no call
// is made from this page. Capability + template rendering are what
// this page proves.
"use client";

import { useEffect, useState } from "react";

export default function ModelsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/desk-snapshot?agent=developer")
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "desk snapshot failed");
        setData(body);
      })
      .catch((err) => setError(err.message));
  }, []);
  const providers = data?.providers?.providers ?? [];
  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col gap-6 px-6 py-10">
        <div className="flex items-baseline justify-between">
          <span className="text-xl font-semibold tracking-tight">Models</span>
          <a
            href="/"
            className="text-sm font-medium text-zinc-600 dark:text-zinc-400"
          >
            ← Dashboard
          </a>
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Every model the desks can call. Only what was added is shown — no
          built-ins, no defaults to fill a void. Template page only: no real
          model calls are made from here in this PR.
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!data && !error && (
          <p className="text-sm text-zinc-600">Loading saved providers…</p>
        )}
        {data && providers.length === 0 && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No providers added yet. Add a provider (API: OpenAI / Anthropic /
            OpenAI-compatible local, or CLI: Claude / OpenAI / Gemini) and it
            will appear here on load.
          </p>
        )}
        {providers.map((p) => (
          <section
            key={p.id}
            className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-mono text-base">{p.id}</span>
              <span className="text-sm text-zinc-600">
                {p.isDefault ? "☆ this desk's default" : ""}
              </span>
            </div>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {p.label} · {p.kind} · {p.model}
              {p.endpoint ? ` · ${p.endpoint}` : ""}
              {p.command ? ` · ${p.command} (this machine)` : ""}
              {p.tokens ? ` · ${p.tokens} tokens` : ""}
              {p.keySet ? " · key set" : " · no key"}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="rounded-full border px-4 py-1 text-sm"
                disabled
              >
                Use (template)
              </button>
              <button
                type="button"
                className="rounded-full border px-4 py-1 text-sm"
                disabled
              >
                Test (mocked)
              </button>
              <button
                type="button"
                className="rounded-full border px-4 py-1 text-sm"
                disabled
              >
                Edit
              </button>
              <button
                type="button"
                className="rounded-full border px-4 py-1 text-sm"
                disabled
              >
                Delete
              </button>
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
