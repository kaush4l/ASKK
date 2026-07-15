// ASKK container2wasm (c2w) x86_64 VM serial-console bundle entry.
//
// Compiled to a single IIFE asset (`assets/vm/c2w.js`) with `bun run build`,
// loaded by the WASM app via `asset!()` + `document::Script`. It boots a real
// 64-bit Alpine guest: the whole container + Bochs x86_64 emulator lives in
// ONE WASI module (`alpine64.wasm`, built by container2wasm) executed in a
// dedicated worker, wired to an xterm on the main thread through xterm-pty.
//
// REQUIRES cross-origin isolation (SharedArrayBuffer): xterm-pty's
// TtyServer/TtyClient block the worker on Atomics.wait. The app ships
// `coi-serviceworker` (injected at publish time) to get COOP/COEP on static
// hosts; without isolation boot() reports "error" and explains on the xterm.
//
// The wire contract mirrors AskkV86 (see scripts/vm/entry.js — keep stable):
//   window.AskkC2W.boot(hostId, {
//       serialHostId, wasmUrl, workerUrl, supportUrls, onState
//   }) -> token (0 if the serial host element is missing)
//   window.AskkC2W.sendSerial(hostId, text)
//   window.AskkC2W.exec(hostId, cmd, timeoutMs?) -> Promise<string>
//   window.AskkC2W.shellReady(hostId) -> bool
//   window.AskkC2W.destroy(hostId, token?)
// where supportUrls = { workerTools, wasiShimIndex, wasiDefs, workerUtil,
// wasiUtil } — classic-script asset URLs importScripts'd by the worker
// (Dioxus hashes asset names, so the worker can't hardcode them).
// onState(s) reports "downloading" | "booting" | "ready" | "error".

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import termCss from "@xterm/xterm/css/xterm.css" with { type: "text" };
import {
  openpty,
  Termios,
  TtyServer,
  ISTRIP,
  INLCR,
  IGNCR,
  ICRNL,
  IXON,
  OPOST,
  ECHO,
  ECHONL,
  ICANON,
  ISIG,
  IEXTEN,
} from "xterm-pty";

// Same palette as the v86 console (scripts/vm/entry.js).
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

function ensureCss() {
  if (document.getElementById("askk-c2w-css")) return;
  const style = document.createElement("style");
  style.id = "askk-c2w-css";
  style.textContent = termCss;
  document.head.appendChild(style);
}

// hostId -> { worker, term, fit, resize, token, destroyed, tail, taps, shellSeen }
const vms = new Map();
let mountCounter = 0;
let execSeq = 0;

