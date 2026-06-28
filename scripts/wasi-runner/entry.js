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
//     env?:   { KEY: "value", ... },   // legacy object form, OR
//     env?:   [{ key, value }],        //   descriptor pair form (merged)
//     stdin?: string,
//     files?: [{ path, text | base64 | bytes }],  // seeds /workspace
//
//     // --- BinaryEnv descriptor (a hosted binary; all optional) -------------
//     name?:           string,         // descriptor name (diagnostics only)
//     mounts?: [{ at, mount_url }],    // extra files mounted before the run
//                                      //   (e.g. a stdlib zip at lib/x.zip);
//                                      //   the `at` top segment is reserved
//                                      //   and never copied back out
//     ready_protocol?: boolean,        // post {phase:"ready"} before running
//     cache_key?:      string | null,  // Cache-Storage name → cache-first fetch
//   }
//
// Reply (postMessage, JSON string; a ready reply precedes the result when the
// descriptor sets ready_protocol):
//   { phase: "ready" }                                       // assets ready
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

// --- cache-first fetch (hosted binaries + mounted assets) -------------------

// Fetch `url` as an ArrayBuffer. When `cacheKey` is set, go through Cache
// Storage so a hosted binary (and its mounted assets, e.g. a multi-MB stdlib
// zip) downloads once per deploy — asset URLs are content-hashed, so a cache
// hit is always the right bytes. Cache trouble is non-fatal: we fall through to
// the network. Mirrors the python-runner's `askk-runtimes` caching.
async function fetchBytes(url, cacheKey) {
  let cache = null;
  if (cacheKey) {
    try {
      if (typeof caches !== "undefined") {
        cache = await caches.open(cacheKey);
        const hit = await cache.match(url);
        if (hit) return await hit.arrayBuffer();
      }
    } catch (_) {
      cache = null; // lookup failure is non-fatal
    }
  }
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`fetching ${url} failed: HTTP ${resp.status}`);
  }
  if (cache) {
    try {
      await cache.put(url, resp.clone());
    } catch (_) {
      // Quota or opaque-response trouble: caching is best-effort.
    }
  }
  return await resp.arrayBuffer();
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
// copy-out can return only changed/created files. `mounts` are descriptor files
// (already fetched to bytes) laid down before user seed files; their top-level
// segment is reserved (`reserved` Set) and excluded from copy-out.
function seedWorkspace(files, mounts) {
  const root = new Map();
  const seeded = new Map();
  const reserved = new Set();

  for (const mount of Array.isArray(mounts) ? mounts : []) {
    const path = normalizeRelPath(mount?.at);
    const bytes = mount?.bytes;
    if (path === null || !(bytes instanceof Uint8Array)) continue;
    insertFile(root, path.split("/"), bytes);
    reserved.add(path.split("/")[0]);
  }

  for (const entry of Array.isArray(files) ? files : []) {
    const path = normalizeRelPath(entry?.path);
    const bytes = entryBytes(entry);
    if (path === null || bytes === null) continue;
    // Never let a user file overwrite a reserved mount segment.
    if (reserved.has(path.split("/")[0])) continue;
    insertFile(root, path.split("/"), bytes);
    seeded.set(path, bytes.slice());
  }
  return { root, seeded, reserved };
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
// seed. UTF-8 files travel as text; anything else as base64. Reserved top-level
// segments (descriptor mounts, e.g. a stdlib dir) are skipped: they are the
// guest's environment, not workspace output.
function collectChanged(dirMap, seeded, prefix, out, reserved) {
  for (const [name, inode] of dirMap.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (prefix === "" && reserved && reserved.has(name)) continue;
    if (inode instanceof Directory) {
      collectChanged(inode.contents, seeded, path, out, reserved);
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

async function resolveWasmBytes(request, cacheKey) {
  if (request.wasm_bytes instanceof ArrayBuffer) return request.wasm_bytes;
  if (ArrayBuffer.isView(request.wasm_bytes)) {
    return request.wasm_bytes.buffer.slice(
      request.wasm_bytes.byteOffset,
      request.wasm_bytes.byteOffset + request.wasm_bytes.byteLength,
    );
  }
  if (typeof request.wasm_url === "string" && request.wasm_url !== "") {
    // Cache-first when the descriptor provides a cache_key (hosted binary);
    // otherwise a plain network fetch (a one-off `.wasm` URL).
    return await fetchBytes(request.wasm_url, cacheKey);
  }
  throw new Error(
    "request must include wasm_bytes (ArrayBuffer) or wasm_url (string)",
  );
}

// Fetch each descriptor mount's bytes (cache-first via the same cache_key) so
// the workspace can be seeded with them before the run. Inline `bytes` are
// honored too, for hosts that ship mount bytes directly.
async function resolveMounts(request, cacheKey) {
  const out = [];
  for (const mount of Array.isArray(request.mounts) ? request.mounts : []) {
    if (typeof mount?.at !== "string") continue;
    let bytes = null;
    if (typeof mount.mount_url === "string" && mount.mount_url !== "") {
      bytes = new Uint8Array(await fetchBytes(mount.mount_url, cacheKey));
    } else {
      const inline = entryBytes(mount);
      if (inline) bytes = inline;
    }
    if (bytes) out.push({ at: mount.at, bytes });
  }
  return out;
}

// Build the WASI env array from both the legacy object form ({ KEY: "value" })
// and the descriptor pair form ([{ key, value }]); descriptor pairs win on a
// key clash (they encode the binary's required environment).
function buildEnv(request) {
  const map = new Map();
  if (request.env && typeof request.env === "object" && !Array.isArray(request.env)) {
    for (const [key, value] of Object.entries(request.env)) {
      map.set(String(key), String(value));
    }
  }
  if (Array.isArray(request.env)) {
    for (const pair of request.env) {
      if (pair && typeof pair.key === "string") {
        map.set(pair.key, String(pair.value ?? ""));
      }
    }
  }
  return [...map.entries()].map(([key, value]) => `${key}=${value}`);
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
    // A descriptor cache_key turns on cache-first fetching for the wasm and its
    // mounted assets (download once per deploy); absent → plain fetch.
    const cacheKey =
      typeof request.cache_key === "string" && request.cache_key !== ""
        ? request.cache_key
        : null;

    let wasmBytes;
    let mounts;
    try {
      wasmBytes = await resolveWasmBytes(request, cacheKey);
      mounts = await resolveMounts(request, cacheKey);
    } catch (error) {
      reply(fail(127, error?.message ?? String(error)));
      return;
    }

    const argv =
      Array.isArray(request.argv) && request.argv.length > 0
        ? request.argv.map(String)
        : ["main.wasm"];
    const env = buildEnv(request);
    const stdinBytes = new TextEncoder().encode(
      typeof request.stdin === "string" ? request.stdin : "",
    );

    const { root, seeded, reserved } = seedWorkspace(request.files, mounts);
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

    // Ready protocol: for a hosted binary that opts in, signal that the
    // (possibly slow) fetch + compile is done before the run blocks this worker,
    // so the host starts the run timeout only now.
    if (request.ready_protocol === true) {
      reply({ phase: "ready" });
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
    collectChanged(workspace.dir.contents, seeded, "", filesOut, reserved);

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
