// Shared formatting for the live follow page.

// A duration (2026-10-23: each call's own time, each step's model call): 840 ms, 3.2 s, 2 m 05 s.
export const duration = (ms) => (ms == null ? null : ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)} m ${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")} s`)

export const time = (at) => (at ? new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "")

// "agent · v3 · 10:42:07" for a live artifact snapshot.
export const snapshotLabel = (snapshot) => `${snapshot.agent} · v${snapshot.version} · ${time(snapshot.at)}`

export const panel = "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border"
export const block = "max-h-[40svh] overflow-auto rounded-md border p-3 font-mono text-[12px] whitespace-pre-wrap break-words"
