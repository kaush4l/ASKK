// spike.js — ASKK batch 05 container2wasm driver.
//
// Self-contained boot of an alpine container.wasm in a Web Worker via the
// container2wasm WASI-on-browser glue. This replaces the upstream demo's per-page
// `startWasi(...)` inline call and adds:
//   - cold-boot / time-to-first-output / command-completion timing,
//   - a captured plain-text mirror of terminal output (window.__c2wOutput) so an
//     automated screenshot/eval harness can read the result,
//   - a SharedArrayBuffer / cross-origin-isolation check surfaced in the UI.
//
// The container command is delivered to the worker the same way the upstream demo
// does it: through the worker script's own `location.search` (`?args=<cmd>&net=none`),
// which docs/src/worker.js reads via getArgs()/getNetParam().

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const NET_NONE = true; // this spike runs offline; no in-browser HTTP proxy.

  // ---- cross-origin isolation / SharedArrayBuffer check -------------------
  function reportCoi() {
    const el = $("coi");
    const hasSAB = typeof SharedArrayBuffer !== "undefined";
    const isolated = (typeof crossOriginIsolated !== "undefined") && crossOriginIsolated;
    if (hasSAB && isolated) {
      el.textContent = "enabled (crossOriginIsolated=true, SharedArrayBuffer present)";
      el.className = "pill ok";
    } else if (hasSAB) {
      el.textContent = "PARTIAL: SharedArrayBuffer present but crossOriginIsolated=false";
      el.className = "pill warn";
    } else {
      el.textContent = "MISSING: no SharedArrayBuffer — COOP/COEP headers not applied (boot will fail)";
      el.className = "pill bad";
    }
    return hasSAB && isolated;
  }

  // ---- output capture -----------------------------------------------------
  window.__c2wOutput = "";
  window.__c2wMetrics = {};

  function appendOutput(text) {
    window.__c2wOutput += text;
  }

  // ---- timing helpers -----------------------------------------------------
  const now = () => performance.now();

  function renderMetrics(m) {
    window.__c2wMetrics = m;
    const fmt = (ms) => (ms == null ? "…" : (ms / 1000).toFixed(2) + " s");
    const mb = (b) => (b == null ? "…" : (b / 1048576).toFixed(1) + " MB");
    $("metrics").textContent =
      "image:                 " + (m.image || "—") + "\n" +
      "bytes downloaded:      " + mb(m.bytes) + (m.bytesNote ? "  (" + m.bytesNote + ")" : "") + "\n" +
      "cold boot -> 1st byte: " + fmt(m.firstOutputMs) + "\n" +
      "command completed in:  " + fmt(m.commandMs) + "\n" +
      "total (click->done):   " + fmt(m.totalMs) + "\n" +
      "crossOriginIsolated:   " + String(typeof crossOriginIsolated !== "undefined" && crossOriginIsolated);
  }

  // ---- boot ---------------------------------------------------------------
  let running = false;

  function boot() {
    if (running) return;
    running = true;
    $("run").disabled = true;
    $("status").textContent = "booting…";

    const isolated = reportCoi();
    if (!isolated) {
      $("status").textContent = "ABORT: not cross-origin isolated (need COOP/COEP).";
      $("run").disabled = false;
      running = false;
      return;
    }

    const [prefix, chunksStr, label] = $("image").value.split("|");
    const chunks = parseInt(chunksStr, 10);
    const userCmd = $("cmd").value;

    // Append a unique sentinel echo so we can detect command completion even when
    // the container keeps a shell alive afterwards.
    const SENTINEL = "__C2W_DONE_" + Math.random().toString(36).slice(2);
    const cmd = buildCmd(userCmd, SENTINEL);

    // The worker reads args + net from its OWN location.search via
    // decodeURIComponent(), which does NOT turn "+" back into a space. So we must
    // encode with encodeURIComponent (spaces -> %20), NOT URLSearchParams (which
    // encodes spaces as "+" and would corrupt the command).
    let workerSearch = "?args=" + encodeURIComponent(cmd);
    if (NET_NONE) workerSearch += "&net=none";

    const t0 = now();
    let tFirstOutput = null;
    const metrics = {
      image: label + " (" + prefix + ", " + chunks + " chunks)",
      bytes: null,
      bytesNote: "see fetch-assets.sh / findings doc",
      firstOutputMs: null,
      commandMs: null,
      totalMs: null,
    };
    renderMetrics(metrics);

    // Measure how many bytes the chunk fetches pull in, by HEAD-summing them.
    measureChunkBytes(prefix, chunks).then((b) => {
      if (b != null) { metrics.bytes = b; metrics.bytesNote = "container .wasm chunks only"; renderMetrics(metrics); }
    });

    // ---- terminal + pty ----
    const xterm = new Terminal({ cols: 100, rows: 24 });
    xterm.open($("terminal"));
    const { master, slave } = openpty();
    let termios = slave.ioctl("TCGETS");
    termios.iflag &= ~(ISTRIP | INLCR | IGNCR | ICRNL | IXON);
    termios.oflag &= ~(OPOST);
    termios.lflag &= ~(ECHO | ECHONL | ICANON | ISIG | IEXTEN);
    slave.ioctl("TCSETS", new Termios(termios.iflag, termios.oflag, termios.cflag, termios.lflag, termios.cc));
    xterm.loadAddon(master);

    // Mirror everything written to the terminal into our plain-text capture buffer
    // and detect first output (= "boot finished, container started producing
    // stdout"). xterm-pty's master addon drives container stdout through
    // xterm.write(), so wrapping it captures exactly what the container prints.
    const origWrite = xterm.write.bind(xterm);
    xterm.write = (data, cb) => {
      const s = typeof data === "string" ? data : new TextDecoder().decode(data);
      if (tFirstOutput == null) {
        tFirstOutput = now();
        metrics.firstOutputMs = tFirstOutput - t0;
        $("status").textContent = "container booted, running command…";
        renderMetrics(metrics);
      }
      appendOutput(s);
      return origWrite(data, cb);
    };

    // ---- worker (the emulator) ----
    const worker = new Worker("./src/worker.js" + workerSearch);

    // The worker's fetchChunks() does `fetch(imagename + "NN" + ".wasm")` and
    // resolves relative URLs against the WORKER script (/src/worker.js), so we must
    // pass an ABSOLUTE image-name prefix that already includes the containers/ path
    // and the "-container" suffix (mirrors upstream startWasi).
    const imagename = location.origin + "/containers/" + prefix + "-container";

    // net=none path: no stack worker, init the VM worker directly (mirrors upstream
    // startWasi's no-stack branch).
    worker.postMessage({ type: "init", imagename: imagename, chunks: chunks });

    // Start the TTY bridge between the main thread and the emulator worker.
    new TtyServer(slave).start(worker, null);

    // Detect command completion by watching for the sentinel echo we appended to
    // the command (works even if the container keeps a shell alive afterwards).
    const poll = setInterval(() => {
      if (window.__c2wOutput.includes(SENTINEL)) {
        clearInterval(poll);
        const tEnd = now();
        metrics.commandMs = tFirstOutput != null ? tEnd - tFirstOutput : null;
        metrics.totalMs = tEnd - t0;
        renderMetrics(metrics);
        $("status").textContent = "DONE ✓ command output captured.";
        $("run").disabled = false;
        running = false;
        window.__c2wDone = true;
      }
    }, 200);

    // Safety: stop polling after 5 min.
    setTimeout(() => clearInterval(poll), 5 * 60 * 1000);
  }

  // Build the command with a trailing sentinel echo so completion is detectable.
  function buildCmd(userCmd, sentinel) {
    return userCmd + "; echo " + sentinel;
  }

  async function measureChunkBytes(prefix, chunks) {
    try {
      let total = 0;
      for (let i = 0; i < chunks; i++) {
        const n = String(i).padStart(2, "0");
        const url = "./containers/" + prefix + "-container" + n + ".wasm";
        const r = await fetch(url, { method: "HEAD" });
        if (!r.ok) return null;
        const len = r.headers.get("content-length");
        if (len == null) return null;
        total += parseInt(len, 10);
      }
      return total;
    } catch (e) {
      return null;
    }
  }

  // Wire up. Re-run the COI check now and after the service worker may reload.
  window.addEventListener("load", () => {
    reportCoi();
    $("run").addEventListener("click", boot);
    // ?auto=1 boots immediately on load (useful for headless screenshot capture).
    // coi-serviceworker reloads the page once on first visit to apply COOP/COEP;
    // only auto-boot once we are actually cross-origin isolated.
    const auto = new URLSearchParams(location.search).get("auto");
    if (auto && typeof crossOriginIsolated !== "undefined" && crossOriginIsolated) {
      boot();
    }
  });
})();
