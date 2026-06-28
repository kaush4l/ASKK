// ASKK python-runner — classic Web Worker source.
//
// Runs CPython compiled to wasm32-wasi (assets/runtimes/python/python.wasm,
// release v3.14.5 of github.com/brettcannon/cpython-wasi-build) under the
// vendored @bjorn3/browser_wasi_shim, entirely in the browser. No COOP/COEP
// headers, no SharedArrayBuffer, no bridge.
//
// Build: `bun run build` (writes assets/python_runner_worker.js — never edit
// that bundle by hand; edit this file and rebuild).
//
// Protocol (request, posted as a JSON string or structured-clone object):
//   {
//     python_wasm?: ArrayBuffer,   // the interpreter binary, transferable; or
//     python_url?:  string,        //   fetched cache-first via Cache Storage
//     stdlib?:      ArrayBuffer,   // stored-zip stdlib (mounted, zipimported); or
//     stdlib_url?:  string,
//     mode:  "file" | "code",
//     entry?: "main.py",           // mode "file": workspace path of the script
//     code?:  "...",               // mode "code": equivalent of `python -c`
//     args?:  [string],            // extra argv after the script / -c code
//     stdin?: string,              // fed to the program as standard input
//     files?: [{ path, text } | { path, bytes: [int] }]  // workspace seed
//   }
//
// Replies (each a JSON string):
//   { phase: "ready" }                                   // assets fetched+compiled
//   { exit_code, stdout, stderr, files_out: [...] }      // run finished
//   { error: "python-runner: ..." }                      // harness failure
//
// The run is copy-in/copy-out by design (v1): `files` seed an in-memory WASI
// filesystem rooted at "/" (which is also the working directory), and files the
// program created or changed are returned in `files_out` ({ path, text } for
// UTF-8 content, { path, bytes_b64 } otherwise). The stdlib zip is mounted at
// /lib/python314.zip, which CPython's frozen zipimport reads via PYTHONHOME=/.
// "lib" is therefore a reserved name in the sandbox root and never copied out.
//
// Program output is untrusted DATA for the agent; this worker only captures and
// returns it, never interprets it. The hard timeout is enforced by the host
// terminating this worker (the run blocks this thread on purpose).

import {
  WASI,
  WASIProcExit,
  File,
  Directory,
  PreopenDirectory,
  ConsoleStdout,
  OpenFile,
} from "@bjorn3/browser_wasi_shim";

const RUNTIME_CACHE_NAME = "askk-runtimes";
const STREAM_CAP_CHARS = 60_000;
const TRUNCATION_MARKER = "\n[python-runner] output truncated at 60000 chars";
// Where CPython expects the stdlib: with PYTHONHOME=/ its default sys.path
// includes /lib/python314.zip (frozen zipimport reads stored entries, no zlib).
const STDLIB_DIR = "lib";
const STDLIB_ZIP_NAME = "python314.zip";

/** Fetch `url` cache-first through Cache Storage so the multi-MB runtime is
 * downloaded once per deploy (asset URLs are content-hashed). Falls back to a
 * plain fetch when Cache Storage is unavailable. */
