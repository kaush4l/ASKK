// 2026-10-21: an agent's runs are its history.md (kernel-history.js); transcript.jsonl is read there for migration only.
// The old names stay for callers.
export { createHistory as createTranscripts, createHistory, HISTORY_FILE, historyMarkdown, parseHistory } from "./kernel-history.js"
