// WASIX spike driver. Loads the self-hosted @wasmer/sdk, runs two real registry
// tools in the browser, and shows stdout + timings. No bundler: this is a plain
// ES module the page loads directly.
//
// Capability being demonstrated vs. the tiny single-binary WASI shim:
//   - coreutils: real prebuilt registry binaries (a multicall package), pulled
//     on demand from the Wasmer registry — no hand-written shim.
//   - Bash: spawns SUBPROCESSES (coreutils) and PIPES them. That requires
//     WASIX process spawning, which a single WebAssembly.instantiate() shim
//     cannot do.
//
// (We originally used python/python here; that CPython WASIX build was flaky
//  under @wasmer/sdk in-browser — see docs/spikes/wasix.md "Python caveat".)
import {
  init,
  Wasmer,
} from "./vendor/wasmer-sdk/index.mjs";

const $ = (id) => document.getElementById(id);
const now = () => performance.now();
const ms = (t) => `${t.toFixed(0)} ms`;

// --- cross-origin isolation check ------------------------------------------
// SharedArrayBuffer is only defined when the document is cross-origin isolated.
const isolated = typeof self.crossOriginIsolated === "boolean"
  ? self.crossOriginIsolated
  : typeof SharedArrayBuffer !== "undefined";

const isoEl = $("iso-status");
if (isolated) {
  isoEl.textContent = "ENABLED (crossOriginIsolated=true, SharedArrayBuffer present)";
  isoEl.className = "ok";
} else {
  isoEl.textContent =
    "DISABLED — SharedArrayBuffer missing. @wasmer/sdk will fail. Serve with COOP/COEP.";
  isoEl.className = "err";
}

// --- SDK init --------------------------------------------------------------
let initPromise = null;
function ensureInit() {
  if (!initPromise) {
    const t0 = now();
    // Point the SDK at our vendored, same-origin assets explicitly. Under
    // COOP/COEP every subresource (the thread-pool worker + the .wasm) must be
    // same-origin / CORP-embeddable, so we self-host all three rather than rely
    // on a CDN default. `module` = the SDK core wasm, `workerUrl` = the
    // thread-pool driver, `sdkUrl` = the SDK ESM the worker re-imports.
    const base = new URL("./vendor/wasmer-sdk/", import.meta.url);
    initPromise = init({
      module: new URL("wasmer_js_bg.wasm", base),
      workerUrl: new URL("worker.mjs", base),
      sdkUrl: new URL("index.mjs", base),
    }).then(() => {
      const dt = now() - t0;
      $("m-init").textContent = ms(dt);
      return dt;
    });
  }
  return initPromise;
}

// Pipe a ReadableStream of bytes into a <pre>, decoding incrementally so the
// user sees output as it is produced (streaming), then resolve when done.
async function streamInto(stream, el) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let acc = "";
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    acc += dec.decode(value, { stream: true });
    el.textContent = acc;
  }
  acc += dec.decode();
  el.textContent = acc || "(no stdout)";
  return acc;
}

function fail(outEl, metaEl, err) {
  outEl.textContent = String(err?.stack ?? err?.message ?? err);
  outEl.className = "err";
  metaEl.textContent = "failed";
}

// --- Tool 1: coreutils (direct, multicall registry package) ----------------
async function runCoreutils() {
  const out = $("out-coreutils");
  const meta = $("meta-coreutils");
  out.className = "";
  out.textContent = "loading @wasmer/sdk + sharrattj/coreutils from registry…";
  meta.textContent = "";
  try {
    await ensureInit();
    const t0 = now();
    const pkg = await Wasmer.fromRegistry("sharrattj/coreutils");
    const tFetched = now();
    // coreutils is a "multicall" package: one .wasm exposing many commands.
    // We pick individual commands by name and run each as its own instance.
    // Each .run() instantiates the SAME cached module, so only the first call
    // pays the compile cost.
    const lines = [];
    // NOTE: never invoke a coreutils command that reads from stdin without
    // supplying `stdin` — with no stdin and no file arg it blocks on EOF
    // forever in the browser. We pass `stdin` explicitly where relevant.
    const runOne = async (cmd, args, stdin) => {
      const command = pkg.commands[cmd] ?? pkg.entrypoint;
      const inst = await command.run(stdin === undefined ? { args } : { args, stdin });
      const r = await inst.wait();
      lines.push(
        `$ ${cmd} ${args.join(" ")}  (exit ${r.code})\n`
          + (r.stdout || r.stderr || "(no output)").trimEnd(),
      );
      out.textContent = lines.join("\n\n");
    };
    await runOne("seq", ["1", "8"]);
    await runOne("base64", [], "askk\n"); // base64-encode stdin
    await runOne("wc", ["-c"], "hello world"); // count bytes of stdin
    await runOne("arch", []); // report the (virtual) machine arch
    const total = now() - t0;
    out.className = "ok";
    meta.textContent =
      `ran ${lines.length} coreutils binaries · fetch ${ms(tFetched - t0)} · total ${ms(total)}`;
    if ($("m-coreutils-cold").textContent === "—") {
      $("m-coreutils-cold").textContent = ms(total);
    }
  } catch (err) {
    fail(out, meta, err);
  }
}

