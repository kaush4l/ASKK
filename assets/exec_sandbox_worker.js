// ASKK in-browser sandbox-exec worker (SEAM STUB).
//
// This is the disposable Web Worker that a real in-browser execution substrate
// (WASI, container2wasm, …) will eventually own. It speaks the bridge
// `run_command` JSON contract so the chosen backend can be dropped in here
// without changing the Rust seam (src/engine/exec_capability.rs):
//
//   request : { command, cwd?, timeout_ms? }
//   response: { ok, stdout, stderr, exit_code }
//
// Today there is no substrate wired in, so the worker echoes back a clear
// "not yet wired" response (ok:false, exit_code:127) instead of running the
// binary. The point is that the full path — loop -> tool -> seam -> worker —
// exists and round-trips a structured result.

self.onmessage = (event) => {
  let request;
  try {
    request = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
  } catch (error) {
    self.postMessage(JSON.stringify({
      ok: false,
      stdout: "",
      stderr: "sandbox exec worker received an unparseable message: " + String(error),
      exit_code: 127,
    }));
    return;
  }

  const command = typeof request?.command === "string" ? request.command : "";
  self.postMessage(JSON.stringify({
    ok: false,
    stdout: "",
    stderr:
      "in-browser sandbox executor is not yet wired to a real substrate; " +
      "no binary was run for: " + command,
    exit_code: 127,
  }));
};
