// Fast-lane JS eval (custom JS tool, ADR-019/ADR-021): run a short snippet in
// an isolated Web Worker — milliseconds, the VM never sees it. The Worker is
// the sandbox (no DOM, no app state; fetch/WebSocket shadowed) and
// worker.terminate() is the only real timeout browser JS allows.
// ponytail: per-call Worker spawn (~1-5ms); persistent tool-host worker if
// spawn cost ever matters.
window.askkTools = window.askkTools || {};
window.askkTools["js_eval"] = {
  description:
    "Run a short JavaScript snippet in an isolated Web Worker and return its " +
    "console output and completion value. Milliseconds — ALWAYS prefer this " +
    "over `shell` for JavaScript (the VM has no JS runtime). No DOM, no " +
    "network, no state kept between calls. Use console.log for output; the " +
    "last expression's value is returned; `await` works (wrapped async).",
  inputSchema: {
    type: "object",
    properties: {
      code: { type: "string", description: "The JavaScript to run." },
      timeout_ms: {
        type: "number",
        description: "Wall-clock cap in milliseconds (default 2000).",
      },
    },
    required: ["code"],
  },
  async call(args) {
    const code = args && args.code;
    if (!code) return "js_eval: missing 'code'";
    const timeoutMs = (args && args.timeout_ms) || 2000;
    const body = `
      self.fetch = undefined; self.XMLHttpRequest = undefined;
      self.WebSocket = undefined; self.importScripts = undefined;
      const logs = [];
      const fmt = (a) => a.map((x) => {
        try { return typeof x === "string" ? x : JSON.stringify(x); }
        catch { return String(x); }
      }).join(" ");
      console.log = console.info = console.warn = console.error =
        (...a) => logs.push(fmt(a));
      self.onmessage = async (e) => {
        try {
          let result = /\\bawait\\b/.test(e.data)
            ? (0, eval)("(async () => {" + e.data + "})()")
            : (0, eval)(e.data);
          if (result instanceof Promise) result = await result;
          self.postMessage({
            logs,
            result: result === undefined ? "undefined" : fmt([result]),
          });
        } catch (err) {
          self.postMessage({ logs, error: String(err) });
        }
      };
    `;
    const url = URL.createObjectURL(new Blob([body], { type: "text/javascript" }));
    const worker = new Worker(url);
    try {
      const out = await new Promise((resolve) => {
        const timer = setTimeout(
          () => resolve({ logs: [], error: `timed out after ${timeoutMs}ms` }),
          timeoutMs
        );
        worker.onmessage = (e) => { clearTimeout(timer); resolve(e.data); };
        worker.onerror = (e) => {
          clearTimeout(timer);
          resolve({ logs: [], error: String((e && e.message) || e) });
        };
        worker.postMessage(String(code));
      });
      const logs = (out.logs || []).join("\n");
      const tail = out.error ? `error: ${out.error}` : `result: ${out.result}`;
      return ((logs ? `logs:\n${logs}\n` : "") + tail).slice(0, 4000);
    } finally {
      worker.terminate();
      URL.revokeObjectURL(url);
    }
  },
};
