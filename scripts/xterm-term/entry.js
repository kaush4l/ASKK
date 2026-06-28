// ASKK xterm.js terminal bundle entry.
//
// Compiled to a single IIFE asset (`assets/xterm_term.js`) with
// `bun run build`, loaded by the WASM app via `asset!()` + `document::Script`,
// and driven from Rust through `document::eval` (see
// `src/components/terminal.rs`). The wire contract:
//
//   window.AskkTerm.mount(hostId, { onLine(line), onInterrupt() }) -> token
//       (0 if the host element is missing)
//   window.AskkTerm.write(hostId, text)      // print output (ANSI + "\n" ok)
//   window.AskkTerm.setPrompt(hostId, text)  // store + print prompt, unlock input
//   window.AskkTerm.clear(hostId)            // wipe screen and scrollback
//   window.AskkTerm.destroy(hostId, token?)  // token-guarded teardown
//
// The bundle owns rendering, the prompt line, line editing (arrows, Home/End,
// Backspace/Delete, Ctrl-A/E/U/K/L), in-memory history (↑/↓, persisted across
// remounts of the same host) and Ctrl-C. On Enter it calls `onLine(line)` and
// locks input until the next `setPrompt`; Ctrl-C while locked calls
// `onInterrupt()` (Rust cancels the in-flight command and replies with a fresh
// prompt), while Ctrl-C at the prompt just abandons the typed line locally.

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import termCss from "@xterm/xterm/css/xterm.css" with { type: "text" };

// Matches the IDE bottom-panel palette in assets/main.css.
const askkTheme = {
  background: "#131019",
  foreground: "#cfc7e6",
  cursor: "#7bd88f",
  cursorAccent: "#131019",
  selectionBackground: "#322852",
  black: "#1b1726",
  red: "#ff6b81",
  green: "#7bd88f",
  yellow: "#e5c07b",
  blue: "#61afef",
  magenta: "#c678dd",
  cyan: "#56b6c2",
  white: "#cfc7e6",
  brightBlack: "#564b6e",
  brightRed: "#ff8da1",
  brightGreen: "#a3e8b0",
  brightYellow: "#f0d399",
  brightBlue: "#8cc7ff",
  brightMagenta: "#d99ee8",
  brightCyan: "#7cd4de",
  brightWhite: "#ece7fb",
};

// xterm.css ships inside the bundle (imported as text) and is injected once.
function ensureCss() {
  if (document.getElementById("askk-xterm-css")) return;
  const style = document.createElement("style");
  style.id = "askk-xterm-css";
  style.textContent = termCss;
  document.head.appendChild(style);
}

// hostId -> { term, fit, resize, prompt, buffer, cursor, pending, history,
//             histIndex, callbacks, token }
const terms = new Map();

// Command history survives destroy/mount cycles (tab switches) per host.
const histories = new Map();

// Monotonic mount token: a remount can leave the previous mount's teardown
// running after the new mount; tokens let stale teardowns no-op instead of
// destroying the terminal that just replaced them (same scheme as AskkCM).
let mountCounter = 0;

// Repaint the input line: prompt + buffer, cursor placed inside the buffer.
// Single-row repaint — long wrapped input lines are a known v1 limitation.
function redraw(record) {
  const back = record.buffer.length - record.cursor;
  record.term.write(
    "\r\x1b[K" + record.prompt + record.buffer + (back > 0 ? `\x1b[${back}D` : ""),
  );
}

function setBuffer(record, text) {
  record.buffer = text;
  record.cursor = text.length;
  redraw(record);
}

function submit(record) {
  record.term.write("\r\n");
  const line = record.buffer;
  record.buffer = "";
  record.cursor = 0;
  const trimmed = line.trim();
  if (trimmed && record.history[record.history.length - 1] !== trimmed) {
    record.history.push(trimmed);
  }
  record.histIndex = record.history.length;
  record.pending = true; // locked until Rust answers with setPrompt
  if (record.callbacks.onLine) record.callbacks.onLine(line);
}

function historyPrev(record) {
  if (record.histIndex === 0) return;
  record.histIndex -= 1;
  setBuffer(record, record.history[record.histIndex] ?? "");
}

function historyNext(record) {
  if (record.histIndex >= record.history.length) return;
  record.histIndex += 1;
  setBuffer(record, record.history[record.histIndex] ?? "");
}

