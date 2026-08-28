# SANDBOX — measuring the isolation substrate

> Increment 5.1. A measurement, not a build. No product code was written and
> nothing outside this file was touched.
>
> Everything under **MEASURED** was run on this machine on 2026-08-28 and the
> output is quoted. Everything under **READ** is someone else's claim with a
> citation. The two are never mixed. Where I am guessing, the sentence begins
> with *Guess:*.

---

## The machine everything below was measured on

```
macOS 27.0 (26A5388g) · Darwin 27.0.0 arm64
docker client 28.5.1 · docker server 29.5.2 via colima
colima VM: Ubuntu 24.04.4 LTS, aarch64, 2 CPUs, 1.914 GiB RAM
c2w version 0.8.4  (/opt/homebrew/bin/c2w, Homebrew bottle, 16.2MB)
Chrome/151.0.7922.175 headless, driven over CDP
```

The colima VM has **2 CPUs and 1.9 GiB of RAM**. That is the stock allocation
and it is small for compiling an x86 emulator. Every build timing below is
bounded by it, and where a build did not finish I say so rather than
extrapolating.

---

# MEASURED

## 1. container2wasm — it does not build, for three separate reasons

The operator's standing note said Homebrew's `c2w` was broken by a deleted
upstream tag. **The note is correct, and the cause is worse than a deleted
tag.**

### Failure 1 — the assets clone (4.3 seconds in)

```
$ c2w --target-arch=amd64 alpine:3.21 ./out-alpine.wasm

#20 [assets-base 3/3] RUN git clone -b v0.8.4 https://github.com/ktock/container2wasm /assets
#20 0.418 Cloning into '/assets'...
#20 1.381 fatal: Remote branch v0.8.4 not found in upstream origin
#20 ERROR: process "/bin/sh -c git clone -b ${SOURCE_REPO_VERSION} ${SOURCE_REPO} /assets"
    did not complete successfully: exit code: 128

c2w ... 0.12s user 0.13s system 5% cpu 4.300 total
EXIT=1
```

### The root cause: the project changed hands, and Homebrew still points at the husk

`c2w --show-dockerfile` bakes the source of its own build assets into the
image at line 41–42:

```
ARG SOURCE_REPO=https://github.com/ktock/container2wasm
ARG SOURCE_REPO_VERSION=v0.8.4
```

That repository still exists and returns HTTP 200, which is why this looks like
a deleted tag. It is not. Querying the GitHub API:

```
$ git ls-remote --tags https://github.com/ktock/container2wasm
(empty)

$ curl -s https://api.github.com/repos/ktock/container2wasm
'created_at': '2026-06-09T16:01:56Z'
'stargazers_count': 6
'forks_count': 0
'fork': True
'description': 'Container to WASM converter. Moved to https://github.com/container2wasm/container2wasm'
```

**`ktock/container2wasm` is now a six-star fork stub with zero tags and zero
releases.** The project moved to its own organisation. The real repository has
every tag:

```
$ git ls-remote --tags https://github.com/container2wasm/container2wasm
... v0.8.0 v0.8.1 v0.8.2 v0.8.3 v0.8.4

$ releases: v0.8.4 published 2026-03-16
    container2wasm-v0.8.4-linux-amd64.tar.gz   6492344 bytes
    container2wasm-v0.8.4-linux-arm64.tar.gz   5899182 bytes
    c2w-net-proxy.wasm                        21574298 bytes
```

Note the release assets are **linux only** — there is no darwin binary, so the
Homebrew bottle is the only prebuilt route on this machine, and it is the
broken one.

**Workaround found and confirmed to work:**

```
c2w --build-arg SOURCE_REPO=https://github.com/container2wasm/container2wasm ...
```

This gets past the assets stage. So the answer to "is a working path
available" is *partly yes* — and then it fails again.

### Failure 2 — `ftp.gnu.org` is unreachable, and grub is fetched from nowhere else

```
#42 [grub-amd64-dev 3/13] RUN wget https://ftp.gnu.org/gnu/grub/grub-2.06.tar.gz
#42 0.405 Connecting to ftp.gnu.org (ftp.gnu.org)|209.51.188.20|:443... failed: Connection refused.
#42 ERROR: ... exit code: 4
```

I checked whether this was c2w's fault or the network's. It is the network's,
and it is total:

```
$ curl -sS -I --max-time 25 https://ftp.gnu.org/gnu/grub/grub-2.06.tar.gz
curl: (28) Connection timed out after 25004 milliseconds

$ nc -vz -G 10 ftp.gnu.org 443
nc: connectx to ftp.gnu.org port 443 (tcp) failed: Operation timed out

$ dig +short ftp.gnu.org
209.51.188.20                      # DNS resolves; TCP 443 never answers
```

Unreachable from the host *and* from inside the colima VM. This is not a c2w
defect — but c2w hard-codes that one host with no mirror and no fallback, so
c2w cannot build while GNU's server is down.

### Failure 3 — the obvious mirror is also broken

```
#42 [grub-amd64-dev 3/13] RUN wget https://ftpmirror.gnu.org/gnu/grub/grub-2.06.tar.gz
#42 1.312 HTTP request sent, awaiting response... 502 Bad Gateway
```

A working mirror does exist:

