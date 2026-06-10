// ASKK WASI runner worker — SOURCE for the committed asset
// `assets/wasi_runner_worker.js`. Rebuild with `bun install && bun run build`
// from scripts/wasi-runner/ and commit the regenerated asset.
//
// A disposable classic Web Worker that runs ONE wasm32-wasip1 binary under
// @bjorn3/browser_wasi_shim (pure JS, no COOP/COEP, gh-pages friendly) against
// an in-memory virtual filesystem. Copy-in/copy-out is the deliberate v1
// design: the host seeds /workspace from its own store, and changed/created
// files are shipped back in the reply (sync OPFS access handles only work in
// dedicated workers, and the Rust side owns the canonical store).
//
// Request (postMessage, object; wasm_bytes is an ArrayBuffer transferable):
//   {
//     wasm_bytes?: ArrayBuffer,        // the wasm32-wasip1 binary, OR
//     wasm_url?:   string,             //   a URL the worker fetches it from
//     argv?:  string[],                // argv[0] is the program name
//     env?:   { KEY: "value", ... },
//     stdin?: string,
//     files?: [{ path, text | base64 | bytes }]   // seeds /workspace
//   }
//
// Reply (postMessage, JSON string):
//   { ok, exit_code, stdout, stderr, files_out: [{ path, text | base64 }] }
//
// Everything the guest prints or writes is UNTRUSTED DATA for the host agent:
// this worker only captures and returns it, never interprets it. All failures
// are reported as a structured reply (exit_code 127 = could not run), never as
// an uncaught error, so the host always gets the same envelope back.

import {
  WASI,
  WASIProcExit,
  File,
  Directory,
  PreopenDirectory,
  ConsoleStdout,
  OpenFile,
} from "@bjorn3/browser_wasi_shim";

// Mirrors the bridge run_command clamp: a chatty guest cannot blow the
// model's context or the snapshot size.
const MAX_STREAM_CHARS = 60_000;

// --- stream capture ---------------------------------------------------------

function makeStreamCapture() {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const state = { text: "" };
  const fd = new ConsoleStdout((buffer) => {
    if (state.text.length >= MAX_STREAM_CHARS) return;
    state.text += decoder.decode(buffer, { stream: true });
    if (state.text.length > MAX_STREAM_CHARS) {
      state.text = state.text.slice(0, MAX_STREAM_CHARS);
    }
  });
  return { fd, state };
}

// --- base64 helpers (worker-side; no Buffer in the browser) -----------------

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// --- /workspace seeding and copy-out ----------------------------------------

// Normalize a host-supplied relative path; returns null for anything unsafe
// (absolute, `..`, NUL) or empty so a malformed entry is skipped, not trusted.
function normalizeRelPath(path) {
  if (typeof path !== "string" || path.includes("\u0000")) return null;
  const parts = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") return null;
    parts.push(part);
  }
  return parts.length > 0 ? parts.join("/") : null;
}

function entryBytes(entry) {
  if (typeof entry?.text === "string") return new TextEncoder().encode(entry.text);
  if (typeof entry?.base64 === "string") return base64ToBytes(entry.base64);
  if (entry?.bytes instanceof ArrayBuffer) return new Uint8Array(entry.bytes);
  if (ArrayBuffer.isView(entry?.bytes)) {
    return new Uint8Array(
      entry.bytes.buffer,
      entry.bytes.byteOffset,
      entry.bytes.byteLength,
    ).slice();
  }
  return null;
}

// Build the /workspace inode tree and remember the seeded bytes per path so
// copy-out can return only changed/created files.
function seedWorkspace(files) {
  const root = new Map();
  const seeded = new Map();
  for (const entry of Array.isArray(files) ? files : []) {
    const path = normalizeRelPath(entry?.path);
    const bytes = entryBytes(entry);
    if (path === null || bytes === null) continue;
    insertFile(root, path.split("/"), bytes);
    seeded.set(path, bytes.slice());
  }
  return { root, seeded };
}

function insertFile(rootMap, parts, bytes) {
  let map = rootMap;
  for (let i = 0; i < parts.length - 1; i++) {
    let child = map.get(parts[i]);
    if (!(child instanceof Directory)) {
      child = new Directory(new Map());
      map.set(parts[i], child);
    }
    map = child.contents;
  }
  map.set(parts[parts.length - 1], new File(bytes));
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Walk the post-run tree and collect files that are new or changed versus the
// seed. UTF-8 files travel as text; anything else as base64.
function collectChanged(dirMap, seeded, prefix, out) {
  for (const [name, inode] of dirMap.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (inode instanceof Directory) {
      collectChanged(inode.contents, seeded, path, out);
    } else if (inode instanceof File) {
      const before = seeded.get(path);
      if (before && bytesEqual(before, inode.data)) continue;
      out.push(encodeFileOut(path, inode.data));
    }
  }
}

function encodeFileOut(path, data) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    return { path, text };
  } catch {
    return { path, base64: bytesToBase64(data) };
  }
}