function handleData(record, data) {
  if (record.pending) {
    // A command is in flight: only Ctrl-C gets through (interrupt).
    if (data.includes("\x03") && record.callbacks.onInterrupt) {
      record.callbacks.onInterrupt();
    }
    return;
  }
  let i = 0;
  while (i < data.length) {
    const ch = data[i];
    if (ch === "\r" || ch === "\n") {
      submit(record);
      i += 1;
      // Everything after Enter is ignored (multi-line paste runs line one).
      return;
    }
    if (ch === "\x03") {
      // Ctrl-C at the prompt: abandon the typed line locally.
      record.term.write("^C\r\n" + record.prompt);
      record.buffer = "";
      record.cursor = 0;
      record.histIndex = record.history.length;
      i += 1;
      continue;
    }
    if (ch === "\x7f" || ch === "\b") {
      if (record.cursor > 0) {
        record.buffer =
          record.buffer.slice(0, record.cursor - 1) + record.buffer.slice(record.cursor);
        record.cursor -= 1;
        redraw(record);
      }
      i += 1;
      continue;
    }
    if (ch === "\x01") { record.cursor = 0; redraw(record); i += 1; continue; } // Ctrl-A
    if (ch === "\x05") { record.cursor = record.buffer.length; redraw(record); i += 1; continue; } // Ctrl-E
    if (ch === "\x15") { record.buffer = record.buffer.slice(record.cursor); record.cursor = 0; redraw(record); i += 1; continue; } // Ctrl-U
    if (ch === "\x0b") { record.buffer = record.buffer.slice(0, record.cursor); redraw(record); i += 1; continue; } // Ctrl-K
    if (ch === "\x0c") { record.term.write("\x1b[2J\x1b[H"); redraw(record); i += 1; continue; } // Ctrl-L
    if (ch === "\x1b") {
      const seq = data.slice(i);
      if (seq.startsWith("\x1b[A")) { historyPrev(record); i += 3; continue; }
      if (seq.startsWith("\x1b[B")) { historyNext(record); i += 3; continue; }
      if (seq.startsWith("\x1b[C")) {
        if (record.cursor < record.buffer.length) { record.cursor += 1; redraw(record); }
        i += 3;
        continue;
      }
      if (seq.startsWith("\x1b[D")) {
        if (record.cursor > 0) { record.cursor -= 1; redraw(record); }
        i += 3;
        continue;
      }
      if (seq.startsWith("\x1b[H")) { record.cursor = 0; redraw(record); i += 3; continue; }
      if (seq.startsWith("\x1b[F")) { record.cursor = record.buffer.length; redraw(record); i += 3; continue; }
      if (seq.startsWith("\x1b[3~")) {
        if (record.cursor < record.buffer.length) {
          record.buffer =
            record.buffer.slice(0, record.cursor) + record.buffer.slice(record.cursor + 1);
          redraw(record);
        }
        i += 4;
        continue;
      }
      // Unknown escape sequence: skip it whole so it never leaks into input.
      const match = /^\x1b\[[0-9;]*[A-Za-z~]/.exec(seq);
      i += match ? match[0].length : 1;
      continue;
    }
    if (ch >= " ") {
      record.buffer =
        record.buffer.slice(0, record.cursor) + ch + record.buffer.slice(record.cursor);
      record.cursor += 1;
      redraw(record);
    }
    i += 1;
  }
}

const api = {
  // Returns a mount token (> 0) on success, 0 when the host is missing. Pass
  // the token back to destroy() so a stale teardown cannot kill a newer mount.
  mount(hostId, callbacks) {
    const host = document.getElementById(hostId);
    if (!host) return 0;
    this.destroy(hostId);
    ensureCss();
    const term = new Terminal({
      cursorBlink: true,
      convertEol: true, // "\n" from Rust renders as "\r\n"
      scrollback: 2000,
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      theme: askkTheme,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    try {
      fit.fit();
    } catch {
      // A zero-sized host (display: none race) fixes itself on the next resize.
    }
    const history = histories.get(hostId) ?? [];
    histories.set(hostId, history);
    const record = {
      term,
      fit,
      resize: null,
      prompt: "",
      buffer: "",
      cursor: 0,
      pending: true, // locked until Rust sends the first setPrompt
      history,
      histIndex: history.length,
      callbacks: callbacks || {},
      token: ++mountCounter,
    };
    record.resize = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        // Ignore fits against a collapsed host; the next resize recovers.
      }
    });
    record.resize.observe(host);
    term.onData((data) => handleData(record, data));
    terms.set(hostId, record);
    return record.token;
  },

  // Print command/runtime output. While the user sits at an unlocked prompt
  // (injected output, e.g. the editor's ▶ Run), the input line is cleared,
  // the text printed, and prompt + partial input repainted underneath.
  write(hostId, text) {
    const record = terms.get(hostId);
    if (!record || !text) return;
    if (record.pending) {
      record.term.write(text);
      return;
    }
    record.term.write("\r\x1b[K");
    record.term.write(text.endsWith("\n") ? text : text + "\n");
    redraw(record);
  },

  // Store the prompt, print it, and unlock input. Rust calls this after every
  // command's output (and once after mount, following the ready handshake).
  setPrompt(hostId, prompt) {
    const record = terms.get(hostId);
    if (!record) return;
    record.prompt = prompt ?? "";
    if (record.pending) {
      record.pending = false;
      record.buffer = "";
      record.cursor = 0;
      record.term.write(record.prompt);
    } else {
      redraw(record);
    }
  },

  clear(hostId) {
    const record = terms.get(hostId);
    if (!record) return;
    record.term.write("\x1b[2J\x1b[3J\x1b[H");
    if (!record.pending) redraw(record);
  },

  // Without a token this force-destroys (used by mount to replace a terminal);
  // with a token it only destroys the mount that token belongs to. History is
  // intentionally kept so a remount restores ↑/↓ recall.
  destroy(hostId, token) {
    const record = terms.get(hostId);
    if (!record) return;
    if (token !== undefined && record.token !== token) return; // stale teardown
    if (record.resize) record.resize.disconnect();
    record.term.dispose();
    terms.delete(hostId);
  },
};

// Guard against the bundle being injected twice (e.g. duplicate <script>
// tags after page navigation): keep the first instance and its live terminals.
if (!window.AskkTerm) {
  window.AskkTerm = api;
}
