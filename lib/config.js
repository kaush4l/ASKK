// Shared constants for the app, browser-safe (no Node/Bun imports): the
// companion imports this file too (companion/shared/config.js), so the
// browser and the host agree on the API prefix, the desk header/cookie,
// storage keys, page routes and capability names.

// The host API lives same-origin under this prefix (companion/server/host-api.js).
export const API_PREFIX = "/__askk/"

// Which desk a request is for: header (scripts, team worker) or cookie (the
// header's desk switcher, components/shell/host-status.jsx).
export const DESK_HEADER = "x-askk-desk"
export const DESK_COOKIE = "askk_desk"

// localStorage keys (this browser's own settings).
export const STORAGE_KEYS = Object.freeze({
  speech: "askk.sts",
})

// Page routes (lib/nav.js builds the navigation from these).
export const ROUTES = Object.freeze({
  home: "/",
  chat: "/chat",
  sts: "/sts",
  agents: "/agents",
  live: "/live",
  canvas: "/canvas",
  compose: "/compose",
  files: "/files",
  projects: "/projects",
  workflow: "/workflow",
})


// Every cap, timeout and size limit of the live UI in one place (values only).
export const LIMITS = {
  // UI (hooks/use-mobile.js, components/**)
  ui: {
    mobileBreakpointPx: 768,
    chat: {
      promptPreviewDelayMs: 300, // debounce before re-rendering the "Next" prompt preview
      copiedFlashMs: 1500, // how long "Copied" shows
    },
    home: {
      clockTickMs: 30000, // re-render "x min ago" labels
    },
    shell: {
      hostRefreshMs: 15000, // host status poll
    },
    live: {
      terminalRecentRuns: 5, // finished runs listed in the Terminal panel
      diffContextLines: 2, // unchanged lines around each diff hunk
    },
    // The Live page's workbench (components/live/workbench/, backend/live/workbench.js, term-lines.js, term-stream.js,
    // fs-watch.js) — 2026-10-17.
    workbench: {
      maxTabs: 24, // file tabs in the strip (newest first); preview tabs come on top of these
      terminalLines: 2000, // lines a session's pane keeps (the host's ring keeps the rest: term/read)
      lineChars: 4000, // one terminal line is cut here
      fileLines: 5000, // lines of a file the editor draws
      termNotifyMs: 50, // a burst of PTY chunks repaints the pane at most this often
      termPollMs: 2000, // while a session runs, term/list is read this often so follow sees which one printed last
      termIdlePollMs: 5000, // … and this often while none runs
      followTieMs: 5000, // terminal follow: output this close to the newest counts as new (then the newest session wins)
      treeRefreshMs: 300, // fs/watch changes this close together re-read the tree once
      bottomSlackPx: 24, // the terminal counts as scrolled to the bottom within this
    },
    sts: {
      transcriptLines: 3, // live caption lines kept on the stage
      commandPauseMinMs: 1000, commandPauseMaxMs: 5000, commandPauseStepMs: 250, // settings slider
      endSilenceMinMs: 400, endSilenceMaxMs: 2000, endSilenceStepMs: 100, // settings slider
      voiceRateMin: 0.7, voiceRateMax: 1.6, voiceRateStep: 0.05, // speech speed slider
    },
  },
  // live follow (backend/live/follow.js)
  live: { maxEvents: 300 },
  // wakes poll (backend/live/wakes.js)
  liveWakes: { pollMs: 30000 },
  // speech-to-speech pipeline (backend/hardware/speech/pipeline.js)
  speech: {
    maxTurns: 80, // conversation timeline kept
    spokenAnswerChars: 700, // read aloud; the rest stays on screen
    minClipSentenceChars: 200, // cut at a sentence end only past this
    commandPauseMs: 2000, // wake mode: pause that ends a command
    endSilenceMs: 1200, // direct mode: pause that ends an utterance
    echoMinWords: 2,
    echoOverlap: 0.7, // word overlap with our own voice = echo
    echoChars: 600, // spoken text kept for echo checks
    echoClearMs: 2000, // echo text forgotten after speaking ends
    transcriptLines: 12,
    wakeWaitMs: 8000, // wake word alone waits this long for the command
  },
  // voice activity detector (backend/hardware/speech/microphone.js)
  microphone: {
    prerollFrames: 15, // 300 ms kept before speech starts
    startFrames: 4, // 80 ms above threshold = speech
    maxUtteranceSeconds: 55, // longer stretches are cut (forced)
    partialMs: 450, // audio sent for live text this often
    endSilenceMs: 800, // default silence that ends an utterance
    trailingKeepFrames: 10, // 200 ms of the ending silence kept
    initialFloor: 0.004,
    minFloor: 0.0015,
    floorAdapt: 0.03, // noise-floor EMA weight of a new quiet frame
    minThreshold: 0.01,
    floorMultiplier: 3.2, // speech = this x the noise floor
    guardMultiplier: 2.6, // while our voice plays
    levelGain: 12, // rms -> 0..1 meter
    fftSize: 256,
    smoothing: 0.75,
  },
  // voice output (backend/hardware/speech/voices.js)
  voices: {
    minSentenceChars: 40, // shorter sentences merge with the next
    minPartChars: 12,
    fftSize: 256,
    levelScale: 90, // mean byte level -> 0..1
    sayWordsPerMinute: 185, // macOS `say` rate at 1.0
  },
  // browser recognizer (backend/hardware/speech/recognizers.js)
  recognizers: { pauseMs: 1100 },
}
