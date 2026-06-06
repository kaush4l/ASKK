const wasmModulePath = "/wasm/askk.js";
const wasmModulePromise = import(wasmModulePath);
const ready = waitForWasm();

self.postMessage(JSON.stringify({ Ready: { worker_id: "agent-worker-1" } }));

self.onmessage = async (event) => {
  const payload = typeof event.data === "string" ? event.data : JSON.stringify(event.data);
  try {
    const wasmModule = await ready;
    const result = await wasmModule.askk_worker_handle(payload);
    self.postMessage(result);
  } catch (error) {
    self.postMessage(JSON.stringify(errorEvent(payload, error)));
  }
};

async function waitForWasm() {
  const wasmModule = await wasmModulePromise;
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (globalThis.__dx_mainWasm && typeof wasmModule.askk_worker_handle === "function") {
      return wasmModule;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for ASKK WASM worker exports.");
}

function errorEvent(payload, error) {
  let run_id = "unknown-run";
  let worker_id = "agent-worker-1";
  try {
    const parsed = JSON.parse(payload);
    const command = parsed.Dispatch ?? parsed.Cancel;
    run_id = command?.run_id ?? run_id;
    worker_id = command?.worker_id ?? worker_id;
  } catch (_) {
    // Keep the fallback IDs above.
  }
  return {
    Error: {
      run_id,
      worker_id,
      message: error?.message ?? String(error),
    },
  };
}
