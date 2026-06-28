// Headless e2e harness for the committed `assets/wasi_runner_worker.js` bundle.
//
// Runs under Bun (which provides Worker + WebAssembly; Cache Storage is absent,
// which the worker tolerates by falling through to a plain fetch). It drives TWO
// guests through the SAME worker to prove the BinaryEnv generalization:
//
//   1. guest.wasm  — the original protocol guest (argv/env/stdin/seed/copy-out),
//      posted as a bare wasm_bytes run (the implicit "raw binary" descriptor).
//   2. wc.wasm     — the 2nd hosted binary, posted with descriptor message
//      fields (name/cache_key/ready_protocol=false) and a seeded file it counts,
//      proving a hosted binary runs end to end through the descriptor path.
//
// Usage (from repo root):  bun scripts/wasi-runner/test/run-headless.mjs
// Exits 0 on success, non-zero (with a diff) on any mismatch.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFile } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const workerUrl = resolve(repoRoot, "assets/wasi_runner_worker.js");

function runOnce(message, transfer) {
  return new Promise((resolvePromise, reject) => {
    const worker = new Worker(workerUrl);
    const replies = [];
    worker.onmessage = (event) => {
      const reply = JSON.parse(event.data);
      // The ready phase (if any) precedes the result; keep waiting for the result.
      if (reply.phase === "ready") {
        replies.push(reply);
        return;
      }
      worker.terminate();
      resolvePromise({ result: reply, sawReady: replies.some((r) => r.phase === "ready") });
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(`worker error: ${event.message ?? String(event)}`));
    };
    worker.postMessage(message, transfer ?? []);
  });
}

function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    console.log(`        expected: ${JSON.stringify(expected)}`);
    console.log(`        actual:   ${JSON.stringify(actual)}`);
  }
  return ok;
}

let allOk = true;

// --- 1. raw guest.wasm run (existing protocol, must still work) -------------
{
  const guestBytes = await readFile(resolve(here, "guest.wasm"));
  const buffer = guestBytes.buffer.slice(
    guestBytes.byteOffset,
    guestBytes.byteOffset + guestBytes.byteLength,
  );
  const { result } = await runOnce(
    {
      wasm_bytes: buffer,
      argv: ["guest.wasm", "--greet", "askk", "harness"],
      env: { DEMO_KEY: "from-harness" },
      stdin: "hello stdin\n",
      files: [{ path: "input.txt", text: "seed-from-harness" }],
    },
    [buffer],
  );
  allOk = check("guest.wasm exit_code", result.exit_code, 0) && allOk;
  allOk = check("guest.wasm ok", result.ok, true) && allOk;
  const roundtrip = (result.files_out || []).find((f) => f.path === "out/result.txt");
  allOk =
    check(
      "guest.wasm copy-out present",
      Boolean(roundtrip && roundtrip.text),
      true,
    ) && allOk;
  if (!result.stdout.includes("guest read input.txt: seed-from-harness")) {
    console.log("FAIL  guest.wasm read seeded input");
    console.log(`        stdout: ${JSON.stringify(result.stdout)}`);
    allOk = false;
  } else {
    console.log("PASS  guest.wasm read seeded input");
  }
}

// --- 2. hosted `wc` binary via the descriptor path --------------------------
{
  const wcBytes = await readFile(resolve(repoRoot, "assets/runtimes/coreutils/wc.wasm"));
  const buffer = wcBytes.buffer.slice(
    wcBytes.byteOffset,
    wcBytes.byteOffset + wcBytes.byteLength,
  );
  // A file with 3 lines, 6 words, 30 bytes:  "one two\nthree four\nfive six\n"
  const seed = "one two\nthree four\nfive six\n";
  const { result, sawReady } = await runOnce(
    {
      // descriptor message fields (what build_message_base merges in):
      name: "wc",
      ready_protocol: false,
      cache_key: "askk-runtimes",
      mounts: [],
      // the wasm itself (host attaches bytes; in the app it is a wasm_url):
      wasm_bytes: buffer,
      argv: ["wc", "notes.txt"],
      env: [], // descriptor pair form (empty)
      stdin: "",
      files: [{ path: "notes.txt", text: seed }],
    },
    [buffer],
  );
  allOk = check("wc exit_code", result.exit_code, 0) && allOk;
  allOk = check("wc ok", result.ok, true) && allOk;
  allOk = check("wc no spurious ready phase", sawReady, false) && allOk;
  const lines = 3;
  const words = 6;
  const bytes = new TextEncoder().encode(seed).length; // 28
  const expected = `${lines} ${words} ${bytes} notes.txt`;
  const firstLine = (result.stdout || "").trim().split("\n")[0];
  allOk = check("wc counts (lines words bytes path)", firstLine, expected) && allOk;
}

if (!allOk) {
  console.error("\nHEADLESS HARNESS FAILED");
  process.exit(1);
}
console.log("\nALL HEADLESS CHECKS PASSED");
