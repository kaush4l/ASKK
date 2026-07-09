// ASKK v86 x86 VM serial-console bundle entry.
//
// Compiled to a single IIFE asset (`assets/v86_vm.js`) with `bun run build`,
// loaded by the WASM app via `asset!()` + `document::Script`, and driven from
// Rust through `document::eval` (see `src/components/v86_page.rs`). It boots a
// real x86 guest under v86 (https://github.com/copy/v86) and presents it as a
// no-GUI RAW serial terminal: an xterm instance owned by THIS bundle pipes
// per-byte serial0 I/O both ways. This is deliberately NOT the line-buffered
// `AskkTerm` shell API — a serial TTY is raw bytes in, raw bytes out.
//
// ponytail: v86 runs on the MAIN thread (simplest). Worker-offload is a future
// option; v86 supports it but it buys nothing until the page-op hub is pooled.
//
// Committed default image: assets/runtimes/v86/buildroot.iso — v86's stock
// "Linux" buildroot CD-ROM (ISO 9660, ~5.4 MB), boots busybox to a serial
// shell ("/ #" prompt). Chosen over a .bin bzImage because the v86 CDN only
// reliably serves the .iso; the .bin variants 404. imageType "cdrom".
//
// No COOP/COEP, no SharedArrayBuffer: we pass `wasm_path` (a plain URL) so
// libv86 fetches + instantiates the wasm itself; we never set `wasm_fn` (the
// SAB-only path the app deliberately avoids).
//
// The wire contract (consumed by a sibling unit — keep stable):
//   window.AskkV86.boot(hostId, {
//       serialHostId, imageUrl, imageType, memMB, wasmUrl, biosUrl, vgaBiosUrl,
//       cmdline, initrdUrl, cdromUrl, onState
//   }) -> token (0 if the serial host element is missing)
// initrdUrl pairs with imageType "bzimage"; cdromUrl attaches an ISO as a
// SECOND drive next to a bzimage boot (alpine's initramfs then finds its
// apks/modloop on the cdrom — the serial-console path for stock ISOs whose
// isolinux menu only talks to VGA).
//   window.AskkV86.sendSerial(hostId, text)   // raw bytes into the guest TTY
//   window.AskkV86.exec(hostId, cmd, timeoutMs?) -> Promise<string>
//       Run one shell command in the guest over serial and capture its
//       output (marker-delimited; rejects on timeout / no VM).
//   window.AskkV86.saveState(hostId) -> Promise<Uint8Array>
//   window.AskkV86.destroy(hostId, token?)    // token-guarded teardown
// Auto-login: when the serial tail ends in "login:" the bundle sends
// "root\n" (live-ISO root has no password), so the guest lands on a shell
// without user input and exec() works headlessly.
// where imageType ∈ "state" | "flat" | "bzimage" | "cdrom" and
// onState(s) reports "downloading" | "booting" | "ready" | "error".
//
// sendSerial/saveState/destroy take the same `hostId` passed to boot, so a
// caller that knows the host id can drive the VM without holding the V86
// instance. The serial xterm lives in the element named by `serialHostId`.

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import termCss from "@xterm/xterm/css/xterm.css" with { type: "text" };
import { V86 } from "v86";

// Matches the IDE terminal palette (see scripts/xterm-term/entry.js).
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
  if (document.getElementById("askk-v86-css")) return;
  const style = document.createElement("style");
  style.id = "askk-v86-css";
  style.textContent = termCss;
  document.head.appendChild(style);
}

// hostId -> { emulator, term, fit, resize, token, decoder, destroyed }
const vms = new Map();

// Monotonic token: a remount can leave the previous mount's teardown running
// after a new one; tokens let a stale teardown no-op instead of killing the VM
// that replaced it (same scheme as AskkTerm / AskkCM).
let mountCounter = 0;

// Monotonic exec sequence: each exec() gets a unique completion marker.
let execSeq = 0;