const api = {
  boot(hostId, opts) {
    const o = opts || {};
    const onState = typeof o.onState === "function" ? o.onState : () => {};
    const key = hostId || o.serialHostId;
    const host = document.getElementById(o.serialHostId);
    if (!host) {
      onState("error");
      return 0;
    }
    this.destroy(key);
    ensureCss();

    const term = new Terminal({
      cursorBlink: true,
      convertEol: false,
      scrollback: 5000,
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      theme: askkTheme,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    try {
      fit.fit();
    } catch (_) {
      // zero-sized host; next resize recovers.
    }

    const token = ++mountCounter;
    const record = {
      worker: null,
      term,
      fit,
      resize: null,
      token,
      destroyed: false,
      sawOutput: false,
      tail: "",
      taps: new Set(),
      shellSeen: false,
    };
    record.resize = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch (_) {
        // collapsed host; ignore.
      }
    });
    record.resize.observe(host);
    vms.set(key, record);

    if (typeof SharedArrayBuffer === "undefined") {
      term.write(
        "\r\n[c2w] SharedArrayBuffer unavailable: page is not cross-origin" +
          " isolated (COOP/COEP). The 64-bit VM cannot run here.\r\n"
      );
      onState("error");
      return token;
    }

    const { master, slave } = openpty();
    // Raw tty (mirrors the upstream wasi-browser example): the guest side
    // does its own echo/line handling.
    const t = slave.ioctl("TCGETS");
    t.iflag &= ~(ISTRIP | INLCR | IGNCR | ICRNL | IXON);
    t.oflag &= ~OPOST;
    t.lflag &= ~(ECHO | ECHONL | ICANON | ISIG | IEXTEN);
    slave.ioctl("TCSETS", new Termios(t.iflag, t.oflag, t.cflag, t.lflag, t.cc));
    term.loadAddon(master);

    // Tap guest output on its way to the pty: TtyServer calls slave.write.
    const origWrite = slave.write.bind(slave);
    const decoder = new TextDecoder("utf-8", { fatal: false });
    slave.write = (data) => {
      origWrite(data);
      if (record.destroyed) return;
      const bytes = data instanceof Uint8Array ? data : Uint8Array.from(data);
      const text = decoder.decode(bytes, { stream: true });
      if (!text) return;
      if (!record.sawOutput) {
        record.sawOutput = true;
        onState("ready");
      }
      for (const tap of record.taps) tap(text);
    };

    // Readiness probe: prompt-regex sniffing is fragile across guests, so
    // once output flows, periodically ask the shell to print a marker (the
    // string is split so a local echo of the command can never match). The
    // first marker sighting = the shell executes commands = ready; then
    // echo + PS2 are silenced so exec() captures only real output.
    const rdyTap = (text) => {
      record.rdyBuf = ((record.rdyBuf || "") + text).slice(-96);
      if (record.rdyBuf.includes("__ASKK_RDY__") && !record.rdyDone) {
        record.rdyDone = true;
        record.taps.delete(rdyTap);
        // Settle exec before declaring ready. busybox ash (ASK_TERMINAL)
        // sends a cursor-position query at every echoing prompt; xterm's
        // answer lands on the next command line and corrupts its first
        // token. Echo stays ON (humans type here); each exec() defends
        // itself with a \x15 kill-line prefix, and these two settle execs
        // absorb the boot-time garbage the first prompts leave behind.
        api
          .exec(key, "PS2=''", 15000)
          .catch(() => {})
          // Second settle: the guest tty still owes one garbage line after
          // the first (observed: exactly the first post-ready exec eats it,
          // regardless of delay) — sacrifice a throwaway exec to it.
          .then(() => api.exec(key, "true", 15000))
          .catch(() => {})
          .then(() => {
            if (!record.destroyed) record.shellSeen = true;
          });
      }
    };
    record.taps.add(rdyTap);
    const probe = setInterval(() => {
      if (record.destroyed || record.rdyDone) {
        clearInterval(probe);
        return;
      }
      if (record.sawOutput) {
        api.sendSerial(key, "\u0015printf '__ASKK_''RDY__\\n'\n");
      }
    }, 2500);

    onState("downloading");
    const worker = new Worker(o.workerUrl);
    record.worker = worker;
    const s = o.supportUrls || {};
    worker.postMessage({
      type: "conf",
      scripts: [s.workerTools, s.wasiShimIndex, s.wasiDefs, s.workerUtil, s.wasiUtil],
    });
    worker.onmessage = (ev) => {
      if (ev.data && ev.data.type === "conf-ok") {
        if (record.destroyed) return;
        onState("booting");
        worker.postMessage({ type: "init", imagename: o.wasmUrl });
        new TtyServer(slave).start(worker);
      }
    };
    worker.onerror = (e) => {
      if (!record.destroyed) {
        try {
          term.write(`\r\n[c2w] worker error: ${e.message || e}\r\n`);
        } catch (_) {
          // torn down; ignore.
        }
        onState("error");
      }
    };

    // Keystrokes flow xterm -> master addon -> pty -> worker automatically.
    record.master = master;
    return token;
  },

  sendSerial(hostId, text) {
    const record = vms.get(hostId);
    if (!record || record.destroyed) return;
    // Feed the pty as if typed. term.input (not term.paste): paste strips
    // control characters, and the readiness probe needs \x15 (kill-line) to
    // flush garbage that xterm's terminal-query answers leave on the line.
    record.term.input(text.replace(/\n/g, "\r"), false);
  },

  shellReady(hostId) {
    const record = vms.get(hostId);
    return !!(record && record.shellSeen && !record.destroyed);
  },

  exec(hostId, cmd, timeoutMs) {
    const record = vms.get(hostId);
    if (!record || !record.worker || record.destroyed) {
      return Promise.reject(new Error(`AskkC2W.exec: no VM at ${hostId}`));
    }
    const n = ++execSeq;
    const beg = `__ASKK_BEG_${n}__`;
    const done = `__ASKK_DONE_${n}__`;
    return new Promise((resolve, reject) => {
      let buf = "";
      const tap = (text) => {
        buf += text;
        const dAt = buf.indexOf(done);
        if (dAt < 0) return;
        record.taps.delete(tap);
        clearTimeout(timer);
        const bAt = buf.indexOf(beg);
        const from = bAt >= 0 ? bAt + beg.length : 0;
        let out = buf
          .slice(from, dAt)
          .replace(/^\r?\n/, "")
          .replace(/^\S*\s*[#%$]\s+/, "")
          .replace(/\r?\n?$/, "");
        const exit = (buf.slice(dAt + done.length).match(/^(\d+)/) || [])[1];
        resolve(exit && exit !== "0" ? `${out}\n[exit ${exit}]` : out);
      };
      const timer = setTimeout(() => {
        record.taps.delete(tap);
        reject(new Error(`exec timed out after ${timeoutMs || 30000} ms`));
      }, timeoutMs || 30000);
      record.taps.add(tap);
      this.sendSerial(
        hostId,
        // \x15 (kill-line) first: busybox ash's prompt-time cursor query is
        // answered by xterm and the reply sits on the input line — without
        // the kill it glues onto this command and corrupts the BEG marker.
        `\u0015printf '__ASKK_''BEG_${n}__\\n'; ${cmd}; printf '__ASKK_''DONE_${n}__%s\\n' $?\n`
      );
    });
  },

  destroy(hostId, token) {
    const record = vms.get(hostId);
    if (!record) return;
    if (token !== undefined && record.token !== token) return;
    record.destroyed = true;
    if (record.resize) record.resize.disconnect();
    if (record.worker) {
      try {
        record.worker.terminate();
      } catch (_) {
        // ignore.
      }
    }
    try {
      record.term.dispose();
    } catch (_) {
      // ignore.
    }
    vms.delete(hostId);
  },
};

if (!window.AskkC2W) {
  window.AskkC2W = api;
}
