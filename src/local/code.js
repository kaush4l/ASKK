// The tab's code sandbox (see code.rs).
//
// page ── postMessage ──► hidden iframe (sandbox="allow-scripts": an opaque origin, so no
//                          access to this page's storage, cookies or DOM; its CSP allows the
//                          network only to the Python runtime's CDN)
//                            └─► worker (runs the code; killed and replaced on a timeout)
//
// One run at a time: runs queue here. The worker (and a loaded Python) is kept between runs;
// globals a run sets are still there for the next one until a timeout replaces the worker.

const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
const CDN = "https://cdn.jsdelivr.net";
// Loading Python the first time is a download; it gets its own, longer limit.
const LOAD_MS = 90000;

const WORKER = `
let py = null;
const show = v => {
  if (typeof v === "string") return v;
  try { const s = JSON.stringify(v); return s === undefined ? String(v) : s; } catch (_) { return String(v); }
};
onmessage = async ev => {
  const { language, code } = ev.data;
  const out = [];
  try {
    let r;
    if (language === "python") {
      if (!py) {
        importScripts("${PYODIDE}pyodide.js");
        py = await loadPyodide({ indexURL: "${PYODIDE}" });
      }
      py.setStdout({ batched: s => out.push(s) });
      py.setStderr({ batched: s => out.push(s) });
      postMessage({ started: true });
      r = await py.runPythonAsync(code);
      if (r && typeof r.toJs === "function") r = r.toJs({ dict_converter: Object.fromEntries });
    } else if (language === "js") {
      console.log = console.info = console.warn = console.error = (...a) => out.push(a.map(show).join(" "));
      postMessage({ started: true });
      r = await (0, eval)(code);
    } else {
      throw new Error("unknown language '" + language + "' (js or python)");
    }
    postMessage({ ok: true, result: r === undefined || r === null ? null : show(r), stdout: out.join("\\n") });
  } catch (e) {
    postMessage({ ok: false, error: String((e && e.message) || e), stdout: out.join("\\n") });
  }
};
`;

const FRAME = `<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: ${CDN}; worker-src blob:; connect-src ${CDN}">
<script>
const SOURCE = ${JSON.stringify(WORKER)};
let worker = null;
function fresh() {
  if (worker) worker.terminate();
  worker = new Worker(URL.createObjectURL(new Blob([SOURCE], { type: "text/javascript" })));
}
addEventListener("message", ev => {
  const { id, language, code, timeout } = ev.data;
  if (!worker) fresh();
  let timer = setTimeout(() => stop("the runtime did not load in ${LOAD_MS} ms"), ${LOAD_MS});
  function stop(error) {
    fresh();
    parent.postMessage({ id, ok: false, error, stdout: "" }, "*");
  }
  worker.onmessage = m => {
    clearTimeout(timer);
    if (m.data.started) {
      timer = setTimeout(() => stop("timed out after " + timeout + " ms (the run was stopped)"), timeout);
      return;
    }
    parent.postMessage(Object.assign({ id }, m.data), "*");
  };
  worker.onerror = e => {
    clearTimeout(timer);
    stop(String(e.message || "the worker failed"));
  };
  worker.postMessage({ language, code });
});
parent.postMessage({ ready: true }, "*");
</` + `script>`;

let frame = null;
let ready = null;
let next = 0;
let queue = Promise.resolve();
const waiting = new Map();

function sandbox() {
  if (ready) return ready;
  ready = new Promise(resolve => {
    frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.style.display = "none";
    frame.srcdoc = FRAME;
    addEventListener("message", ev => {
      // Only the sandbox frame is listened to.
      if (ev.source !== frame.contentWindow) return;
      if (ev.data.ready) return resolve();
      const done = waiting.get(ev.data.id);
      if (done) {
        waiting.delete(ev.data.id);
        done(ev.data);
      }
    });
    document.body.appendChild(frame);
  });
  return ready;
}

async function once(language, code, timeout) {
  await sandbox();
  const id = ++next;
  const reply = await new Promise(resolve => {
    waiting.set(id, resolve);
    frame.contentWindow.postMessage({ id, language, code, timeout }, "*");
  });
  return JSON.stringify(reply);
}

/// Run `code`; resolves to JSON text: {ok, result, stdout} or {ok: false, error, stdout}.
export function run_code(language, code, timeout) {
  const job = queue.then(() => once(language, code, timeout));
  queue = job.catch(() => {});
  return job;
}