// Fetch a runtime blob cache-first via Cache Storage so multi-MB images are
// downloaded once per deploy (asset URLs are content-hashed). Returns an
// ArrayBuffer. Falls back to a plain fetch when Cache Storage is unavailable.
const RUNTIME_CACHE_NAME = "askk-runtimes";
async function fetchBuffer(url) {
  let cache = null;
  try {
    if (typeof caches !== "undefined") {
      cache = await caches.open(RUNTIME_CACHE_NAME);
      const hit = await cache.match(url);
      if (hit) return await hit.arrayBuffer();
    }
  } catch (_) {
    cache = null; // best-effort; fall through to network
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch ${url} failed: HTTP ${resp.status}`);
  if (cache) {
    try {
      await cache.put(url, resp.clone());
    } catch (_) {
      // Quota / opaque-response trouble: caching is best-effort.
    }
  }
  return await resp.arrayBuffer();
}

// Map our imageType onto the v86 disk-config key.
function imageOption(imageType) {
  switch (imageType) {
    case "flat":
      return "hda"; // raw flat disk image
    case "bzimage":
      return "bzimage";
    case "cdrom":
      return "cdrom";
    case "state":
      return "initial_state";
    default:
      return "cdrom";
  }
}

const api = {
  // Boot a guest, wiring serial0 <-> a fresh raw xterm in `serialHostId`.
  // Returns a mount token (> 0) on success, 0 when the host element is missing.
  //
  // The registry is keyed on `hostId` (the contract's identity for sendSerial /
  // destroy); the terminal DOM element is located via `serialHostId`. When a
  // caller omits `hostId` it defaults to `serialHostId`, so a single-id caller
  // can pass just the serial host.
  boot(hostId, opts) {
    const o = opts || {};
    const onState = typeof o.onState === "function" ? o.onState : () => {};
    const key = hostId || o.serialHostId;
    const host = document.getElementById(o.serialHostId);
    if (!host) {
      onState("error");
      return 0;
    }
    // Replace any prior VM registered under this key.
    this.destroy(key);
    ensureCss();

    const term = new Terminal({
      cursorBlink: true,
      convertEol: false, // raw TTY: the guest sends its own CR/LF
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
      // Zero-sized host (display:none race); the next resize recovers.
    }

    const token = ++mountCounter;
    const record = {
      emulator: null,
      term,
      fit,
      resize: null,
      token,
      decoder: new TextDecoder("utf-8", { fatal: false }),
      destroyed: false,
      sawOutput: false,
      // Rolling serial tail for the auto-login watcher + exec capture taps.
      tail: "",
      taps: new Set(),
      loginSent: false,
      shellSeen: false,
    };
    record.resize = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch (_) {
        // Ignore fits against a collapsed host; the next resize recovers.
      }
    });
    record.resize.observe(host);
    vms.set(key, record);

    // Terminal -> guest: raw bytes straight into serial0 (wired now so even
    // pre-boot keystrokes are forwarded once the emulator exists).
    term.onData((data) => {
      if (!record.destroyed && record.emulator) {
        record.emulator.serial0_send(data);
      }
    });

    // Boot asynchronously: fetch the image (and BIOS) then construct V86.
    (async () => {
      try {
        onState("downloading");
        const imageBuf = await fetchBuffer(o.imageUrl);
        if (record.destroyed) return;

        const config = {
          wasm_path: o.wasmUrl,
          memory_size: (o.memMB && o.memMB > 0 ? o.memMB : 128) * 1024 * 1024,
          vga_memory_size: 2 * 1024 * 1024,
          autostart: true,
          disable_keyboard: true, // no VGA/keyboard; serial only
          disable_mouse: true,
          disable_speaker: true,
          [imageOption(o.imageType)]: { buffer: imageBuf },
        };
        if (o.biosUrl) {
          config.bios = { buffer: await fetchBuffer(o.biosUrl) };
        }
        if (o.vgaBiosUrl) {
          config.vga_bios = { buffer: await fetchBuffer(o.vgaBiosUrl) };
        }
        if (o.initrdUrl) {
          config.initrd = { buffer: await fetchBuffer(o.initrdUrl) };
        }
        if (o.cdromUrl && imageOption(o.imageType) !== "cdrom") {
          config.cdrom = { buffer: await fetchBuffer(o.cdromUrl) };
        }
        if (typeof o.cmdline === "string" && o.cmdline.length > 0) {
          config.cmdline = o.cmdline;
        }
        if (record.destroyed) return;

        const emulator = new V86(config);
        record.emulator = emulator;

        // Guest -> terminal: one byte per event, decoded incrementally so
        // multi-byte UTF-8 sequences render correctly. First byte flips state
        // to "ready" (the boot log / shell prompt has started flowing).
        emulator.add_listener("serial0-output-byte", (byte) => {
          if (record.destroyed) return;
          if (!record.sawOutput) {
            record.sawOutput = true;
            onState("ready");
          }
          const text = record.decoder.decode(new Uint8Array([byte]), {
            stream: true,
          });
          if (!text) return;
          term.write(text);
          for (const tap of record.taps) tap(text);
          // Auto-login watcher: getty prompts end in "login: ".
          record.tail = (record.tail + text).slice(-160);
          if (/login: ?$/.test(record.tail) && o.autoLogin !== false) {
            record.loginSent = true;
            emulator.serial0_send("root\n");
            record.tail = "";
          }
          if (/[#%$] $/.test(record.tail)) {
            // First time at a shell prompt: turn OFF input echo AND blank the
            // heredoc continuation prompt (PS2) so exec() captures ONLY the
            // command's real stdout — not the echoed command, heredoc `>`
            // lines, or prompts (which otherwise pollute a tool's observation).
            if (!record.shellSeen) {
              emulator.serial0_send("stty -echo 2>/dev/null; PS2=''\n");
            }
            record.shellSeen = true;
          }
        });
        emulator.add_listener("emulator-started", () => {
          if (!record.destroyed) onState("booting");
        });
      } catch (err) {
        if (!record.destroyed) {
          try {
            term.write(`\r\n[v86] boot failed: ${String(err)}\r\n`);
          } catch (_) {
            // terminal may be torn down; ignore.
          }
          onState("error");
        }
      }
    })();

    return token;
  },

  // Raw bytes into the guest serial TTY (e.g. a command pushed from Rust).
  sendSerial(hostId, text) {
    const record = vms.get(hostId);
    if (record && record.emulator && !record.destroyed) {
      record.emulator.serial0_send(text);
    }
  },

  // Whether the guest has reached an interactive shell (auto-login done).
  shellReady(hostId) {
    const record = vms.get(hostId);
    return !!(record && record.shellSeen && !record.destroyed);
  },

  // Run ONE command in the guest shell and capture its output until a marker
  // line lands. The marker is assembled from two string halves so the command
  // text never contains it. Input echo is off (set at first prompt), so the
  // captured buffer is ONLY the command's real stdout/stderr — no echoed
  // command, no heredoc PS2 lines. Rejects on timeout or missing VM.
  exec(hostId, cmd, timeoutMs) {
    const record = vms.get(hostId);
    if (!record || !record.emulator || record.destroyed) {
      return Promise.reject(new Error(`AskkV86.exec: no VM at ${hostId}`));
    }
    const n = ++execSeq;
    // Bracket the output with a START and a DONE marker (each split across two
    // string halves so the command text can never contain them). The captured
    // output is strictly what lands BETWEEN them — no leading shell prompt, no
    // trailing prompt. DONE carries the exit code.
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
        // Strip the newline right after START, one leading shell-prompt token
        // (e.g. "/root% " that can precede output), and the newline before DONE.
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
      record.emulator.serial0_send(
        `printf '__ASKK_''BEG_${n}__\\n'; ${cmd}; printf '__ASKK_''DONE_${n}__%s\\n' $?\n`
      );
    });
  },

  // Snapshot the running guest's full state (suspend/resume, or a sibling unit
  // baking a fast-boot "state" image). Returns a Uint8Array.
  async saveState(hostId) {
    const record = vms.get(hostId);
    if (!record || !record.emulator) {
      throw new Error(`AskkV86.saveState: no VM at ${hostId}`);
    }
    const buf = await record.emulator.save_state();
    return new Uint8Array(buf);
  },

  // Without a token this force-destroys (used by boot to replace a VM); with a
  // token it only destroys the mount that token belongs to (stale-teardown
  // guard against remount races).
  destroy(hostId, token) {
    const record = vms.get(hostId);
    if (!record) return;
    if (token !== undefined && record.token !== token) return; // stale teardown
    record.destroyed = true;
    if (record.resize) record.resize.disconnect();
    if (record.emulator) {
      try {
        record.emulator.destroy();
      } catch (_) {
        // already torn down; ignore.
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

// Guard against double-injection (duplicate <script> after navigation): keep
// the first instance and its live VMs.
if (!window.AskkV86) {
  window.AskkV86 = api;
}
