// ASKK in-browser code execution worker.
//
// A lightweight classic Web Worker that runs the agent's (or the Workspace's)
// JavaScript natively in the browser — no bridge, no native runtime. The
// coordinator (src/browser_exec.rs) spawns one worker per run, posts
// {code, input}, and enforces a timeout by terminating the worker. The worker
// captures console output and the returned value and posts a structured result.

self.onmessage = (event) => {
  let message;
  try {
    message = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
  } catch (error) {
    self.postMessage(JSON.stringify({
      ok: false,
      result: null,
      stdout: "",
      stderr: "",
      error: "exec worker received an unparseable message: " + String(error),
    }));
    return;
  }

  const code = typeof message?.code === "string" ? message.code : "";
  const input = message?.input;
  const stdout = [];
  const stderr = [];
  const sandboxConsole = {
    log: (...args) => stdout.push(args.map(format).join(" ")),
    info: (...args) => stdout.push(args.map(format).join(" ")),
    debug: (...args) => stdout.push(args.map(format).join(" ")),
    warn: (...args) => stderr.push(args.map(format).join(" ")),
    error: (...args) => stderr.push(args.map(format).join(" ")),
  };

  (async () => {
    let ok = true;
    let error = "";
    let result;
    try {
      // The code runs inside an async function body, so top-level `await` and
      // `return` work. `console` and `input` are the only injected bindings.
      const runner = new Function(
        "console",
        "input",
        '"use strict";\nreturn (async () => {\n' + code + "\n})();",
      );
      result = await runner(sandboxConsole, input);
    } catch (thrown) {
      ok = false;
      error = thrown && thrown.stack ? String(thrown.stack) : String(thrown);
    }
    self.postMessage(JSON.stringify({
      ok,
      result: safeValue(result),
      stdout: stdout.join("\n"),
      stderr: stderr.join("\n"),
      error,
    }));
  })();
};

function format(value) {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

function safeValue(value) {
  if (value === undefined) {
    return null;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return String(value);
  }
}