```
$ curl -o /dev/null -w "%{http_code} %{size_download}b in %{time_total}s" \
    -L https://mirrors.kernel.org/gnu/grub/grub-2.06.tar.gz
200 11510281b in 2.535620s
```

### The structural finding, which outlives today's outage

`c2w --show-dockerfile` is **1,065 lines** and fetches from **20 distinct
third-party origins at build time, with no vendoring and no checksums**:

```
  6 https://github.com/krallin/tini
  3 https://github.com/torvalds/linux
  3 https://github.com/opencontainers/runc.git
  3 https://github.com/hoytech/vmtouch.git
  3 https://busybox.net/downloads/busybox-
  2 https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-
  2 https://github.com/kateinoigakukun/wasi-vfs.git
  2 https://github.com/bytecodealliance/wizer
  1 https://zlib.net/fossils/zlib-
  1 https://gitlab.freedesktop.org/pixman/pixman
  1 https://github.com/WebAssembly/binaryen/releases/download/version_
  1 https://github.com/riscv-software-src/riscv-pk
  1 https://github.com/libffi/libffi
  1 https://github.com/ktock/tinyemu-c2w
  1 https://github.com/ktock/qemu-wasm
  1 https://github.com/ktock/container2wasm
  1 https://github.com/ktock/Bochs
  1 https://ftp.gnu.org/gnu/grub/grub-2.06.tar.gz
  1 https://download.gnome.org/sources/glib/
```

Three of those are still `ktock/*` — the same account that already moved the
main repository out from under this build once. **Any one of these twenty going
away breaks the build**, and two of them did today. A reproducible
`scripts/build-sandbox.sh` (which is what increment 5.2 asks for) would be a
script whose success depends on twenty servers staying up, none of them
pinned by hash.

### Failure 4 — with both URLs patched, the build runs but did not finish

With `SOURCE_REPO` redirected and grub repointed at `mirrors.kernel.org`, the
build proceeds correctly into the real work — cross-compiling busybox, the
Linux kernel, runc, grub, and Bochs-to-wasm through `wasi-sdk-19.0`:

```
#71 [bochs-dev-common 22/25] RUN ... CC="/wasi/wasi-sdk-19.0/bin/clang" \
    ./configure --host wasm32-unknown-wasi --enable-x86-64 --with-nogui ...
#72 [grub-amd64-dev 6/13] RUN ./configure --target=i386
#45 [busybox-amd64-dev 8/13] RUN make CROSS_COMPILE=x86_64-linux-gnu- LDFLAGS=--static -j$(nproc)
```

**This build did not produce an artifact within the time budget of this
increment.** At **7 minutes 31 seconds** elapsed it was still running, with the
kernel (`make ARCH=x86 CROSS_COMPILE=x86_64-linux-gnu- -j$(nproc)`), busybox
and Bochs stages all still in flight on the VM's 2 vCPUs, and no
`out-alpine.wasm` on disk. It had not failed — it simply had not finished, and
I stopped waiting rather than guess at the end of it. I am therefore recording **no artifact
size, no boot time and no guest capability for c2w** — not an estimate, and
not the prior tree's numbers reused as if they were this tree's.

What I can state with evidence:

- **c2w 0.8.4 as installed cannot build anything on this machine.** Two
  independent blockers, both reproduced, both quoted above.
- **Neither blocker is a bug in this project's code, and neither is fixable
  from inside this repo.** One is a stale URL in a Homebrew formula; one is a
  third-party server being down.
- **Both were only passable by hand-patching a 1,065-line generated
  Dockerfile.** A `--build-arg` and a `sed` against an emulator build script is
  not a foundation an increment can declare "reproducible from a script
  in-repo," which is exactly what 5.2 requires.

The specific figures this increment was asked to confirm or refute — bare
Alpine ≈ 42.7 MB, OCI layout ≈ 3.7 MB, emulator:guest ≈ 11.6:1 — are therefore
**neither confirmed nor refuted here.** They remain the prior tree's numbers.
They are cited nowhere below as if they were mine.

## 2. Pyodide 0.28.0 — measured bytes, measured boot, measured limits

### Bytes (downloaded and weighed, not read off a page)

| file | uncompressed | over the wire (brotli, jsDelivr) |
|---|---:|---:|
| `pyodide.mjs` | 15,828 | 6,548 |
| `pyodide.asm.js` | 1,072,130 | 225,915 |
| `pyodide.asm.wasm` | 8,645,010 | 2,669,337 |
| `python_stdlib.zip` | 2,416,414 | 2,379,376 |
| `pyodide-lock.json` | 108,703 | — (340 packages listed) |
| **minimum boot set** | **12,149,382 B (11.6 MiB)** | **5,281,176 B (5.04 MiB)** |

That is the *empty* interpreter. `numpy` and everything else in the 340-package
lock file is an additional download per package.

### Boot, in Chrome, from a server sending no COOP/COEP headers

```
crossOriginIsolated = false
SharedArrayBuffer   = false

PYODIDE import module ms    = 2
PYODIDE loadPyodide ms      = 677
PYODIDE first runPython ms  = 10
PYODIDE version = 3.13.2 (main, Jul  4 2025, 13:41:45) [Clang 21.0.0git ...]
```

