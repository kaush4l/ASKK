// Models — separate view, not a dashboard section.
// Renders providers from the desk snapshot on load: saved ones only,
// no built-ins, no defaults to fill a void. Empty state if none added.
// Use/Test/Edit/Delete now work against the /api/models action route
// (providers.js actions): Test is mocked server-side, no real model
// call, no CLI. Use sets the default in the snapshot object; when no
// personal desk folder exists the route keeps it in memory for this
// server process and says so plainly in its note.
"use client";

import { useEffect, useState } from "react";

export default function ModelsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(null);
  const [editLabel, setEditLabel] = useState("");
  const [editModel, setEditModel] = useState("");
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
  async function act(action, id, patch) {
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id, patch }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "model action failed");
      if (Array.isArray(body.providers)) {
        setData((prev) => ({
          ...prev,
          providers: { ...(prev?.providers ?? {}), providers: body.providers },
        }));
      }
      setNotice(
        body.message ??
          `${action} ${id} — ${body.persisted ? "persisted to personal memory" : "in-memory only (not persisted)"}${body.note ? ` · ${body.note}` : ""}`,
      );
      setEditing(null);
    } catch (err) {
      setError(err.message);
    }
  }
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
          built-ins, no defaults to fill a void. Test is mocked: no real
          model call is made from here.
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {notice && <p className="text-sm text-emerald-700">{notice}</p>}
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
            {editing === p.id ? (
              <div className="mt-3 flex flex-col gap-2">
                <input
                  className="rounded border px-3 py-1 text-sm"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  placeholder="Label"
                />
                <input
                  className="rounded border px-3 py-1 text-sm"
                  value={editModel}
                  onChange={(e) => setEditModel(e.target.value)}
                  placeholder="Model"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-full border px-4 py-1 text-sm"
                    onClick={() =>
                      act("edit", p.id, { label: editLabel, model: editModel })
                    }
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="rounded-full border px-4 py-1 text-sm"
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="rounded-full border px-4 py-1 text-sm"
                  onClick={() => act("use", p.id)}
                >
                  Use
                </button>
                <button
                  type="button"
                  className="rounded-full border px-4 py-1 text-sm"
                  onClick={() => act("test", p.id)}
                >
                  Test (mocked)
                </button>
                <button
                  type="button"
                  className="rounded-full border px-4 py-1 text-sm"
                  onClick={() => {
                    setEditing(p.id);
                    setEditLabel(p.label ?? "");
                    setEditModel(p.model ?? "");
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="rounded-full border px-4 py-1 text-sm"
                  onClick={() => act("delete", p.id)}
                >
                  Delete
                </button>
              </div>
            )}
          </section>
        ))}
      </main>
    </div>
  );
}
