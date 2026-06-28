// ASKK wasi-shim spike — host glue.
//
// Loads the vendored @bjorn3/browser_wasi_shim, builds a small in-memory
// virtual filesystem (one preopened dir with an input file), runs demo.wasm,
// pipes stdout/stderr to the page, reads back a guest-written file, and reports
// timing/size measurements. Pure ESM; runs from a plain static server with no
// COOP/COEP headers.

import {
  WASI,
  WASIProcExit,
  File,
  PreopenDirectory,
  ConsoleStdout,
  OpenFile,
} from "./vendor/index.js";

const $ = (id) => document.getElementById(id);
const fmtMs = (ms) => `${ms.toFixed(1)} ms`;
const fmtBytes = (b) =>
  b < 1024 ? `${b} B` : `${(b / 1024).toFixed(2)} KiB`;

// Report the network cost of the vendored shim ESM files using the Resource
// Timing API. `duration` is summed per file (parallel fetches overlap, so this
// is an upper bound, not wall-clock); the authoritative size figure is the
// gzipped on-disk total recorded in docs/spikes/wasi-shim.md.
function reportShimLoad() {
  const entries = performance
    .getEntriesByType("resource")
    .filter((e) => e.name.includes("/vendor/") && e.name.endsWith(".js"));
  if (entries.length === 0) {
    $("m-shimload").textContent = "n/a (cached)";
    return;
  }
  const total = entries.reduce((acc, e) => acc + e.duration, 0);
  const transferred = entries.reduce(
    (acc, e) => acc + (e.transferSize || 0),
    0,
  );
  $("m-shimload").textContent = `${fmtMs(total)} over ${
    entries.length
  } files (${transferred ? fmtBytes(transferred) : "cached"} transferred)`;
}

function reportCOI() {
  const ci = self.crossOriginIsolated;
  $("m-coi").textContent = ci
    ? "true (headers ARE present)"
    : "false — running WITHOUT COOP/COEP ✅";
}

async function run() {
  const runBtn = $("run");
  runBtn.disabled = true;
  $("status").textContent = "running…";
  $("stdout").textContent = "";
  $("readback").textContent = "(none yet)";

  const out = [];
  const push = (line) => {
    out.push(line);
    $("stdout").textContent = out.join("\n");
  };

  try {
    reportCOI();
    reportShimLoad();

    // --- Build the virtual filesystem -------------------------------------
    // /sandbox is a preopened directory the guest can read+write. We seed it
    // with input.txt; the guest reads it and writes output.txt back.
    const inputBytes = new TextEncoder().encode(
      "hello from the host-seeded virtual file\nline two\n",
    );
    const sandbox = new PreopenDirectory(
      "/sandbox",
      new Map([["input.txt", new File(inputBytes)]]),
    );

    const fds = [
      new OpenFile(new File([])), // fd 0: stdin (empty)
      ConsoleStdout.lineBuffered((line) => push(line)), // fd 1: stdout
      ConsoleStdout.lineBuffered((line) => push("[stderr] " + line)), // fd 2
      sandbox, // fd 3: preopened /sandbox
    ];

    const args = ["demo.wasm", "--greet", "askk", "tier-1"];
    const env = ["ASKK_GREETING=in-browser-wasi"];
    const wasi = new WASI(args, env, fds, { debug: false });

    // --- Fetch + compile ---------------------------------------------------
    const tStart = performance.now();
    const resp = await fetch("./demo.wasm");
    const wasmBytes = await resp.arrayBuffer();
    $("m-binsize").textContent = fmtBytes(wasmBytes.byteLength);

    const module = await WebAssembly.compile(wasmBytes);
    const tCompiled = performance.now();
    $("m-compile").textContent = fmtMs(tCompiled - tStart);

    // --- Instantiate + run -------------------------------------------------
    const instance = await WebAssembly.instantiate(module, {
      wasi_snapshot_preview1: wasi.wasiImport,
    });

    let exitCode = 0;
    try {
      // wasi.start() runs _start and throws WASIProcExit on exit().
      exitCode = wasi.start(instance);
    } catch (e) {
      if (e instanceof WASIProcExit) {
        exitCode = e.code;
      } else {
        throw e;
      }
    }
    const tDone = performance.now();
    $("m-run").textContent = fmtMs(tDone - tCompiled);
    $("m-total").textContent = fmtMs(tDone - tStart);
    $("m-exit").textContent = String(exitCode);

    // --- Read back the file the guest wrote --------------------------------
    // sandbox.dir.contents is a Map<string, Inode>; output.txt should exist.
    const written = sandbox.dir.contents.get("output.txt");
    if (written && written.data) {
      $("readback").textContent = new TextDecoder().decode(written.data);
    } else {
      $("readback").textContent =
        "(guest did not write output.txt — FS round-trip FAILED)";
    }

    $("status").innerHTML = `<span class="ok">done (exit ${exitCode})</span>`;
  } catch (e) {
    push("HOST ERROR: " + (e && e.stack ? e.stack : String(e)));
    $("status").textContent = "error";
    console.error(e);
  } finally {
    runBtn.disabled = false;
  }
}

$("run").addEventListener("click", run);
// Auto-run once on load so the preview/screenshot capture shows output.
window.addEventListener("load", () => {
  // Defer slightly so Resource Timing entries for the vendor imports settle.
  setTimeout(run, 50);
});