async function fetchBytes(url) {
  let cache = null;
  try {
    if (typeof caches !== "undefined") {
      cache = await caches.open(RUNTIME_CACHE_NAME);
      const hit = await cache.match(url);
      if (hit) return await hit.arrayBuffer();
    }
  } catch (_) {
    cache = null; // cache lookup failure is non-fatal; fall through to network
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

/** A stdout/stderr sink that decodes UTF-8 incrementally (partial lines are
 * kept) and hard-caps the captured text so a chatty program cannot blow the
 * reply size. */
function makeStreamSink() {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const sink = {
    text: "",
    truncated: false,
    fd: null,
    finish() {
      const tail = decoder.decode(); // flush any buffered partial code point
      if (tail) this.push(tail);
      return this.truncated ? this.text + TRUNCATION_MARKER : this.text;
    },
    push(chunk) {
      if (this.truncated) return;
      this.text += chunk;
      if (this.text.length > STREAM_CAP_CHARS) {
        this.text = this.text.slice(0, STREAM_CAP_CHARS);
        this.truncated = true;
      }
    },
  };
  sink.fd = new ConsoleStdout((buffer) =>
    sink.push(decoder.decode(buffer, { stream: true })),
  );
  return sink;
}

/** Insert one seed file at `path` (e.g. "pkg/data.txt") under `root`,
 * creating intermediate Directory inodes. Rejects absolute or escaping paths. */
function seedFile(root, path, bytes) {
  const parts = path.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.length === 0 || parts.includes("..")) {
    throw new Error(`invalid workspace file path: ${path}`);
  }
  if (parts[0] === STDLIB_DIR) {
    throw new Error(
      `workspace path ${path} collides with the reserved "${STDLIB_DIR}" stdlib mount`,
    );
  }
  let dir = root;
  for (const part of parts.slice(0, -1)) {
    let next = dir.contents.get(part);
    if (!next) {
      next = new Directory(new Map());
      next.parent = dir;
      dir.contents.set(part, next);
    }
    if (!(next instanceof Directory)) {
      throw new Error(`workspace path ${path} crosses a non-directory`);
    }
    dir = next;
  }
  dir.contents.set(parts[parts.length - 1], new File(bytes));
}

/** Decode one protocol seed entry into bytes. */
function seedEntryBytes(entry) {
  if (typeof entry.text === "string") {
    return new TextEncoder().encode(entry.text);
  }
  if (Array.isArray(entry.bytes)) {
    return new Uint8Array(entry.bytes);
  }
  throw new Error(`workspace file ${entry.path} has neither text nor bytes`);
}

/** Walk the sandbox root after the run and collect files that are new or whose
 * bytes changed versus the seed snapshot. Returns protocol `files_out` entries:
 * { path, text } for UTF-8 content, { path, bytes_b64 } for binary. */
function collectChangedFiles(root, seedSnapshot) {
  const out = [];
  const strictDecoder = new TextDecoder("utf-8", { fatal: true });
  const walk = (dir, prefix) => {
    for (const [name, inode] of dir.contents.entries()) {
      const path = prefix === "" ? name : `${prefix}/${name}`;
      if (path === STDLIB_DIR && inode instanceof Directory) continue;
      if (inode instanceof Directory) {
        walk(inode, path);
        continue;
      }
      if (!(inode instanceof File)) continue;
      const before = seedSnapshot.get(path);
      const after = inode.data;
      if (before && bytesEqual(before, after)) continue;
      try {
        out.push({ path, text: strictDecoder.decode(after) });
      } catch (_) {
        out.push({ path, bytes_b64: bytesToBase64(after) });
      }
    }
  };
  walk(root, "");
  return out;
}

function bytesEqual(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function bytesToBase64(bytes) {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function reply(value) {
  self.postMessage(JSON.stringify(value));
}

async function handleRequest(msg) {
  // --- Resolve the runtime ------------------------------------------------
  const pythonBytes =
    msg.python_wasm instanceof ArrayBuffer
      ? msg.python_wasm
      : await fetchBytes(String(msg.python_url || ""));
  const stdlibBytes =
    msg.stdlib instanceof ArrayBuffer
      ? msg.stdlib
      : await fetchBytes(String(msg.stdlib_url || ""));

  // --- Build argv ----------------------------------------------------------
  const extraArgs = Array.isArray(msg.args) ? msg.args.map(String) : [];
  let argv;
  if (msg.mode === "code") {
    if (typeof msg.code !== "string" || msg.code.length === 0) {
      throw new Error('mode "code" requires a non-empty `code` string');
    }
    argv = ["python", "-c", msg.code, ...extraArgs];
  } else if (msg.mode === "file") {
    if (typeof msg.entry !== "string" || msg.entry.length === 0) {
      throw new Error('mode "file" requires a non-empty `entry` path');
    }
    argv = ["python", msg.entry, ...extraArgs];
  } else {
    throw new Error(`unknown mode: ${String(msg.mode)}`);
  }

  // --- Build the sandbox filesystem ----------------------------------------
  // Root "/" is both the workspace and the cwd; the stdlib zip is mounted at
  // /lib/python314.zip where PYTHONHOME=/ puts it on sys.path.
  const root = new Directory(new Map());
  const stdlibDir = new Directory(
    new Map([[STDLIB_ZIP_NAME, new File(new Uint8Array(stdlibBytes))]]),
  );
  stdlibDir.parent = root;
  root.contents.set(STDLIB_DIR, stdlibDir);

  const seedSnapshot = new Map();
  for (const entry of Array.isArray(msg.files) ? msg.files : []) {
    const bytes = seedEntryBytes(entry);
    seedFile(root, String(entry.path), bytes);
    const normalized = String(entry.path)
      .split("/")
      .filter((part) => part !== "" && part !== ".")
      .join("/");
    seedSnapshot.set(normalized, bytes);
  }

  const preopen = new PreopenDirectory("/", root.contents);

  const stdout = makeStreamSink();
  const stderr = makeStreamSink();
  const stdinBytes = new TextEncoder().encode(
    typeof msg.stdin === "string" ? msg.stdin : "",
  );
  const fds = [
    new OpenFile(new File(stdinBytes)), // fd 0
    stdout.fd, // fd 1
    stderr.fd, // fd 2
    preopen, // fd 3: preopened "/"
  ];
  const env = [
    "PYTHONHOME=/",
    "PYTHONUNBUFFERED=1",
    "PYTHONDONTWRITEBYTECODE=1",
  ];

  // --- Compile, signal readiness, run --------------------------------------
  const wasi = new WASI(argv, env, fds, { debug: false });
  const module = await WebAssembly.compile(pythonBytes);
  const instance = await WebAssembly.instantiate(module, {
    wasi_snapshot_preview1: wasi.wasiImport,
  });

  // From here the run blocks this worker; the host starts its run timeout when
  // it receives this message, so slow first-time downloads don't eat the budget.
  reply({ phase: "ready" });

  let exitCode = 0;
  try {
    exitCode = wasi.start(instance);
  } catch (err) {
    if (err instanceof WASIProcExit) {
      exitCode = err.code;
    } else {
      // A trap (not a normal exit): report it as an abnormal run, keeping any
      // output captured so far.
      stderr.push(`\n[python-runner] runtime trap: ${String(err)}`);
      return {
        exit_code: 134,
        stdout: stdout.finish(),
        stderr: stderr.finish(),
        files_out: collectChangedFiles(preopen.dir, seedSnapshot),
      };
    }
  }

  return {
    exit_code: exitCode,
    stdout: stdout.finish(),
    stderr: stderr.finish(),
    files_out: collectChangedFiles(preopen.dir, seedSnapshot),
  };
}

self.onmessage = async (event) => {
  let msg = event.data;
  try {
    if (typeof msg === "string") msg = JSON.parse(msg);
    const result = await handleRequest(msg);
    reply(result);
  } catch (err) {
    reply({ error: `python-runner: ${err && err.message ? err.message : String(err)}` });
  }
};
