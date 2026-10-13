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

// localStorage keys (settings mirrored to the server's runtime folder in local mode).
export const STORAGE_KEYS = Object.freeze({
  autopilot: "askk.autopilot",
  models: "askk.models",
  spawned: "askk.spawned",
  speech: "askk.sts",
  integrationsCursor: "askk.integrations.cursor",
})

// Page routes (lib/nav.js builds the navigation from these).
export const ROUTES = Object.freeze({
  home: "/",
  chat: "/chat",
  sts: "/sts",
  agents: "/agents",
  live: "/live",
  files: "/files",
  settings: "/settings",
})


// Every cap, timeout and size limit in one place (values only; env and agent.md overrides stay where they are read).
export const LIMITS = {
  // engine loop (backend/core/engine/tools-run.js, helpers.js; engines/react-engine.js)
  engine: {
    liveProgressChars: 4000, // a streaming call's live output tail kept in state
    liveProgressMs: 100, // progress reaches state at most this often
    liveInputChars: 20000, // tool inputs clipped in live state
    answerRefusals: 2, // final answer refused this many times while checklist items are open (non-strict)
  },
  // tool plans (backend/core/engine/tools-run.js)
  toolPlan: { maxCallsPerStep: 16 },
  // prompt rendering (backend/core/engine/prompt.js)
  prompt: { openQuestPreviewChars: 160 }, // open quests listed in CONTEXT
  // memory (backend/core/memory.js, engine/memory-ops.js, engine/helpers.js)
  memory: {
    historyKeep: 6, // default; ASKK_HISTORY_KEEP (globalThis.askkHistoryKeep) overrides
    autoSummarizeRatio: 0.92, // share of the context window that triggers auto summarize
    summarizeInputRatio: 0.6, // share of the window the summarizer's input may fill
    summarizeMinEntryChars: 400, // an entry is never clipped below this when fitting
  },
  // context window (backend/core/engine/helpers.js)
  context: { capTokens: 262144 }, // default; ASKK_CONTEXT_CAP / agent.md context_window override
  // inbox (backend/core/engine/inbox.js)
  inbox: {
    deferMaxMs: 900000, // a held new run waits at most 15 min for an open run-memory run
    deferRecheckMs: 60000,
    previewChars: 120, // letter preview in state.inbox
    reportQuestChars: 240, // quest text restated in a report letter
    reportOriginChars: 400, // origin request restated in a report letter
    dormantKeep: 20, // messages a sleeping engine keeps in memory (the full log stays in memory.md)
  },
  // quest tool schemas (backend/core/engine/quests.js)
  quests: { idMaxChars: 120, guidanceMaxChars: 4000, recallReasonMaxChars: 1000 },
  // supervisor (backend/runtime/supervisor.js); agent.md check_minutes/check_steps/stall_minutes override
  supervisor: { checkMinutes: 5, checkSteps: 10, stallMinutes: 10, tickMs: 15000 },
  // worker patch batching (backend/runtime/engine-worker.js)
  runtime: { patchFlushMs: 33 }, // ~30 patches/s
  // spawner (backend/runtime/spawner.js)
  spawner: {
    defaultMaxSteps: 40,
    maxStepsCap: 200,
    reapMs: 60000, // idle reaper interval
    endedKeep: 8, // recently ended agents listed (×4 kept in memory)
    roleMinChars: 20,
    descriptionMaxChars: 200,
    onceGraceMs: 2000, // a once helper idle this long after its report is ended
  },
  // team artifact defaults (backend/runtime/spawner.js); agent.md spawn_max/spawn_idle_minutes override
  team: { spawnMax: 6, spawnMaxCap: 20, spawnIdleMinutes: 30, spawnIdleMinutesCap: 1440 },
  // model catalogue (backend/core/engine/definition.js)
  models: { contextLookupTimeoutMs: 10000 },
  // token metrics (backend/models/metrics.js, base-engine.js, engine/helpers.js)
  metrics: {
    charsPerToken: 4, // estimate when the server reports no usage (also the calibration start)
    minRateSeconds: 0.25, // no tokens/s shown for shorter streams
  },
  // inference (backend/models/llm.js, backend/core/engine/inference.js)
  llm: {
    retries: 2,
    retryWaitMs: 15000, // × attempt
    errorDetailChars: 300, // HTTP error body kept in the message
    defaultMaxTokens: 8192, // Anthropic max_tokens when the model sets none
    cacheBreakpoints: 3, // prompt-cache marks on the prompt (Anthropic allows 4)
  },
  // log digests for status letters (backend/core/log.js)
  log: { digestEachChars: 400, digestTotalChars: 6000 },
  // integration bridge (backend/runtime/integration-bridge.js)
  integrationsBridge: { pollWaitMs: 25000, backoffBaseMs: 2000, backoffMaxMs: 60000, backoffMaxDoublings: 5 },
  // dictation (lib/speech/dictation.js)
  dictation: { pauseMs: 1200, minSimilarityRatio: 0.8 },
  // line diff (lib/line-diff.js)
  diff: { maxCells: 4000000, contextLines: 3, changeRows: 300 }, // changeRows: rows of a file change kept on its tool message
  // UI (hooks/use-mobile.js, components/**)
  ui: {
    mobileBreakpointPx: 768,
    chat: {
      promptPreviewDelayMs: 300, // debounce before re-rendering the "Next" prompt preview
      copiedFlashMs: 1500, // how long "Copied" shows
    },
    home: {
      clockTickMs: 30000, // re-render "x min ago" labels
      activityLetterChars: 120, // clip of quest/guidance text in the activity feed
      activityMessageChars: 140, // clip of owner messages / answers in the activity feed
      activityRows: 10, // activity feed rows shown
      nodeLabelChars: 28, // constellation node label before ellipsis
    },
    shell: {
      hostRefreshMs: 15000, // host status poll
    },
    live: {
      terminalRecentRuns: 5, // finished runs listed in the Terminal panel
      diffContextLines: 2, // unchanged lines around each diff hunk
    },
    sts: {
      transcriptLines: 3, // live caption lines kept on the stage
      commandPauseMinMs: 1000, commandPauseMaxMs: 5000, commandPauseStepMs: 250, // settings slider
      endSilenceMinMs: 400, endSilenceMaxMs: 2000, endSilenceStepMs: 100, // settings slider
      voiceRateMin: 0.7, voiceRateMax: 1.6, voiceRateStep: 0.05, // speech speed slider
    },
  },
  // filesystem artifact + fs.* tools (backend/features/filesystem/artifact.js, tools.js)
  filesystem: {
    maxOpenFiles: 12, // files pinned with fs.open at once
    maxFilesPerStep: 200, // files read per step (filesystem + shared artifacts)
    fileChars: 40000, // characters of one file shown in the prompt
    totalChars: 120000, // characters of all shown files together
    readOutputChars: 60000, // fs.read result shown to the model
    pathChars: 1024, // maxLength of a path in tool schemas
    appendRetries: 5, // fs.append attempts on revision conflict
  },
  // workspace backend (backend/features/filesystem/workspace.js)
  workspace: {
    maxReadBytes: 1024 * 1024, // largest file read
    maxTreeEntries: 3000, // entries in one tree listing
    binarySniffBytes: 8000, // bytes checked for NUL to call a file binary
  },
  // preserve guard (backend/features/filesystem/guard.js)
  fsGuard: {
    minLinesForShrink: 20, // files shorter than this are never "gutted"
    shrinkRatio: 0.5, // a write keeping fewer lines than this share is refused
    lostNamesShown: 12, // removed definitions named in the refusal
  },
  // terminal artifact + term.* tools (backend/features/terminal/artifact.js, tools.js)
  terminal: {
    runsShown: 5, // recent runs in the artifact
    runTailLines: 25, // output lines per run shown
    procTailLines: 10, // output lines per background process shown
    maxProcesses: 4, // fallback when the desk policy names none
    logsTailLines: 50, // term.logs default tail
    logsMaxTailLines: 1000, // term.logs schema maximum
    commandChars: 4000,
    cwdChars: 1024,
    maxTimeoutSeconds: 1800, // term.run schema maximum (desk limit caps further)
    describeChars: 120, // command shown on the approval card
    procNameChars: 60,
    procIdChars: 80,
  },
  // web.* tools (backend/features/web/tools.js)
  web: {
    readChars: 40000, // web.read text kept
    findChars: 6000, // web.read {find}: passages kept by default
    findAround: 600, // web.read {find}: chars kept either side of a match
    searchResults: 8, // default results
    maxSearchResults: 20,
    queryChars: 400,
    urlChars: 2000,
  },
  // apple.* tool schemas (backend/hardware/apple/tools.js)
  apple: {
    quoteChars: 80, // text quoted on approval cards
    shortcutNameChars: 200,
    shortcutInputChars: 20000,
    sayTextChars: 4000,
    voiceNameChars: 60,
    notifyTitleChars: 120,
    notifyMessageChars: 400,
    clipboardChars: 100000,
    spotlightQueryChars: 300,
    spotlightMaxResults: 100,
    reminderListChars: 120,
    reminderTitleChars: 300,
    reminderNotesChars: 4000,
    urlChars: 2000,
  },
  // skills artifact (backend/features/skills/artifact.js)
  skills: { maxLoaded: 6, skillChars: 20000, nameChars: 80 },
  // agent.spawn / task / kill schemas (backend/features/team/artifact.js)
  spawnTools: {
    nameChars: 40,
    itemChars: 80, // tools/mcp/artifacts list items
    maxItems: 40,
    roleMinChars: 20,
    roleChars: 8000,
    goalChars: 8000,
    questChars: 8000,
    descriptionChars: 300,
    reasonChars: 500,
    maxIdleMinutes: 1440,
    maxSteps: 200,
    maxWrites: 20, // lane globs
    maxChecklist: 12,
    describeChars: 120, // goal shown on the approval card
  },
  // schedule.wake (backend/features/schedule/tools.js)
  schedule: {
    maxWaitMinutes: 7 * 24 * 60, // a week
    duplicateWindowMinutes: 2, // same agent's wakes this close are replaced
    writeRetries: 5,
    atChars: 40, // `at` and wake ids
    reasonChars: 300,
    messageChars: 1000,
    maxReplaces: 10,
  },
  // compaction (backend/features/compact/artifact.js)
  compact: {
    checkMs: 60 * 1000,
    targetRatio: 0.6, // compact to this share of the cap
    retryRatio: 0.7, // second pass aims at this share of the target
    keepArchives: 3,
    jsonlFieldChars: 240, // a .jsonl text field keeps this many characters
    minCapChars: 1000, // smallest cap a rule may set
    minOutputChars: 200, // compactor answers shorter than this (or minOutputRatio) fail
    minOutputRatio: 0.05,
    headLines: 12, // lines kept from the top when cutting
    movedShown: 6, // dated-folder moves remembered
  },
  // live follow (backend/features/live/follow.js)
  live: { maxEvents: 300, maxRuns: 20, runChars: 40000, writeKeyChars: 200 },
  // wakes poll (backend/features/live/wakes.js)
  liveWakes: { pollMs: 30000 },
  // MCP tools (backend/features/mcp/tools.js)
  mcp: { quoteChars: 120 }, // inputs quoted on approval cards
  // notes.* schemas (backend/features/index.js) -- NOTE: group not in my allowed list; coordinator to place
  notes: { keyChars: 80, textChars: 20000 },
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
    approvalMaxWords: 4, // a bare yes/no answers an approval
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
