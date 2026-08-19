// container2wasm as a workspace: BINDING, not logic (I5). Every decision —
// what to run, where, what to do with the result — is in `core::workspace`.
//
// c2w has no `run(argv)` — it has a PTY with a container
// behind it. So `/bin/sh` boots once and every command is written into it
// between two random sentinels; `c2w.rs` lists the sharp edges that cost real
// time to find.
//
// OVER 200 LINES, AND JUSTIFIED (I12, PROMPT §13 "split, or justify"). It cannot
// be split. Everything below shares ONE piece of module state — the PTY's
// keyboard, the output buffer, the command queue, and now the in-flight and
// stopping flags — and wasm-bindgen copies only the file named in
// `module = "…"` into `snippets/`, so a sibling this imported would not be
// emitted and the page would 404 at boot. Two-thirds of the length is the
// argued comments; the code is ~80 lines.

let state = "idle", phase = "", reason = "", booting = null;
let queue = Promise.resolve();
// A command is in flight (what makes the pill say busy, and what tells a stop
// there is anything to stop), and someone pressed Stop on it.
let inflight = false, stopping = false;
let type_in = null;  // the PTY's keyboard: master.activate() hands it to us
let buf = "";        // everything the guest has written since the last read
let wake = null;     // a reader parked on the next byte

// How long the shell gets to appear, and how long one command gets before the
// watchdog interrupts it. The guest is ONE permanently interpreted thread —
// `ls -la /usr/bin | wc -l` is 2.3s measured — so a slow command is not a stuck
// one: three minutes is a wedge threshold, not a performance budget. PROBE_MS is
// one boot probe, retried until BOOT_MS is spent; RESYNC_MS is how long an
// interrupted shell gets to prove it is still a shell.
const BOOT_MS = 180000, RUN_MS = 180000, PROBE_MS = 20000, RESYNC_MS = 15000;

function load(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error("could not load " + src));
    document.head.appendChild(el);
  });
}

// The "terminal" the PTY master is activated against. There is no xterm here
// and no DOM: `write` is the guest's stdout and `onData` is its keyboard, and
// those two are the entire terminal contract this needs to satisfy.
const decoder = new TextDecoder();
const sink = {
  // `data` IS NOT A STRING. xterm-pty hands the terminal what xterm accepts —
  // string OR bytes — and this PTY sends bytes, so `buf += data` appended
  // "35,66,115,…" and no sentinel ever matched. Decoded, streaming, because a
  // multi-byte character can be split across two writes.
  write(data, cb) {
    buf += typeof data === "string" ? data : decoder.decode(new Uint8Array(data), { stream: true });
    if (wake) { const w = wake; wake = null; w(); }
    if (cb) cb();
  },
  onData(fn) { type_in = fn; return { dispose() {} }; },
  onBinary() { return { dispose() {} }; },
  onResize() { return { dispose() {} }; },
};

async function bootOnce(rel) {
  if (typeof document === "undefined")
    throw new Error("the workspace runs in the page, not in an agent's Worker");
  // ABSOLUTE, resolved once. The two Workers resolve what they are handed
  // against THEIR OWN url, so page-relative "c2w/imagemounter.wasm.gzip" became
  // /c2w/dist/c2w/imagemounter.wasm.gzip — a 404 that reads as a boot stuck on
  // "mounting the image" for ever. `document.baseURI` is trunk's `<base>`, so
  // this is right under the /ASKK/ subpath (publish.sh gates on that).
  const base = new URL(rel, document.baseURI).href;
  if (!self.crossOriginIsolated)
    throw new Error("this page is not cross-origin isolated, so SharedArrayBuffer is unavailable");
  phase = "loading the engine";
  if (!self.openpty) await load(base + "vendor/xterm-pty.js");
  if (!self.RunContainer) await load(base + "dist/runcontainer.js");
  const { master, slave } = openpty();
  // Raw mode on the JS-side line discipline: it must not echo, canonicalise
  // or translate anything, because what travels through it is a protocol.
  const t = slave.ioctl("TCGETS");
  t.iflag &= ~(ISTRIP | INLCR | IGNCR | ICRNL | IXON);
  t.oflag &= ~OPOST;
  t.lflag &= ~(ECHO | ECHONL | ICANON | ISIG | IEXTEN);
  slave.ioctl("TCSETS", new Termios(t.iflag, t.oflag, t.cflag, t.lflag, t.cc));
  master.activate(sink);
  phase = "mounting the image";
  const worker = new Worker(base + "worker.js");
  const info = await RunContainer.createContainerWASI(
    base + "out.wasm.gzip", base + "img",
    base + "dist/stack-worker.js", base + "imagemounter.wasm.gzip",
  );
  worker.postMessage({ type: "init", info, args: ["/bin/sh"] });
  new TtyServer(slave).start(worker);
  phase = "booting Linux";
  // The guest echoes what it is typed and prints a prompt, and both would land
  // in every capture; `set +m` keeps job control's "[1]+ Terminated" notices out
  // of unrelated commands' output. RETRIED, not awaited once: the first bytes go
  // into a PTY whose far end may not have reached `/bin/sh`, and input written
  // before then is gone rather than queued.
  const setup = "set +m; stty -echo 2>/dev/null; PS1=''";
  for (let spent = 0; spent < BOOT_MS; spent += PROBE_MS) {
    if (await run(setup, PROBE_MS)) return;
  }
  throw new Error("the container did not reach a shell in " + BOOT_MS / 1000 + "s");
}