**Read that 677 ms conservatively.** It was served from `localhost` off an SSD
to a fresh browser profile: no DNS, no TLS, no CDN, no network latency, and no
HTTP cache either. It is the floor — the wall-clock cost of instantiating 8.6 MB
of WebAssembly and unpacking the stdlib, with the 5.04 MiB download taking zero
time. On a real cold open over the network the download dominates and the true
figure is larger by however long 5 MiB takes on the user's connection. I did not
measure that, and it is the number a cold-open budget would actually need.

**Pyodide works with no cross-origin isolation and no SharedArrayBuffer.** That
is the single most important positive result in this document: it clears the
constraint that disqualifies WebContainer.

### What it genuinely cannot do

```
subprocess_run   -> RAISED: OSError: [Errno 138] emscripten does not support processes.
os_fork          -> RAISED: OSError: [Errno 52] Function not implemented
threads          -> RAISED: RuntimeError: can't start new thread
urllib           -> RAISED: urllib.error.URLError: <urlopen error unknown url type: https>
numpy_import     -> RAISED: (not bundled; must be fetched per-package)
open_write       -> RETURNED: hi          (in-memory FS only, gone on reload)
```

No processes, no fork, no threads, no shell. **Pyodide cannot run a command.**
It runs Python expressions. If the tool the agent wants is `bash`, Pyodide is
not a candidate at any price.

### Pyodide cannot be interrupted in this architecture — measured

Pyodide's only mechanism for stopping running Python is `setInterruptBuffer`,
and it takes a `SharedArrayBuffer`, which requires cross-origin isolation:

```
SharedArrayBuffer available    = false
py.setInterruptBuffer exists   = function
install interrupt buffer       -> CANNOT INSTALL INTERRUPT:
                                  ReferenceError SharedArrayBuffer is not defined
```

The method exists and cannot be armed. So **`while True: pass` in Pyodide, on a
page without COOP/COEP, cannot be stopped** — which is `LESSONS.md` defect 4's
frozen tab exactly. The only remedy is to run Pyodide inside a Worker and call
`terminate()`, which is measured below to work instantly — but that destroys
the interpreter, so every timeout costs a full 5.04 MiB / 677 ms re-boot and
all in-memory state.

This also means the two options interact: **Pyodide is only safe inside the
Worker whose isolation is worthless on its own.** Neither is sufficient alone.

### Two silent-success traps in Pyodide, which this tree must not repeat

`LESSONS.md` defect 3 is the rule that *an unimplemented capability is absent,
not stubbed*, because a stub returning success gives the model positive
confirmation for work that never happened. **Pyodide ships two of exactly that
shape**, and I only found them because I refused to accept the first result:

```
os.system("touch /tmp/proof_of_exec")
  -> rc=-1  file_created=False        # returns, does not raise, does nothing

import socket; s = socket.socket()
s.connect(("example.com", 80))        # RETURNS SUCCESSFULLY
s.send(b"GET / HTTP/1.0\r\n\r\n")     # RETURNS SUCCESSFULLY
s.recv(64)                            # RAISED: TimeoutError: timed out
```

A socket that connects, accepts a write, and then never delivers a byte is the
`default: return exit code 0` defect wearing a library's clothes. **If Pyodide
is ever adopted, `os.system` and `socket` must be removed from the guest before
the model is told Python exists** — not documented as unsupported, removed.

## 3. QuickJS via `quickjs-emscripten` 0.32.0 — the only measured real boundary

MIT licensed (`quickjs-emscripten: The MIT License`). Sizes weighed:

| artifact | uncompressed | gzip -9 |
|---|---:|---:|
| `emscripten-module.wasm` (release-sync) | 503,134 | **231,503** |
| browser glue `.mjs` | 9,368 | — |
| `quickjs-emscripten-core` `.mjs` (index + chunks) | ~56,000 | — |

### Boot

```
run 1 (module fetched from esm.sh)    run 2
QUICKJS import ms = 392               4
QUICKJS init ms   = 253               5
QUICKJS eval ms   = 9                 4
QUICKJS 1+1 = 2
```

**Instantiate-and-evaluate is ~10 ms** (run 2). The 392/253 ms in run 1 is the
network fetch from `esm.sh` plus first compile; vendored into the page as this
tree requires, only the ~10 ms remains, plus whatever 231 KB costs to download.
Compare Pyodide: 5.04 MiB and a 677 ms floor.

*Caveat: I did not isolate download from compile in run 1, and both runs used a
fresh browser profile, so I cannot fully explain run 2's speed. The ~10 ms
instantiate figure is the one I stand behind; treat 392 ms as an upper bound on
first load, not a measurement of any one thing.*

### The isolation is structural, and I attacked it

`LESSONS.md` defect 4 is the fake sandbox: `new AsyncFunction(...)` in the page
realm with full closure over `fetch`, `window`, `indexedDB`, and a
`Promise.race` timeout that cancelled nothing so `while(true)` froze the tab
permanently. The rule that came out of it: *isolation is structural or it is
not claimed.* QuickJS was tested against precisely that rule.

```
guest globals:  {"fetch":"undefined","window":"undefined",
                 "XMLHttpRequest":"undefined","indexedDB":"undefined",
                 "globalThis_keys":61}

escape via (0,eval)('typeof fetch')            -> "undefined"
escape via Function('return typeof globalThis.fetch')() -> "undefined"
```

