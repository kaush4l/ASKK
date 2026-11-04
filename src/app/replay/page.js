// Replay — VIEW SHELL only (separate view, not a dashboard section).
// The replay feature itself is NOT built in this PR. This shell lists
// stored snapshot twins (from the existing /api/snapshots route) so
// the view exists and can be revisited, and it states plainly that
// playback is deferred. It writes nothing, and it does not block
// the dashboard or chat.
"use client";

import { useEffect, useState } from "react";

export default function ReplayPage() {
  const [snaps, setSnaps] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/snapshots")
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "snapshots failed");
        setSnaps(body.snapshots ?? []);
      })
      .catch((err) => setError(err.message));
  }, []);
  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col gap-6 px-6 py-10">
        <div className="flex items-baseline justify-between">
          <span className="text-xl font-semibold tracking-tight">Replay</span>
          <a
            href="/"
            className="text-sm font-medium text-zinc-600 dark:text-zinc-400"
          >
            ← Dashboard
          </a>
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Replay view shell only in this PR. Full replay (folder on load, Web
          Worker thread, step playback) is deferred and will be revisited. Below
          are stored snapshot twins only — no playback, no writes.
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {snaps.length === 0 && !error && (
          <p className="text-sm text-zinc-600">No stored snapshots yet.</p>
        )}
        <ul className="flex flex-col gap-2 text-sm">
          {snaps.map((s) => (
            <li key={s.id}>
              {s.id} · {s.at} · {s.stepCount} steps · {s.progress}
              {s.partial ? " · partial" : ""}
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
