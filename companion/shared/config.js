// Host-side limits and timings shared by companion/ and scripts/. Values with
// an existing ASKK_* variable read it here; the rest are plain defaults.
// Browser-safe names (API prefix, desk header/cookie) come from lib/config.js.

export { API_PREFIX, DESK_COOKIE, DESK_HEADER } from "../../lib/config.js"

// Ports: a single dev server without --port, and the shared desks server (launchd askk.desks).
export const DEFAULT_PORT = 3000
export const DESKS_PORT = Number(process.env.ASKK_DESKS_PORT) || 1111

// The wake book is checked this often (companion/shared/wakes.js, run by kernel-team); a wake later than this many
// minutes is marked missed.
export const WAKE_TICK_MS = 30 * 1000
export const WAKE_STALE_MINUTES = 60

// The team stream (team/stream) sends a comment this often.
export const SSE_PING_MS = 15000

// Every host-side cap, timeout and size limit in one place (values only; .env overrides stay where they are read).
export const HOST_LIMITS = {
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
  web: {
    readBytes: 2000000,
    readChars: 40000,
    timeoutMs: 15000,
    searchResults: 8,
    searchResultsMax: 20,
    apiTimeoutMs: 10000, // wikipedia / arxiv / hn API calls
    snippetChars: 300,
    cacheMs: 10 * 60000, // the same query + limit + source answers from memory this long
    cacheEntries: 200,
    // Per search engine, process-wide: requests at once, ms between request starts, the backoff before each retry
    // of a rate-limited answer, how long an engine still rate-limited after its retries is skipped (coolMs), and how
    // long one that did not answer (timeout, network, 5xx) is skipped (downMs).
    engines: {
      duckduckgo: { concurrency: 1, spacingMs: 1500, retryMs: [3000, 8000], coolMs: 2 * 60000, downMs: 30000 },
      searxng: { concurrency: 4, spacingMs: 0, retryMs: [], coolMs: 2 * 60000, downMs: 30000 },
      wikipedia: { concurrency: 1, spacingMs: 0, retryMs: [], coolMs: 2 * 60000, downMs: 30000 }, // Wikimedia etiquette: serial requests
      arxiv: { concurrency: 1, spacingMs: 3000, retryMs: [], coolMs: 2 * 60000, downMs: 30000 }, // arXiv API terms: one request per 3 s
      hn: { concurrency: 4, spacingMs: 0, retryMs: [], coolMs: 2 * 60000, downMs: 30000 },
    },
  },
  // fs/* (companion/capabilities/files.js); fs/watch: open streams per desk, ms changes are gathered, paths per event
  files: { readBytes: 1024 * 1024, treeEntries: 3000, binarySniffBytes: 8000, watchers: 16, watchDebounceMs: 300, watchPaths: 200 },
  // term/* sessions (companion/capabilities/terminal.js), per desk: running at once, finished ones kept listed, raw
  // characters and view lines kept per session, the PTY size, minutes a session may run (a desk's `terminal:
  // { backgroundMinutes }` changes it), the SIGTERM → SIGKILL grace, the longest wait (term/start wait, term/wait),
  // stdin per write, the full log per session (state/terminal/<id>.log) and how many logs are kept, the
  // state/terminal.jsonl rows (tail characters, rows kept once it passes logMaxBytes)
  term: {
    maxSessions: 6,
    keepFinished: 20,
    keepChars: 200000,
    keepLines: 2000,
    lineChars: 4000, // a line longer than this (no newline yet) is cut into the view
    tailLines: 50,
    maxTailLines: 1000,
    cols: 120,
    rows: 32,
    backgroundMinutes: 120,
    stopGraceMs: 5000,
    waitMaxSeconds: 600,
    inputChars: 4000,
    nameChars: 60,
    untilChars: 300, // term/wait's `until`: literal texts, characters each and how many
    untilTexts: 8,
    urlScanChars: 200,
    logBytes: 20 * 1024 * 1024,
    keepLogs: 100,
    rowTailChars: 4000,
    rowKeep: 200,
    rowMaxBytes: 512 * 1024,
  },
  // browser/* pages (companion/capabilities/browser.js, Bun.WebView): open pages per desk and per process, the
  // default and allowed viewport, navigation / action timeouts and the settle after one, screenshots kept per page
  // (state/browser/<id>/<n>.png) and page folders kept, closed pages still listed, the caps on eval results, the
  // text outline, typed text, console lines kept / shown in a summary and their length
  browser: {
    perDesk: 3,
    perProcess: 6,
    width: 1280,
    height: 800,
    minSize: 200,
    maxSize: 3840,
    navTimeoutMs: 15000,
    actionTimeoutMs: 10000,
    settleMs: 250,
    keepShots: 20,
    keepPages: 20,
    keepClosed: 10,
    evalChars: 20000,
    textChars: 8000,
    inputChars: 20000,
    consoleKeep: 200,
    consoleShown: 20,
    consoleLineChars: 500,
  },
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
    logPreviewChars: 80, // a run's text in the desk log
    runPreviewChars: 100, // a run's first line in GET desks (work)
  },
}