The guest global object has **61 own properties and none of them are host
capabilities**, and the two standard realm-escape idioms do not recover them.
This is a different realm with a different global object — not shadowed
parameters.

### It can be stopped, which is the part the old tree got wrong

```
infinite loop         -> INTERRUPTED: InternalError after 501ms (tab still alive)
memory bomb (1MB cap) -> OOM-STOPPED: {"name":"InternalError","message":"out of memory"}
```

`while(true){}` is killed on a deadline and the tab survives. A memory limit is
enforced. Both of the old sandbox's fatal properties are measurably absent.

## 4. A plain Web Worker — a liveness boundary, not a security boundary

```
globals visible to code running in the worker:
  {"fetch":"function", "indexedDB":"object", "XMLHttpRequest":"function",
   "importScripts":"function", "caches":"object", "WebSocket":"function",
   "crypto":"object", "localStorage":"undefined"}

worker.terminate() on an infinite loop -> returned in 0.0 ms
  main thread did 672,877 iterations after terminate -> alive
```

Read this honestly. Code in a worker keeps **`fetch`, `XMLHttpRequest`,
`WebSocket`, `indexedDB`, `caches` and `importScripts`.** It can call the
model endpoint with the user's key, read every stored conversation, and
exfiltrate all of it. A worker is **not** an isolation boundary for untrusted
code and the word "sandbox" must never be attached to one on its own.

What a worker *does* give, and gives perfectly, is **termination**:
`terminate()` killed a spinning loop instantly with the main thread untouched.
That is a genuine and valuable property — it is just a different one.

## 4b. The composite — QuickJS inside a terminable Worker — measured together

Because this is the only configuration recommended below, it was measured as a
configuration and not assumed from its parts. A module Worker loads QuickJS,
arms a 1-second interrupt deadline, and the host arms its own 3-second
`terminate()` as a second line:

```
arith          -> OK:2                                    (778 ms, incl. worker+wasm boot)
globals count  -> OK:"61"                                 (16 ms)
fetch in guest -> OK:"undefined"                          (12 ms)
infinite loop  -> ERROR:{"name":"InternalError","message":"interrupted"}   (1010 ms)
stack bomb     -> WORKER TERMINATED by host after 3001 ms
main thread alive after all of the above: 673,456 iterations in 50 ms
```

Two things worth keeping:

- Steady-state cost after the first call is **12–16 ms**; the 778 ms on the
  first is worker startup plus the WASM fetch and compile.
- **The stack bomb was not caught by QuickJS's interrupt handler.** Unbounded
  recursion ran past the 1-second deadline and only the host's `terminate()`
  stopped it. So the inner guard is *not* sufficient on its own, and the
  two-layer arrangement is load-bearing rather than belt-and-braces. Anything
  built here must keep both, and the outer timeout is the one that must never
  be removed.

(`localStorage` being `undefined` in a worker while `indexedDB` is present is
also the physics-based realm check `LESSONS.md` demands in place of
`typeof window`. Confirmed here.)

---

# READ (not measured here — cited)

## 5. WebContainer — disqualified three times over

Researched from primary sources; the decisive facts come from the shipped
`@webcontainer/api@1.6.4` tarball, not marketing.

- **Boot is a hard network dependency on StackBlitz.** `dist/index.js` creates
  a hidden iframe pointed at `DEFAULT_EDITOR_ORIGIN = 'https://stackblitz.com'`
  path `/headless`, and the returned instance is a Comlink proxy over a
  MessagePort to that cross-origin frame. The npm package is a ~180 KB client
  shim; the runtime lives on StackBlitz's origin. There is no self-host option
  outside an Enterprise agreement.
  → Violates NORTH-STAR consequence 1 (zero backend) and test 3 (airplane).
- **COOP/COEP are mandatory.** *"WebContainer requires SharedArrayBuffer,
  which, in turn, requires your website to be cross-origin isolated."*
  (webcontainers.io/guides/configuring-headers). GitHub Pages cannot set
  response headers. The only escape is the `coi-serviceworker` hack — unofficial,
  and it forces a reload on first visit.
- **Licensing is a service licence, not the MIT on the shim.** StackBlitz ToS:
  *"Customers with active commercial StackBlitz plans may integrate the
  StackBlitz WebContainer API on their website, subject to a usage limitation
  of 500 sessions per month."* And: *"Usage of the API in violation of these
  terms may result in your access being revoked."*
- Also: no native binaries, stdlib-only Python, Safari beta, Firefox alpha,
  mobile undocumented. No published runtime size.

**Verdict: not eligible.** It is not a static page any more once it is added.

## 6. No sandbox at all — the `pi` position

`earendil-works/pi` ships no sandbox deliberately, on the stated grounds that
*"a partial in-process sandbox would be easy to misunderstand as a security
boundary."* That is the same argument as `LESSONS.md` defects 3 and 4, arrived
at independently, and it is the strongest argument in this document.

---

# THE OPTIONS, side by side

