// Shared formatting for the live follow page.

export const time = (at) => (at ? new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "")

// "agent · v3 · 10:42:07" for a live artifact snapshot.
export const snapshotLabel = (snapshot) => `${snapshot.agent} · v${snapshot.version} · ${time(snapshot.at)}`

export const panel = "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border"
export const block = "max-h-[40svh] overflow-auto rounded-md border p-3 font-mono text-[12px] whitespace-pre-wrap break-words"