// --- protocol ----------------------------------------------------------------

function reply(payload) {
  self.postMessage(JSON.stringify(payload));
}

function fail(exitCode, message) {
  return {
    ok: false,
    exit_code: exitCode,
    stdout: "",
    stderr: `wasi runner: ${message}`,
    files_out: [],
  };
}

async function resolveWasmBytes(request) {
  if (request.wasm_bytes instanceof ArrayBuffer) return request.wasm_bytes;
  if (ArrayBuffer.isView(request.wasm_bytes)) {
    return request.wasm_bytes.buffer.slice(
      request.wasm_bytes.byteOffset,
      request.wasm_bytes.byteOffset + request.wasm_bytes.byteLength,
    );
  }
  if (typeof request.wasm_url === "string" && request.wasm_url !== "") {
    const response = await fetch(request.wasm_url);
    if (!response.ok) {
      throw new Error(
        `unable to fetch the wasm binary from ${request.wasm_url}: HTTP ${response.status}`,
      );
    }
    return await response.arrayBuffer();
  }
  throw new Error(
    "request must include wasm_bytes (ArrayBuffer) or wasm_url (string)",
  );
}

self.onmessage = async (event) => {
  let request = event.data;
  if (typeof request === "string") {
    try {
      request = JSON.parse(request);
    } catch (error) {
      reply(fail(127, `received an unparseable message: ${String(error)}`));
      return;
    }
  }
  if (request === null || typeof request !== "object") {
    reply(fail(127, "received a message that is not a request object"));
    return;
  }

  try {
    let wasmBytes;
    try {
      wasmBytes = await resolveWasmBytes(request);
    } catch (error) {
      reply(fail(127, error?.message ?? String(error)));
      return;
    }

    const argv =
      Array.isArray(request.argv) && request.argv.length > 0
        ? request.argv.map(String)
        : ["main.wasm"];
    const envObject =
      request.env && typeof request.env === "object" ? request.env : {};
    const env = Object.entries(envObject).map(([key, value]) => `${key}=${String(value)}`);
    const stdinBytes = new TextEncoder().encode(
      typeof request.stdin === "string" ? request.stdin : "",
    );

    const { root, seeded } = seedWorkspace(request.files);
    const workspace = new PreopenDirectory("/workspace", root);
    const stdout = makeStreamCapture();
    const stderr = makeStreamCapture();
    const fds = [new OpenFile(new File(stdinBytes)), stdout.fd, stderr.fd, workspace];
    const wasi = new WASI(argv, env, fds, { debug: false });

    let module;
    try {
      module = await WebAssembly.compile(wasmBytes);
    } catch (error) {
      reply(fail(127, `unable to compile the wasm binary: ${String(error)}`));
      return;
    }
    let instance;
    try {
      instance = await WebAssembly.instantiate(module, {
        wasi_snapshot_preview1: wasi.wasiImport,
      });
    } catch (error) {
      reply(
        fail(
          127,
          `unable to instantiate the wasm binary (is it wasm32-wasip1?): ${String(error)}`,
        ),
      );
      return;
    }

    let exitCode = 0;
    let trap = null;
    try {
      // start() runs _start and returns the exit code (it absorbs WASIProcExit);
      // the catch is defensive for traps and shim-version differences.
      exitCode = wasi.start(instance) ?? 0;
    } catch (error) {
      if (error instanceof WASIProcExit) {
        exitCode = error.code;
      } else {
        exitCode = 134;
        trap = `runtime trap: ${String(error)}`;
      }
    }

    const filesOut = [];
    collectChanged(workspace.dir.contents, seeded, "", filesOut);

    let stderrText = stderr.state.text;
    if (trap !== null) {
      stderrText = `${stderrText}${stderrText === "" ? "" : "\n"}${trap}`.slice(
        0,
        MAX_STREAM_CHARS,
      );
    }
    reply({
      ok: exitCode === 0,
      exit_code: exitCode,
      stdout: stdout.state.text,
      stderr: stderrText,
      files_out: filesOut,
    });
  } catch (error) {
    reply(fail(127, `internal error: ${String(error)}`));
  }
};