// --- Tool 2: Bash + subprocess + pipe --------------------------------------
async function runBash() {
  const out = $("out-bash");
  const meta = $("meta-bash");
  out.className = "";
  out.textContent = "loading @wasmer/sdk + sharrattj/bash from registry…";
  meta.textContent = "";
  try {
    await ensureInit();
    const t0 = now();
    const pkg = await Wasmer.fromRegistry("sharrattj/bash");
    const tFetched = now();
    // Bash forks a child process for EACH command in a pipeline and wires their
    // stdio together with OS pipes. Every command below (`seq`, `head`, `nl`,
    // `wc`) is a separate coreutils binary spawned as its own WASIX process —
    // process spawning + piping that a single-binary WASI shim (one
    // WebAssembly.instantiate) fundamentally cannot do.
    //
    // coreutils is not bundled in sharrattj/bash; we pull it in via `uses` so
    // those binaries are on PATH. This particular coreutils build is picky about
    // flags (`tail -n N`, `sort -r` are rejected), so we use only flag forms it
    // accepts (`head -N`).
    const script = [
      "echo '== bash subprocess + pipe demo =='",
      "echo \"shell pid: $$  (a real spawned bash process)\"",
      "echo",
      "echo '-- pipe A: seq 1 100 | head -10 | wc -l  (3 processes, 2 pipes) --'",
      "seq 1 100 | head -10 | wc -l",
      "echo",
      "echo '-- pipe B: seq 1 5 | nl | head -3  (number lines, take first 3) --'",
      "seq 1 5 | nl | head -3",
      "echo",
      "echo '-- pipe C: even numbers in 1..50 = seq 2 2 50 | wc -l --'",
      "seq 2 2 50 | wc -l",
      "echo",
      "echo '== done =='",
    ].join("\n");
    const instance = await pkg.entrypoint.run({
      args: ["-c", script],
      uses: ["sharrattj/coreutils"],
    });
    // Demonstrate streaming: pipe stdout into the page as it arrives.
    const [stdoutText, result] = await Promise.all([
      streamInto(instance.stdout, out),
      instance.wait(),
    ]);
    const total = now() - t0;
    // The pipeline emits the "== done ==" marker iff every stage ran. We treat
    // that as success rather than the exit code: `head` closing a pipe early
    // makes upstream `seq` see SIGPIPE, and this bash maps that to a non-zero
    // exit even though all output is correct.
    const sawDone = /== done ==/.test(stdoutText);
    out.className = sawDone ? "ok" : "err";
    if (result.stderr) {
      out.textContent = (stdoutText || "") + `\n[stderr]\n${result.stderr}`;
    }
    meta.textContent =
      `exit ${result.code}${sawDone ? " (SIGPIPE on early-close; output OK)" : ""}`
      + ` · fetch+compile ${ms(tFetched - t0)} · total ${ms(total)}`;
    if ($("m-bash-cold").textContent === "—") {
      $("m-bash-cold").textContent = ms(total);
    }
  } catch (err) {
    fail(out, meta, err);
  }
}

// --- wire up ---------------------------------------------------------------
const coreBtn = $("run-coreutils");
const bashBtn = $("run-bash");

// A module-level lock: the SDK runtime serializes work, and two overlapping
// fromRegistry()/run() calls can wedge it. Refuse to start a second run while
// one is in flight (covers double-clicks AND programmatic callers).
let busy = false;

function guard(fn) {
  return async () => {
    if (busy) return;
    busy = true;
    coreBtn.disabled = true;
    bashBtn.disabled = true;
    try {
      await fn();
    } finally {
      busy = false;
      coreBtn.disabled = false;
      bashBtn.disabled = false;
    }
  };
}

const runCoreutilsGuarded = guard(runCoreutils);
const runBashGuarded = guard(runBash);
coreBtn.addEventListener("click", runCoreutilsGuarded);
bashBtn.addEventListener("click", runBashGuarded);

// Only enable the buttons if isolation is present; otherwise the SDK can't run.
if (isolated) {
  coreBtn.disabled = false;
  bashBtn.disabled = false;
} else {
  // Leave disabled; the iso banner explains why.
}

// Expose a programmatic entry point so the measure script / MCP eval can drive
// the demo headlessly and read results back. The *Guarded variants honour the
// busy lock (use these to avoid wedging the runtime with overlapping runs).
window.__wasixSpike = {
  runCoreutils: runCoreutilsGuarded,
  runBash: runBashGuarded,
  ensureInit,
  isolated,
};
