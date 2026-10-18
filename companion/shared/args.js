// Command-line options the entry points share (scripts/dev.js, scripts/send.js, companion/server/server.js).

// parseArgs options for choosing one desk: --agents custom/<desk> (the flag kept its name for cron lines).
export const DESK_OPTIONS = {
  agents: { type: "string", multiple: true, default: [] },
}

// The desk folder: the first --agents flag, else ASKK_AGENTS (.env; the first of a ":" or "," list), else null.
export function deskDirFrom(flags = []) {
  if (flags.length) return flags[0]
  return (process.env.ASKK_AGENTS ?? "").split(/[:,]/).map((d) => d.trim()).find(Boolean) ?? null
}