export function c2w_boot(base) {
  if (!booting) {
    state = "booting"; phase = "starting"; reason = "";
    booting = bootOnce(base).then(
      () => { state = "ready"; phase = ""; },
      (e) => {
        // Retryable: the next command boots again, so a boot
        // that raced the service worker's isolation reload recovers without
        // a page reload.
        booting = null; state = "error"; reason = (e && e.message) || String(e);
        throw e;
      },
    );
  }
  return booting;
}

export function c2w_state() {
  if (state === "error") return "error:" + reason;
  if (state === "booting") return "booting:" + phase;
  // `busy` OUTRANKS `ready` (R11-1a): readiness is about the machine, and the
  // question a person with a wedged command is asking is about the command.
  if (state === "ready" && inflight) return "busy";
  return state;
}

// STOP: a real interrupt (R11-1b, and `c2w.rs` on why this engine can). The
// wait gives up on the flag, because the Ctrl-C also kills the trailing
// sentinel that would have closed the call.
export function c2w_stop() {
  if (!inflight) return false;
  stopping = true;
  type_in("\x03");
  return true;
}

function id() { return Math.random().toString(36).slice(2, 10); }

// Wait for `re` in the guest's output, consuming everything up to and
// including the match. Returns null on timeout — or, when `abortable`, as soon
// as someone presses Stop — with `buf` left intact. Only a COMMAND's wait is
// abortable: the boot probe and the resync PROVE the shell is alive, and a stop
// must not make either of them lie.
async function until(re, ms, abortable) {
  const deadline = Date.now() + ms;
  for (;;) {
    if (abortable && stopping) return null;
    const m = buf.match(re);
    if (m) {
      const text = buf.slice(0, m.index);
      buf = buf.slice(m.index + m[0].length);
      return { text, m };
    }
    const left = deadline - Date.now();
    if (left <= 0) return null;
    await new Promise((r) => { wake = r; setTimeout(r, Math.min(left, 50)); });
  }
}

// One command, sentinel to sentinel. Returns `{status, output}` or null if it
// did not finish in `ms` — the caller owns the recovery, because the Ctrl-C
// that unwedges the shell also kills the trailing `printf` that would have
// closed this call.
async function run(command, ms, abortable) {
  const n = id();
  buf = "";
  // NOT ANCHORED, and this is the one that deadlocks if you get it wrong:
  // `printf foo` writes no trailing newline, so the end marker arrives glued
  // to the output as `foo#Exxxx#0` and a line-anchored pattern never matches.
  const end = new RegExp("#E" + n + "#(\\d+)");
  type_in("printf '%s\\n' '#B" + n + "#'; " + command + "\nprintf '%s%s\\n' '#E" + n + "#' \"$?\"\n");
  const hit = await until(end, ms, abortable);
  if (hit === null) return null;
  const begun = hit.text.indexOf("#B" + n + "#");
  const raw = begun < 0 ? hit.text : hit.text.slice(begun + n.length + 3);
  // The PTY is a terminal: escape sequences and CRLF belong to a screen, not
  // to a captured result. `stty -onlcr` does NOT stick in this guest, so every
  // capture is CRLF and the translation is not optional. The first line break
  // is the begin marker's own and is not the command's output.
  const output = raw
    .replace(/^\r?\n/, "")
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\r\n/g, "\n");
  return { status: parseInt(hit.m[1], 10) | 0, output };
}

// The watchdog's second half: interrupt, then prove the shell came back.
async function recover() {
  type_in("\x03");
  const n = id();
  buf = "";
  type_in("\nprintf '%s\\n' '#R" + n + "#'\n");
  const back = await until(new RegExp("#R" + n + "#"), RESYNC_MS);
  if (back === null) {
    state = "error";
    reason = "the shell did not answer after an interrupt; reload the page";
  }
  return back !== null;
}

// One command at a time. Two commands writing sentinels into one PTY would
// interleave, and there is exactly one PTY: real concurrency in this guest
// comes from backgrounding a job, not from a second shell.
export function c2w_exec(base, command) {
  const job = queue.then(async () => {
    await c2w_boot(base);
    if (state !== "ready") throw new Error(reason || "the workspace is not ready");
    stopping = false;
    inflight = true;
    let done, stopped;
    try {
      done = await run(command, RUN_MS, true);
    } finally {
      stopped = stopping;
      stopping = false;
      inflight = false;
    }
    if (done !== null) return JSON.stringify(done);
    // WHICH of the two endings this was. Both interrupt and both resync; a
    // person who pressed Stop should not be told about a timeout they did not
    // reach.
    const alive = await recover();
    throw new Error(
      (stopped
        ? "You stopped it, and this Linux really interrupted the command"
        : "no answer in " + RUN_MS / 1000 + "s, so the command was interrupted") +
      (alive ? "; the shell recovered" : "; the shell did not recover"),
    );
  });
  queue = job.catch(() => {});
  return job;
}
