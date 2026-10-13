// Host-side limits and timings shared by companion/ and scripts/. Values with
// an existing ASKK_* variable read it here; the rest are plain defaults.
// Browser-safe names (API prefix, desk header/cookie) come from lib/config.js.

export { API_PREFIX, DESK_COOKIE, DESK_HEADER } from "../../lib/config.js"

// Ports: a single dev server without --port, and the shared desks server (launchd askk.desks).
export const DEFAULT_PORT = 3000
export const DESKS_PORT = Number(process.env.ASKK_DESKS_PORT) || 1111

// The wake book is checked this often (companion/team/wakes.js); a wake later
// than this many minutes is marked missed (also scripts/wake.js --stale default).
export const WAKE_TICK_MS = 30 * 1000
export const WAKE_STALE_MINUTES = 60

// Server-sent event streams (team/stream, term/stream) send a comment this often.
export const SSE_PING_MS = 15000

// A desk's background programs (term.start) are stopped after this many minutes.
export const TERM_BACKGROUND_MINUTES = 120

// Every host-side cap, timeout and size limit in one place (values only; .env overrides stay where they are read).
export const HOST_LIMITS = {
  // terminal (companion/capabilities/terminal.js)
  terminal: {
    outputChars: 20000, // output kept per term.run
    logTailChars: 4000, // output per row of state/terminal.jsonl
    logKeepRows: 200, // rows kept when the log is pruned
    logMaxBytes: 512 * 1024, // the log is pruned past this size
    liveKeepChars: 20000, // of a run in progress, sent to a new viewer
    procKeepChars: 40000, // of a background process's output
    maxProcs: 4, // background processes at once, per terminal
    keepExited: 10, // exited background processes still listed
    startWaitMs: 3000, // term/start waits this long for first output and URLs
    startWaitMaxMs: 10000, // upper bound on a caller's requested wait
    startOutputLines: 40, // output returned by term/start
    startOutputChars: 4000,
    stopGraceMs: 5000, // SIGTERM, then SIGKILL
    recentRuns: 5, // runs in term/log and the stream snapshot (default)
    recentRunsMax: 50,
    logsTailLines: 50, // term/logs default tail
    logsTailMaxLines: 1000,
    procNameChars: 60,
    urlScanChars: 200, // carried-over output scanned for local URLs
  },
  // desk terminal policy (companion/team/desk.js)
  desk: { termTimeoutSeconds: 300, termTimeoutMaxSeconds: 1800 },
  // apple.* actions (companion/hardware/apple/index.js)
  apple: {
    actionTimeoutMs: 60000,
    shortcutTimeoutMs: 5 * 60000, // shortcuts run longer
    sayTimeoutMs: 3 * 60000,
    outputChars: 20000,
    textChars: 4000, // default cap on a text input
    shortcutNameChars: 200,
    shortcutInputChars: 20000,
    voiceChars: 60,
    sayChars: 4000,
    titleChars: 120, // notification title, reminder list name
    messageChars: 400,
    clipboardChars: 100000,
    queryChars: 300,
    spotlightResults: 20,
    spotlightResultsMax: 100,
    reminderTitleChars: 300,
    notesChars: 4000,
    urlChars: 2000,
  },
  // on-device speech (companion/hardware/speech/index.js)
  speech: {
    maxUtteranceSeconds: 60,
    minUtteranceSeconds: 0.1, // shorter audio is answered empty
    sayChars: 4000,
    timeoutMs: 30000, // recognizer reply / say process
    buildErrorChars: 400, // swiftc stderr shown on a failed build
    sayRateMinWpm: 90,
    sayRateMaxWpm: 400,
  },
  // web.search / web.read (companion/capabilities/web.js)
  web: { readBytes: 2000000, readChars: 40000, timeoutMs: 15000, searchResults: 8, searchResultsMax: 20 },
  // fs/* (companion/capabilities/files.js)
  files: { readBytes: 1024 * 1024, treeEntries: 3000, binarySniffBytes: 8000 },
  // fs/write body (companion/server/host-api.js); requests up to 2x are read
  hostApi: { writeBytes: 8 * 1024 * 1024 },
  // shared OAuth token files (companion/capabilities/oauth-file.js)
  oauth: { refreshMarginSeconds: 600 },
  // integration events (companion/capabilities/integrations.js)
  integrations: { keepEvents: 200, longPollMs: 25000 },
  // CLI / Apple local models (companion/capabilities/local-models.js)
  localModels: { timeoutMs: 15 * 60000, pingMs: 5000, errorTailChars: 500 },
  // MCP client (companion/capabilities/mcp.js)
  mcp: { requestTimeoutMs: 60000, callTimeoutMs: 5 * 60000, resultChars: 60000, stderrTailChars: 2000, maxTools: 1000 },
  // wake book (companion/team/wakes.js)
  wakes: { bookBytes: 32 * 1024, keepClosed: 40, listRecent: 20 },
  // team server (companion/team/team.js, team-worker.js)
  team: {
    flushMs: 33, // state patches batched to ~30/s
    callTimeoutMs: 30 * 60 * 1000, // team/call default wait
    maxCallTimeoutMs: 6 * 60 * 60 * 1000,
    fromChars: 80,
    logPreviewChars: 80,
    runPreviewChars: 100,
  },
  // headless ask (companion/team/ask.js)
  ask: { timeoutSeconds: 1800, approvalPreviewChars: 160 },
}