| | wire cost | boot | isolates? | can stop it? | runs commands? | works w/o COOP/COEP? | static page? |
|---|---:|---:|---|---|---|---|---|
| **c2w / Alpine** | unmeasured (build failed) | unmeasured | yes, full VM | unmeasured | yes | prior tree: yes | yes, but 20-origin build chain |
| **WebContainer** | unpublished | "ms" (claimed) | yes | n/a | Node only | **no** | **no — boots off stackblitz.com** |
| **Pyodide** | 5.04 MiB | 677 ms | interpreter, not a boundary | **no — interrupt needs SAB, unavailable**; only `terminate()` | **no** | **yes** | yes |
| **QuickJS** | **231 KB gz** | **~10 ms** | **yes, measured** | **yes, 501 ms deadline + memory cap** | no | **yes** | yes |
| **Worker alone** | 0 | ~0 | **no — full fetch/IDB** | **yes, instant** | no | yes | yes |
| **No sandbox** | 0 | 0 | n/a | n/a | n/a | yes | yes |

---

# THE RECOMMENDATION

**Build no sandbox in wave 5. Strike 5.2, 5.3 and 5.4 as specified, and close
wave 5 on this measurement.**

The trade, in one sentence: *the only substrate cheap and honest enough to ship
(QuickJS, 231 KB, 10 ms, a real realm boundary that can be interrupted) runs
only JavaScript with no I/O, which is not a capability the agent lacks — and
every substrate that would give the agent something it actually lacks either
does not build (c2w), requires a backend and headers this architecture refuses
(WebContainer), or cannot run a command at all (Pyodide).*

The reasoning, against NORTH-STAR rather than against the option list:

1. **NORTH-STAR says an agent is four things and a sandbox is not one of them.**
   It says tools are "executed against a real environment." A QuickJS guest
   with no `fetch`, no filesystem and no processes is not a real environment;
   it is a calculator. Shipping it would let the harness tell the model it has
   a sandbox, and the model would then be right to expect it to do something.
2. **The capability is not reachable from the cold-open test.** A stranger
   opening the URL reaches a working agent turn. Nothing in that path needs
   code execution. NORTH-STAR: *"A capability earns its place by being
   reachable from the cold-open test — not by being impressive in isolation."*
   An Alpine VM in a tab is the single most impressive-in-isolation thing this
   project could build.
3. **5.2 as written cannot be honoured.** It asks for a build "reproducible
   from a script in-repo." What is actually available is a script that clones
   from twenty unpinned origins, two of which failed today, one of which
   already relocated the project once. That is not reproducibility; it is a
   dependency on twenty servers being up on the day.
4. **Legible over capable.** A 200-line file limit and a zero-runtime-dependency
   rule, next to an x86 emulator cross-compiled through `wasi-sdk-19`, is not
   one system that explains itself.

**What to do instead, if execution is genuinely wanted:** the seam already
exists. NORTH-STAR permits "the user's own key or their own local endpoint,
called directly from the page" for models. A local exec endpoint on the user's
own machine is the *same seam* and breaks no consequence — no server the
project owns, works on the airplane, degrades to absent when unreachable.
It is honest in a way no in-tab sandbox is: the tool is either reachable or it
is not present, never stubbed. *Guess: this is a smaller increment than 5.2–5.4
combined, but I have not designed it and have not measured it.*

If a sandbox is nonetheless ordered, the ranking on evidence is: **QuickJS in a
terminable Worker** (structural realm boundary from QuickJS, instant kill from
`terminate()`, 231 KB) — and it must be described to the model as "evaluate a
JavaScript expression, no I/O," never as a container or a shell.

---

# WHAT WOULD CHANGE THIS

Each of these is falsifiable and none of them is satisfied today.

1. **c2w produces an artifact and the artifact is cheap.** A completed build
   whose `.wasm` is measured in bytes, boots in a real browser at a GitHub
   Pages *subpath* in under ~5 s, and runs a command whose output returns.
   The build attempted here is still the open question — if it completes, the
   size and boot numbers go in this file and this recommendation is re-argued
   on them, not on principle. The prior-tree figures worth confirming (bare
   Alpine ≈ 42.7 MB, OCI-layout ≈ 3.7 MB, emulator:guest ≈ 11.6:1) are **not
   confirmed here** and must not be cited as if they were.
2. **The build chain gets pinned.** If c2w ships prebuilt assets, or the twenty
   fetches become hash-pinned and vendored, objection 3 above dies. Today a
   darwin release binary does not even exist.
3. **A real task fails for want of execution.** Not a hypothetical — an entry
   in this tree's own transcripts where a turn could not be completed because
   the agent had nowhere to run something. That is the evidence that turns a
   sandbox from impressive into necessary, and it is the one I would weight
   highest.
4. **The tab gets cross-origin isolation legitimately.** If the deploy target
   can set COOP/COEP without the service-worker hack, threaded Pyodide and
   WebContainer both reopen — though WebContainer still fails on the backend
   dependency and the licence, which headers do not fix.
5. **Pyodide's silent successes get closed.** If the guest can be handed to the
   model with `os.system` and `socket` genuinely removed, Pyodide becomes a
   defensible *Python evaluation* tool at 5 MiB — still not a shell, but no
   longer capable of lying to the model.
6. **The 11.6:1 ratio is re-measured and is wrong.** If emulated compute is
   near-native, the argument that an in-tab VM is a toy weakens considerably.

