// CheerpX as a workspace: BINDING, not logic (I5). Every decision — what to
// run, where, what to do with the result — is in `core::workspace`.
//
// It is the `await` sequence from WebVM's own `WebVM.svelte`, which has no Rust
// equivalent because CheerpX is a JS API; `cheerpx.rs` carries the licence note
// and the sharp edges. A FILE, not an `inline_js` string, for the reason c2w's
// is one: a stop needs module state and a console writer, and neither is
// legible spelled inside a Rust literal.
let linux = null, booting = null, queue = Promise.resolve(), out = [];
// The console's KEYBOARD. `setCustomConsole` returns `(keyCode) => void` — the
// documented and only way to put bytes into this guest, and the one WebVM's own
// terminal and its own AI agent both use (there is no `cx.write`, no stdin
// option on `run`, and no way to cancel the promise `run` returns). It is what
// makes a Ctrl-C possible at all here.
let send = null;
// The command in flight, as the two things a stop needs: the way to end THIS
// page's wait, and whether there is a wait to end.
let giveup = null;
// STOPPED WAITING IS NOT FREE (R12-1). `cx_stop` used to clear `giveup` and
// nothing else, so the pill went straight back to a green `ready` while the
// abandoned command still owned the one console — and the next command sat
// behind it reading `running for 230s…` as though `echo` were slow. CheerpX
// can only abandon (see `interrupt`), so the honest state is its own: the
// command is still in there, and the workspace takes the next one when it ends.
let occupied = false;
// What the page can say about the workspace without waiting for it. The boot
// is a promise nobody may block on, so its outcome has to be readable as a
// value: idle → booting → ready, or error with the reason attached.
let state = "idle", reason = "";

function load(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error("could not load the CheerpX engine from " + src));
    document.head.appendChild(el);
  });
}

async function bootOnce(engine, disk, cache) {
  if (typeof document === "undefined")
    throw new Error("the workspace runs in the page, not in an agent's Worker");
  if (!self.crossOriginIsolated)
    throw new Error("this page is not cross-origin isolated, so SharedArrayBuffer is unavailable");
  if (!self.CheerpX) await load(engine);
  const base = await CheerpX.CloudDevice.create(disk);
  const cached = await CheerpX.IDBDevice.create(cache);
  const overlay = await CheerpX.OverlayDevice.create(base, cached);
  const cx = await CheerpX.Linux.create({ mounts: [
    { type: "ext2", dev: overlay, path: "/" },
    { type: "devs", path: "/dev" },
    { type: "devpts", path: "/dev/pts" },
    { type: "proc", path: "/proc" },
    { type: "sys", path: "/sys" },
  ]});
  const decoder = new TextDecoder();
  send = cx.setCustomConsole((data) => {
    out.push(typeof data === "number" ? String.fromCharCode(data) : decoder.decode(data, { stream: true }));
  }, 120, 40);
  linux = cx;
}

export function cx_boot(engine, disk, cache) {
  if (!booting) {
    state = "booting"; reason = "";
    booting = bootOnce(engine, disk, cache).then(
      () => { state = "ready"; },
      (e) => {
        // A failed boot is retryable: the next command tries again, which is
        // what makes a boot that raced the service worker's isolation reload
        // recoverable without a page reload.
        booting = null; state = "error"; reason = (e && e.message) || String(e);
        throw e;
      },
    );
  }
  return booting;
}

// `busy` OUTRANKS `ready` (R11-1a). The header pill read a green `ready` for
// seven minutes with one command wedged, because readiness is about the machine
// and the question a person is asking is about the command.
export function cx_state() {
  if (state === "error") return "error:" + reason;
  if (state === "ready" && giveup) return "busy";
  if (state === "ready" && occupied) return "occupied";
  return state;
}

// One command at a time: a second cx.run while the first is live would
// interleave two commands' output in one console — and WebVM's own agent avoids
// concurrent `run` for the same reason.
//
// THE QUEUE HAS TO MOVE WHEN THE COMMAND IS ASKED FOR, NOT WHEN IT STARTS
// (R18-P1-6). `queue = real` lived inside the `.then` below, so two calls made
// in the SAME TICK both chained on the same already-settled `queue`, both
// callbacks ran in one microtask batch, and the second `out = []` wiped the
// first command's console before either `linux.run` had returned. Two processes
// then wrote into one buffer. That is not a theory: the Files pane, the
// artifacts shelf and the Processes pane all list on the same tick, and the
// pane's own `list_files .` came back `ok` holding `ls: artifacts: No such file
// or directory` — and, when the wipe won the race instead, came back `ok` and
// EMPTY, which the pane reported as "Nothing was in the workspace when this
// listing ran." over a folder that had the agent's file in it.
export function cx_exec(command) {
  // Claimed synchronously, so a caller in this same tick waits for this one.
  let started;
  const previous = queue;
  queue = new Promise((resolve) => { started = resolve; });
  const run = previous.then(() => {
    out = [];
    let real;
    try {
      real = linux.run("/bin/sh", ["-c", command], {
        env: ["HOME=/root", "PATH=/usr/sbin:/usr/bin:/sbin:/bin", "TERM=dumb"],
        cwd: "/root", uid: 0, gid: 0,
      }).then((status) => {
        // The console is a terminal: it carries escape sequences and CRLF that
        // belong to a screen, not to a captured result.
        const text = out.join("")
          .replace(/\x1b\][^\x07]*\x07/g, "")
          .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
          .replace(/\r\n/g, "\n");
        const code = typeof status === "number" ? status : (status && status.status) | 0;
        return JSON.stringify({ status: code, output: text });
      });
    } catch (e) {
      // A command that never started must not wedge the queue behind it.
      started();
      throw e;
    }
    // THE QUEUE STAYS CHAINED ON THE REAL PROCESS, never on the wait (R11-1b).
    // A stop below settles the caller at once, but if the interrupt did not
    // actually reach the command then it is still in there writing into this
    // one console, and letting the next command start beside it would mix two
    // commands' output into one capture. So the next command waits for the
    // process, and the page says so rather than pretending otherwise.
    started(real.catch(() => {}));
    return new Promise((resolve, reject) => {
      giveup = () => reject(new Error(
        "You stopped waiting. CheerpX runs each command as its own process with no way in " +
        "from the page except the console, so the interrupt was typed at the console and " +
        "the command may still be running; the workspace takes the next command when it ends."
      ));
      const done = () => { giveup = null; occupied = false; };
      real.then((json) => { done(); resolve(json); }, (e) => { done(); reject(e); });
    });
  });
  return run;
}

// STOP: type Ctrl-C at the console, then stop waiting either way (R11-1b).
// `send` is the only door CheerpX has and it is not addressed to a process — it
// goes to the console, so it ends the command only when the command is what is
// reading that console. `cx.run` returns no handle and takes no AbortSignal, so
// there is nothing stronger to reach for. Returns whether there was anything to
// stop at all.
export function cx_stop() {
  if (!giveup) return false;
  if (send) send(3);
  const end = giveup;
  giveup = null;
  occupied = true;
  end();
  return true;
}