---

## Appendix — how to reproduce every number here

Everything was run from a scratch directory; nothing was added to the repo.

- c2w attempts: `c2w --target-arch=amd64 [--dockerfile <patched>] [--build-arg SOURCE_REPO=...] alpine:3.21 ./out-alpine.wasm`
- Browser numbers: a static server that deliberately sets **no** COOP/COEP
  headers, driven by headless Chrome over the DevTools Protocol. The
  `crossOriginIsolated = false` line at the top of every run is the proof the
  measurement was taken under the architecture's real constraint.
- Byte counts: `wc -c` on downloaded files; wire cost via
  `curl -w '%{size_download}' -H 'Accept-Encoding: br, gzip'`.

---

# ADDENDUM — 2026-08-28, later the same day: c2w builds, boots, and is 108x slow

> The owner overruled the recommendation above and ordered container2wasm
> pursued. Everything under §1 stands as the record of what was true before
> that decision; nothing in it has been edited. This section is a second
> measurement, and it changes three of §1's conclusions.
>
> Same rules: **MEASURED** is quoted output from this machine, *Guess:* marks a
> guess, and READ is someone else's claim.

## The headline, before the detail

**There is an artifact and it boots in a browser.**

```
$ wc -c /Users/kaush/Downloads/Dev/c2w-work/build/out/alpine.wasm
109375445

$ shasum -a 256 alpine.wasm
7cf869c6847b0e55341f80a890cb38f839ade19961c723ed107d6eb1f9c8bb1d  alpine.wasm

$ gzip -9 -c alpine.wasm | wc -c
40577518
```

**109,375,445 bytes.** Built in **17m37s**, reproducibly, from
`scripts/wasm/build.sh` in this repository. It runs real Alpine 3.21.7 on a real
Linux 6.1 x86_64 kernel in Chrome with **no COOP/COEP and no
SharedArrayBuffer** — and it executes emulated x86 at roughly **1/108th** the
speed of the same binary on the same machine.

## 0. What changed about the machine, because it is the whole story of §1.4

§1.4 recorded a build that had not finished at 7m31s. The cause was not the
build:

```
before:  colima VM  2 CPUs, 1.914 GiB RAM     (stock)
after:   colima VM 10 CPUs, 23.42 GiB RAM     (colima stop; colima start --cpu 10 --memory 24)
host:    16 CPUs, 137438953472 bytes RAM      (sysctl hw.ncpu hw.memsize)
```

The host had **16 cores and 128 GB** the entire time and the Docker VM was
using 2 and 1.9. `c2w` hardcodes `--platform=linux/amd64` (`cmd/c2w/main.go`,
the `build` function), so on Apple silicon *every stage of the build* — the
kernel, grub, Bochs, two cargo builds — runs under the VM's x86_64 binfmt. On
2 vCPUs that is what "did not finish" looks like. It was never a c2w defect and
it was never an unfixable one.

## 1. Blocker 1 (moved org) — solved, and solved better than `--build-arg`

`--build-arg SOURCE_REPO=...` works but leaves the build cloning a moving
target. `c2w --assets <dir>` passes `--build-context assets=<dir>`, which
**replaces the `assets` stage entirely**, so the build never clones
container2wasm at all. `scripts/wasm/build.sh` clones it once at a pinned sha
and hands it over.

The Homebrew binary is not usable and does not need to be: the CLI is a Go
program in the same tree.

```
=== vendoring container2wasm @ 6ed3d98882a2b22eafc1334f574c364a5b2b8c47
=== building c2w from source
c2w version <unknown>
```

(`<unknown>` because the version is injected by `make`, not `go build`. Cosmetic.)

## 2. Blocker 2 (`ftp.gnu.org`) — solved, and the fix is safer than the original

The build now fetches grub from `mirrors.kernel.org` **and checks the sha256**,
which the original never did from anywhere:

```
RUN wget -O grub-2.06.tar.gz https://mirrors.kernel.org/gnu/grub/grub-2.06.tar.gz \
 && echo "23b64b4c741569f9426ed2e3d0e6780796fca081bee4c99f62aa3f53ae803f5f  grub-2.06.tar.gz" | sha256sum -c -
```

A substituted origin is only honest if the bytes are proven identical. That is
the whole argument for content pinning in one line.

## 3. Blocker 3 (time) — 17m37s, on a warm cache

```
real	17m36.947s
```

Read that with two caveats:

- **52 of the ~120 build steps reported `CACHED`.** The earlier attempts left
  busybox, runc, tini and the base images in the buildkit cache. A genuinely
  cold build is longer and I did not measure how much longer.
- It is 10 vCPUs of x86 emulation. On the original 2 it was unbounded.

## 4. Blocker 4 (twenty unpinned origins) — the honest answer

§1 said this is the one patience does not fix. That is still true, but the
claim was too broad and the shape of it is different than it looked.

**What was overstated:** several of those origins were *already* sha-pinned by
upstream (`Bochs`, `qemu-wasm`, `tinyemu-c2w`, `wizer`, `libffi`). And the
twenty-origin count is the *whole* Dockerfile; a `--target-arch=amd64` build
executes about **fourteen** of them and never touches the riscv, aarch64, QEMU
or emscripten paths.

**What is now pinned** — `scripts/wasm/PINS.env` and the seds in `build.sh`:
four base images by manifest digest, eight git sources by commit sha, four
tarballs by sha256. The script **refuses to build** if any patch failed to
apply, because a no-op `sed` that leaves the original Dockerfile intact is
exactly the "reports success for work it did not do" defect this project guards
against:

```
grep -q "$SHA256_BUSYBOX" "$DF"  || { echo "PATCH FAILED: busybox"; exit 1; }
if grep -q "ftp.gnu.org" "$DF"; then echo "PATCH FAILED: ftp.gnu.org survived"; exit 1; fi
```

**What is still not pinned, and cannot be without more work:** nine
`apt-get install` lines against the live Ubuntu and Debian archives,
`proxy.golang.org`, `crates.io`, and registry availability. Full list with
consequences in `scripts/wasm/README-UNPINNED.md`.

**The sentence that matters:** a content pin turns *silently different* into
*loudly absent*. It does not make the build survive an origin disappearing.
Two of the pinned repositories are still `ktock/*` — the same account that
moved `container2wasm` out from under this build once, and a commit sha does
not survive a repository being deleted. **This build works today because
sixteen servers are up today.** Making it genuinely reproducible means
vendoring roughly a gigabyte of bytes into this tree, and that trade has not
been made.

## 5. It boots — in the browser, with no cross-origin isolation

`scripts/wasm/serve-probe.ts` serves with **no** COOP/COEP headers;
`scripts/wasm/boot-probe/` instantiates the guest in a module Worker, passes
the command as argv, and captures stdout. Driven by headless Chrome:

```
crossOriginIsolated = false
SharedArrayBuffer   = false
wasm bytes = 109375445
fetch ms = 32
compile ms = 23
stubbed ENOTSUP: sock_accept
instantiate ms = 7
GUEST STDOUT: "NAME=\"Alpine Linux\"\r\nID=alpine\r\nVERSION_ID=3.21.7\r\n..."
first guest output at ms = 672
EXIT exit with exit code 0 at 803 ms
```

```
GUEST STDOUT: "Linux localhost 6.1.0 #1 PREEMPT_DYNAMIC Fri Aug 28 08:23:25 UTC 2026 x86_64 Linux\r\n"
first guest output at ms = 712
EXIT exit with exit code 0 at 838 ms
```

Three things in that output are load-bearing:

1. **`SharedArrayBuffer = false` and it still works.** This is the disqualifying
   question from §5 and c2w passes it. The *upstream demo* needs SAB twice —
   `xterm-pty`'s `TtyClient` blocks the worker on `Atomics.wait` for interactive
   stdin, and the networking stack passes frames through a `SharedArrayBuffer`
   (`examples/wasi-browser/htdocs/stack.js`). Neither is needed to boot the
   guest and run a command. **The artifact does not require cross-origin
   isolation; interactive stdin and networking do.**
2. **~700 ms to first output is not a Linux boot.** `OPTIMIZATION_MODE=wizer`
   pre-initialises the emulator, so the kernel boot happened at *build* time —
   which is why the guest's `uname` reports the build timestamp. What is
   measured here is resuming a snapshot, not booting.
3. **`stubbed ENOTSUP: sock_accept`.** The guest imports a WASI socket call the
   browser shim does not define. The probe fills missing imports with a
   function returning errno 58 **and prints their names**. It would have been
   one line to stub them silently and one line more to return 0; that is
   `LESSONS.md` defect 3 exactly, and the reason the probe announces it.

`compile ms = 23` for 109 MB is V8 compiling lazily, not compiling 109 MB. The
cost appears at run time.

**Not measured:** peak memory. `browse memory` reports the page's JS heap
(1.3 MB) and per-process CPU but no per-process RSS, so the wasm memory
footprint of a 109 MB module with a 128 MiB guest is **unknown to me**. It is
the number a real device budget would need.

**Not measured:** whether it works from a GitHub Pages *subpath*. Every URL in
the probe is relative, so it should, but "should" is not a measurement.

### wasmtime cannot run this artifact at all

The obvious host-side check fails, and not in the guest:

```
$ wasmtime alpine.wasm uname -a
thread '<unnamed>' panicked at cranelift-codegen .../inst_builder.rs:688:78:
called `Result::unwrap()` on an `Err` value: MemFlagsSetOverflow
```

wasmtime 48.0.1 panics in Cranelift while compiling the module. The browser
compiles and runs the same bytes. Every runtime figure below is therefore
V8's, and c2w's own README's `wasmtime out.wasm uname -a` does not work here.

## 6. The speed, which is the finding that matters

Same work, same input, three places. `busybox sha256sum` over zeros; the guest
hashes were checked against the host and are **identical**, so the guest really
did the work:

| where | workload | wall | per MiB |
|---|---|---:|---:|
| Chrome, Bochs-in-wasm, x86 guest | 32 MiB | 14.04 s | 0.4388 s |
| Chrome, Bochs-in-wasm, x86 guest | 128 MiB | 55.17 s | 0.4310 s |
| colima, x86 binfmt, **same busybox** | 1 GiB | 4.09 s | 0.00399 s |
| colima, arm64 alpine, native | 1 GiB | 2.99 s | 0.00292 s |

(Guest times have the 0.67 s resume subtracted. Container rows have a measured
0.15 s startup subtracted. The two guest rows agree to 2%, so the cost is
linear and not a fixed overhead being amortised.)

```
guest 32 MiB  -> 83ee47245398adee79bd9c0a8bc57b821e92aba10f5f9ade8a5d1fae4d8c4302
host  32 MiB  -> 83ee47245398adee79bd9c0a8bc57b821e92aba10f5f9ade8a5d1fae4d8c4302
guest 128 MiB -> 254bcc3fc4f27172636df4bf32de9f107f620d559b20d760197e452b97453917
host  128 MiB -> 254bcc3fc4f27172636df4bf32de9f107f620d559b20d760197e452b97453917
```

**Emulator : same-binary-under-host-binfmt = 108 : 1.**
**Emulator : native arm64 = 148 : 1.**

## 7. The three prior figures, confirmed or refuted

| prior claim | verdict |
|---|---|
| bare Alpine wasm ≈ **42.7 MB** | **Refuted for this configuration.** 109,375,445 bytes uncompressed. *Guess: the old figure may have been gzipped — `gzip -9` gives 40,577,518, which is within 5% of 42.7 MB — or built with `--external-bundle`, which moves the image out of the wasm. I did not build either variant, so this is a guess about someone else's number, not a measurement.* |
| Alpine as OCI layout ≈ **3.7 MB** | **Not tested.** That is a figure about a container image, not a wasm artifact, and nothing in this build produces it. |
| emulator:guest ≈ **11.6 : 1** | **Refuted, badly.** Measured 108:1 against the fairest denominator available and 148:1 against native. Whatever produced 11.6:1 was not this configuration — *Guess: a JIT-based emulator (QEMU) rather than Bochs, which is an interpreter.* |

## 8. Three silent zeros hit while measuring this, all worth keeping

Every one of these produced a plausible-looking number for work that never
happened. They are the same defect as a sandbox returning exit 0.

1. **`git ls-remote <repo> refs/tags/v6.1` returns the tag *object* sha**, not
   the commit. The first build failed after ~8 minutes on
   `test "$(git -C linux rev-parse HEAD)" = "7614896..."`. The assertion was
   right and the pin was wrong. Peel with `refs/tags/v6.1^{}`. Annotated tags
   (linux, runc) peel; lightweight ones (tini, wasi-vfs) do not.
2. **macOS `dd bs=1m` errors**, and the first host baseline was
   `dd if=/dev/zero bs=1m count=32 2>/dev/null | shasum -a 256`. `2>/dev/null`
   ate the error, `shasum` hashed *nothing*, and it returned
   `e3b0c44298fc...` — the sha256 of the empty string — in 0.015 s. A number
   that looked like a result and was zero work. Caught only because
   `e3b0c442` is recognisable.
3. **busybox `date +%s%N` has no nanoseconds.** An in-guest timer built on it
   printed `0 ms` for both native and emulated runs. A perfect score, measuring
   nothing.

## 9. What a second person has to do

```
colima stop && colima start --cpu 10 --memory 24     # 2 vCPUs will not finish
bash scripts/wasm/build.sh alpine:3.21 ~/.cache/askk-wasm
cp ~/.cache/askk-wasm/out/alpine.wasm scripts/wasm/boot-probe/guest.wasm
bun scripts/wasm/serve-probe.ts                       # no COOP/COEP, port 4611
# then open http://localhost:4611/?cmd=uname%20-a  (or ?argv=sh,-c,<command>)
```

Requirements: Docker with buildx, Go (to build `c2w` from the pinned tree), and
patience. `scripts/wasm/PINS.env` holds every pin;
`scripts/wasm/README-UNPINNED.md` holds everything that is not pinned and what
happens when it goes. The 109 MB artifact is **not** committed —
`scripts/wasm/boot-probe/.gitignore` keeps it out.

## 10. What this does to §1's open questions

- **"WHAT WOULD CHANGE THIS" item 1** asked for a completed build, measured in
  bytes, booting in a browser in under ~5 s. **Half satisfied.** It builds, it
  boots in 0.8 s, and it costs 109 MB (40.6 MB gzipped) on the wire. Whether
  40 MB is acceptable against the cold-open test is a NORTH-STAR question, not
  a measurement one. It was not verified at a Pages subpath.
- **Item 2** asked for the build chain to be pinned. **Partly satisfied and
  honestly bounded.** Sixteen origins are content-pinned; `apt`, the Go proxy,
  crates.io and registry availability are not, and pinning is not vendoring.
- **Item 6** asked whether the 11.6:1 ratio is wrong. **It is wrong, in the
  direction that hurts.** 108:1 is not "slow"; a `cargo build` that takes a
  minute natively takes most of two hours. Anything an agent would plausibly
  run in a sandbox — install a package, compile, run a test suite — is out of
  reach, and that is a property of Bochs being an interpreter, not of this
  machine.
- **§5's disqualifying question** — does it need SharedArrayBuffer — is
  answered **no**, which is the one thing that would have killed it outright
  and does not.

The measurement is done and the numbers are on the table. What they are worth
against NORTH-STAR is the ringmaster's call, not this file's.
