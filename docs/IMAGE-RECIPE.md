# IMAGE-RECIPE — the guest the agent runs in, and how to rebuild it

`web/c2w/` is 48 MB of binary. It had no recipe; this is the recipe, and as of this
revision the build that produced the shipped runtime is **recorded, not reconstructed**
— see §0. Nothing here has been built: Docker was not running this round. Every number
is either **MEASURED** (from the shipped bytes, or from the sibling `Dev/wasmbox` build
logs and artifacts, which are on this machine and were re-measured here) or **MEASURE**
(the build round has to find out). Numbers are never guessed, and a citation you cannot
open is a bug — this document has been through one such failure already.

## 0. What is actually shipped today (measured, this round)

| file | on disk | decompressed | what it is |
|---|---:|---:|---|
| `out.wasm.gzip` | 36,631,864 | 106,879,126 | c2w runtime: Bochs + kernel + wizer snapshot. **No image inside it.** |
| `imagemounter.wasm.gzip` | 7,791,972 | 37,740,395 | Go/wasip1, pulls the OCI layout and serves it to the VM over 9p (upstream states it: `c2w-src/extras/imagemounter/README.md:11-12`) |
| `img/` | 3,847,875 | — | **stock `alpine:3.24.1` minirootfs, one layer, nothing added** |
| `dist/` + `vendor/` | 264 KB | — | runcontainerjs (upstream) + xterm-pty (vendored) |

`img/blobs/sha256/d529dd0c…` (the config) says it plainly: one layer,
`ADD alpine-minirootfs-3.24.1-x86_64.tar.gz /`, `CMD ["/bin/sh"]`, created
`2026-06-16T00:01:29.967161902Z`, layer `sha256:55afa1ec…`, diff_id `sha256:34884abb…`,
`Env` = `PATH` and nothing else. **There is no HARNESS image.** The owner deleted CheerpX
to gain control of the image and what shipped is upstream Alpine, untouched.

`IMAGE-AUDIT.md:172-173` could not reconcile "9p" with the baked kernel cmdline
`root=/dev/sr0 … ro`. Both are true and they are different mounts: `/dev/sr0` is c2w's own
boot ISO (kernel + initramfs + runc), and the *external* image rootfs is handed to the VM
over 9p by `imagemounter` — upstream states it in
`Dev/wasmbox/c2w-src/extras/imagemounter/README.md:11-12` ("External container image's
rootfs needs to be mounted to the VM via 9p"). Nothing to change in either doc but this
sentence.

### Provenance — every shipped byte, traced (MEASURED, this round)

The build was never lost; it was in a sibling repo. `Dev/wasmbox` on this machine holds
the artifact, the log and the image layout, and each matches `web/c2w/` **byte for byte**:

| shipped file | source | proof |
|---|---|---|
| `out.wasm.gzip` | `wasmbox/htdocs/any-wizer/out.wasm.gzip` | sha256 `03f332a5…` on both |
| ↳ decompressed | `wasmbox/out/e9-extbundle-wizer.wasm` | sha256 `edfa854a5d6dd9f781052c179f9ee2ed40e40f172504bcdb560d3498c168dd1d`, 106,879,126 bytes, on both |
| `imagemounter.wasm.gzip` | `wasmbox/htdocs/any-wizer/` | sha256 `2721d44a…` on both |
| `dist/` (3 files) | `wasmbox/htdocs/any-wizer/dist/` | `diff -rq` clean |
| `vendor/xterm-pty.js` | `wasmbox/htdocs/any-wizer/vendor/` | sha256 `d1c53f82…` on both |
| `vendor/xterm-pty-workerTools.js` | `wasmbox/mkhermes.sh:43-44` → `cdn.jsdelivr.net/npm/xterm-pty@0.9.4/workerTools.js` | sha256 `4455291d…` here and in `wasmbox/htdocs/hermes/vendor/` |
| `img/` | `wasmbox/images/alpine-base/` — exported by `wasmbox/mkimage.sh` on 2026-08-03T03:07:55Z (the `index.json` annotation) | `diff -r` reports IDENTICAL. The exact tag argument is not logged; `IMAGE-AUDIT.md:96` reads it as `alpine:latest`, which resolved to 3.24.1. **UNVERIFIED** which of the two spellings was typed. |

So `e9` is simply **wasmbox experiment 9** — `out/e1…e9` are that repo's numbered build
experiments; the name in the gzip header is the `OUTPUT_NAME` build-arg, nothing more.
`IMAGE-AUDIT.md` §7 item 1 recorded this as undeterminable; it is determined, and the audit's
§7 item 1 has been corrected to say so.

The flag set below is **read out of the build log**, not reconstructed. The subtraction
still corroborates it: wasmbox's `e6`, the same command with `OPTIMIZATION_MODE=native`
(`wasmbox/logs/e6-extbundle-wasi.log:1`), is 36,667,003 raw / 16,204,428 gz on disk against
our 106,879,126 / 36,631,864 — a difference of 70,212,123 raw and 20,427,436 gz, i.e. the
wizer snapshot, matching the increment-18 note ("+20MB gzipped").

## 1. The Dockerfile

Path: `image/Dockerfile`. **The file exists in the tree**; what follows is its
content, reproduced verbatim. It is not pinned by digest and it says so on the line
above the `FROM`: Docker was not running, so no digest could be resolved honestly,
and a placeholder that looks like a pin is worse than an admitted gap. `docker build`
runs this file as written.

```dockerfile
# syntax=docker/dockerfile:1
# The HARNESS guest. Not a workstation: it is the filesystem the ten tools in
# crates/agent/src/workspace.rs run their shell against, and nothing else.
#
# THERE IS NO NETWORK IN THIS GUEST. crates/adapters_web/src/c2w.js:92 boots
# ["/bin/sh"] and web/c2w/worker.js forwards only {info, args} — no
# c2w-net-proxy, no --net — so `apk add` at runtime cannot work. Whatever is
# not here at build time does not exist. That is why the package list is
# argued rather than convenient.
#
# Build it with docs/IMAGE-RECIPE.md §2b. Nothing else builds it.

# ---- base: upstream Alpine ------------------------------------------------
# TODO(pin): resolve and paste the digest, then this line becomes
#   FROM --platform=linux/amd64 alpine:3.24.1@sha256:<digest> AS base
# and the guest stops moving under us. It is UNRESOLVED: the tag alone is not
# reproducible, and Docker was not running when this file was written, so no
# honest digest could be obtained. Resolve it with:
#   docker buildx imagetools inspect alpine:3.24.1
# The guest shipped today is layer sha256:55afa1ec… (diff_id sha256:34884abb…,
# config created 2026-06-16T00:01:29Z) — web/c2w/img/blobs/sha256/d529dd0c….
# Record whether the digest you resolve still yields that layer.
FROM --platform=linux/amd64 alpine:3.24.1 AS base

# NO `apk add` LINE. Every binary the harness names is a busybox applet already
# in the minirootfs. The complete named-caller inventory, from the source:
#   /bin/sh, set, printf, kill, wait, test  ash builtins
#                                           (adapters_web/src/c2w.js:100,177;
#                                            core/src/process.rs, procwatch.rs)
#   stty                                    c2w.js:100 — `stty -echo` on the PTY
#   cat                                     kernel/workspace.rs:75
#   printf, base64, mkdir, dirname          kernel/workspace.rs:92;
#                                           core/src/procstart.rs:31
#   ls                                      kernel/workspace.rs:137 (`ls -1Ap`)
#   find, grep, head                        core/findfiles.rs:22-28
#   uname, cut, pwd, wc, awk, df            core/observe.rs:51-60
#   date, sleep, tail, rm, basename, tr     core/procstart.rs:31-35,
#                                           procwatch.rs:18,69-72,
#                                           proctable.rs:28-35
# Nothing in crates/ shells out to python3, node, git, curl, make or a compiler.
# `grep -I` (core/findfiles.rs:26) is the one applet flag under question — see
# docs/IMAGE-RECIPE.md §6 item 1.

# ---- flatten: one layer, and deletions that are real ---------------------
# THE WHITEOUT TRAP (IMAGE-RECIPE §4). c2w/imagemounter does not apply layer
# whiteouts, so a file removed in a later layer REAPPEARS in the guest. In the
# old hermes image that silently undid every trim: ~25,000 files where the
# build intended ~7,000. `FROM scratch` + `COPY --from` re-materialises the
# tree, so this stage is the only place a deletion can ever be honest. It is
# here from day one even though nothing is deleted yet, because the first `rm`
# added above it would otherwise no-op and no test would catch it.
FROM --platform=linux/amd64 scratch
COPY --from=base / /

# TERM: c2w.js:188-189 strips escape sequences out of every capture, so the
#   guest may emit them; `linux` is terminfo busybox already carries.
# LANG: C.UTF-8 so the model's UTF-8 output survives the round trip.
# HOME: procstart writes .harness/proc/<name>/ relative to the workspace, but
#   an interactive `cd` with no argument must land somewhere that exists.
# PATH: the minirootfs default, restated rather than inherited — it is the
#   only Env the shipped OCI config carries today.
ENV TERM=linux LANG=C.UTF-8 HOME=/root \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
WORKDIR /root
# c2w.js:92 passes ["/bin/sh"] explicitly and overrides this. It is set anyway
# so the image is runnable under plain `docker run` for the unit check.
CMD ["/bin/sh"]
```

**What this file buys, honestly.** It adds no bytes and removes none, and it is **not
yet pinned** — the `FROM` carries a tag and a `TODO(pin)`, which is one build round away
from being a digest. What it buys today is that the guest becomes *one-layer, described,
and ours*: today's `img/` is whatever `alpine:latest` resolved to when
`wasmbox/mkimage.sh alpine-base alpine:latest` ran on 2026-08-03 (§0), which can be
re-exported but not reproduced, because the tag has moved since. What it buys tomorrow —
and this is the larger half — is that the flatten stage makes a deletion real, which is
the precondition for §6 item 3, the 2.7 MB the guest is currently carrying for nothing.

**What is deliberately NOT in it.** `python3`, `git`, `curl`, `build-base`: no
caller in `crates/`. But the product *names* them to the model in two places, both
opened and verified:

- `crates/core/src/process.rs:67` — the refusal a model gets when it calls
  `start_process` with no command teaches it the shape by example:
  `start_process({"name": "web", "command": "python3 -m http.server"})`.
- `crates/ui/src/examples.rs:29` — the `laps` starter task, a button a *person*
  presses, reads "check whether python3, node and git are there, write what you found
  to tools.md…". The honest answer in this guest is "none of them".

The test fixtures agree on the same example (`crates/core/tests/environment.rs:73`,
`crates/core/tests/findings18.rs:183`, `crates/core/src/proctable.rs:133`), so the
example is load-bearing across the codebase, not a stray string.

That is a real product defect and it is **reported, not fixed here**: the fix is either
the package or the sentence, and it is the owner's call which. See §6 item 4 for what a
package would cost, now measured.

*(An earlier revision of this document cited `crates/core/src/procstart.rs:67` for this.
That citation was false — `procstart.rs:67` is `blank_as(rest, "(nothing)")` and the file
contains no `python`. Every other citation in this document has since been opened and
checked; the four others that were also wrong are corrected in place, and all five are
listed in §7.)*

## 2. The exact c2w invocation

Three artifacts, three cadences. The point of `--external-bundle` is that only the
middle one moves when the image changes.

### 2a. Runtime wasm — rebuild only when c2w itself changes

This is **the command that produced the shipped bytes**, not a reconstruction. It is
recovered from `Dev/wasmbox/logs/e9-extbundle-wizer.log:1` (the buildx argv c2w logs on
every run, dated `2026/08/13 13:01:32`) and `Dev/wasmbox/build.sh:36-41` (the wrapper that
supplies `--assets`/`--dockerfile` and drops the image argument for external bundles):

```bash
C2W_SRC=/path/to/container2wasm      # pinned checkout, commit 3f0f9be
c2w --assets "$C2W_SRC" --dockerfile "$C2W_SRC/Dockerfile" \
    --external-bundle \
    --build-arg VM_MEMORY_SIZE_MB=512 \
    --build-arg OPTIMIZATION_MODE=wizer \
    out/runtime.wasm
wasm-tools strip -a out/runtime.wasm -o out/runtime.stripped.wasm   # §6 item 9
gzip -9 -c out/runtime.stripped.wasm > web/c2w/out.wasm.gzip
```

(The shipped file has neither the strip nor the `-9`. Both are post-build, both are
measured, and together they are 857,408 bytes — see §6 item 9.)

The log records the full build-arg set that reached buildx:

```
--build-arg TARGETARCH=amd64 --build-arg TARGETPLATFORM=linux/amd64 --platform=linux/amd64
--build-arg OUTPUT_NAME=e9-extbundle-wizer.wasm
--build-arg LINUX_LOGLEVEL=0 --build-arg INIT_DEBUG=false
--build-arg EXTERNAL_BUNDLE=true
--build-arg VM_MEMORY_SIZE_MB=512 --build-arg OPTIMIZATION_MODE=wizer
```

Four of those are **c2w defaults, not choices**, and the source says so:
`c2w-src/cmd/c2w/main.go:45-48` defaults `--target-arch` to `amd64` (hence `TARGETARCH` /
`TARGETPLATFORM`), and `main.go:231-238` emits `LINUX_LOGLEVEL=0` + `INIT_DEBUG=false`
unless `--debug-image` is passed. `OUTPUT_NAME` is just the destination filename — which
is the whole of what `e9` "denotes". So exactly three flags are deliberate:
`--external-bundle`, `VM_MEMORY_SIZE_MB=512`, `OPTIMIZATION_MODE=wizer`.

- `--assets` + `--dockerfile` pointing at a **local checkout**: not a preference.
  The Homebrew `c2w`'s embedded Dockerfile clones upstream at tag `v0.8.4`, and
  upstream deleted every tag — `git ls-remote --tags` returns nothing — so a stock
  `c2w` invocation dies at the assets stage. This flag bypasses that stage.
- `--target-arch amd64` is **the default** and was not passed. It selects the
  WASI/Bochs path. The alternative, `--to-js`, is QEMU TCG and was measured: 4.2x faster
  on sha256, **2.6x slower on shell loops**, 19s boot. This agent's workload is shell
  loops. It also emits a directory with different JS glue that
  `crates/adapters_web/src/c2w.js` does not speak, and needs a different vendored
  xterm-pty (§6 item 8).
- `--external-bundle`: embeds no image at all. This is the architecture — adding a
  package re-exports a few MB of OCI layout and leaves the 36.6 MB runtime cached.
- `OPTIMIZATION_MODE=wizer`: pre-boots the kernel into the module. Costs 20.4 MB gz,
  buys boot 26.7s → 3.16s (increment 18, and 23.96s → 2.71s in wasmbox). Correct
  **because** `web/sw.js` caches the runtime; on a cold first load over 20 Mbps the
  20 MB costs more seconds than the 21s it saves, and `native` would win instead.
- `VM_MEMORY_SIZE_MB=512`: this is the wasm linear memory the tab commits, and it is
  the *only* mobile lever. It is almost irrelevant to download size (measured: 512 → 128
  moved the module only 110 → 105 MB) but it moves the **declared memory minimum**
  almost one-for-one: 9,378 pages (586.12 MiB) at 512, 3,224 pages (201.50 MiB) at 128,
  measured this round by parsing the memory section of `wasmbox/out/e1-bochs-wasi.wasm`
  and `e5-ram128.wasm`. That is the number that decides which devices can run this.
  See §5.
- Do **not** raise it to 2048 while wizer is on: the build-time wasmtime pre-boot
  traps out-of-bounds. That combination is unbuildable.
- `gzip -9`: the page fetches `out.wasm.gzip` and decompresses it in JS — this is a
  file, not `Content-Encoding` — so the level is ours and -9 is free at build time.
  **The shipped file was not built with -9.** Measured this round on the identical
  input: `gzip -6` (the default) gives 36,631,864 bytes, which is the shipped file
  exactly; `gzip -9` gives 36,285,390. Using the level this recipe already prescribes
  saves **346,474 bytes** for no functional change and no build change. See §6 item 9.

### 2b. Image — rebuild whenever `image/Dockerfile` changes

```bash
docker buildx inspect harness >/dev/null 2>&1 || \
  docker buildx create --name harness --driver=docker-container
rm -rf web/c2w/img && mkdir -p web/c2w/img
docker buildx build --builder=harness --platform linux/amd64 \
    -f image/Dockerfile \
    --output type=oci,compression=gzip,force-compression=true,dest=- \
    image/ | tar -C web/c2w/img -xf -
```

- `--driver=docker-container`: the default docker driver cannot export OCI layouts.
- `--platform linux/amd64`: the guest is Bochs x86_64. On an Apple-silicon host the
  default is arm64 and the container simply will not boot.
- `type=oci`: produces `oci-layout` + `index.json` + `blobs/sha256/` — byte-for-byte
  the shape `web/c2w/img/` already has and `imagemounter` expects.
- `compression=gzip,force-compression=true`: **not optional, both halves.** estargz
  layers make imagemounter fail with `Junk found after end of compressed data`; and
  buildx happily reuses layers it converted to estargz on an earlier run, so without
  `force-compression` a plain re-export silently keeps the stargz TOC footers.

### 2c. Supporting files — copied, not built here

- `imagemounter.wasm.gzip`: `make imagemounter.wasm` in the c2w checkout
  (`GOOS=wasip1 GOARCH=wasm go build`), then gzip. Ours is byte-identical to wasmbox's
  (sha256 `2721d44a…`), so it has never been rebuilt. **It is gzip `-6`, not `-9`**,
  measured this round the same way as `out.wasm.gzip`: re-compressing the identical
  payload gives 7,791,954 at `-6` (the shipped file is 7,791,972, the 18 bytes being the
  header's stored filename) and **7,663,148 at `-9`** — another **128,824 bytes** free,
  with no rebuild, since re-gzipping a `.gz` is lossless.
- `dist/{runcontainer,stack-worker,worker-util}.js`: `extras/runcontainerjs/dist`,
  checked in upstream.
- `vendor/xterm-pty.js`, `vendor/xterm-pty-workerTools.js`: **xterm-pty 0.9.4**, and
  the version is not a detail — see §6 item 8. `workerTools.js` came from
  `https://cdn.jsdelivr.net/npm/xterm-pty@0.9.4/workerTools.js`
  (`Dev/wasmbox/mkhermes.sh:43-44`) and our copy is byte-identical to the one that curl
  produced. They **must** be local: the page is COEP `require-corp` and
  `importScripts()` is a no-cors request, so a CDN copy with no CORP header kills the
  container worker with no console error and no output at all
  (`web/c2w/worker.js:5-14` states the same thing at the call site).

`publish.sh:55-58` gates the five paths and `publish.sh:59-60` gates a non-empty `img/`;
`63-64` rejects an `out.wasm.gzip` under 1 MB and `67-68` anything ≥ 99 MB.

## 3. Size budget

Fixed cost, cached forever, independent of the image:

| | as served |
|---|---:|
| `out.wasm.gzip` (external bundle, wizer) | 36.6 MB **MEASURED** |
| — of which the wizer snapshot | 20.4 MB **MEASURED by subtraction** |
| `imagemounter.wasm.gzip` | 7.8 MB **MEASURED** |
| `dist/` + `vendor/` | 0.26 MB **MEASURED** |
| **fixed subtotal** | **44.7 MB** |

Per-image cost, the only thing this Dockerfile moves:

| | as served | basis |
|---|---:|---|
| shipped `img/` (stock alpine 3.24.1) | 3.85 MB | **MEASURED** |
| this Dockerfile, flattened, no packages | 3.7–4.0 MB | **MEASURE.** `docker export`/re-import re-tars and re-gzips; wasmbox saw a flatten come out *smaller* (86 → 79 MB on a large image). Expect ±0.2 MB here, do not claim it. |
| **expected total** | **≈ 48.5 MB** | matches the "~48 MB" in `crates/adapters_web/src/c2w.rs:5` |

**The one real size lever is wizer, and it is already spent deliberately.**
`OPTIMIZATION_MODE=native` takes the total from 48.5 MB to **28.1 MB** (-42%) and
boot from 3.16s to 26.7s. Nothing else in the shipped bytes is remotely that size.
The 47 MB is the engine, not the OS, and this Dockerfile cannot shrink it.

**But "trimming Alpine buys nothing" was wrong, by 7–13x, and it was an estimate this
document had no business making.** `IMAGE-AUDIT.md:105` measured the OpenSSL stack
(`libcrypto.so.3` + `libssl.so.3` + `ca-certificates.crt` + `ossl-modules/` + `engines-3/`
+ `ssl_client`) at **2,463,052 bytes gz — 66.2 % of the guest**, and `IMAGE-AUDIT.md:112-113`
measured a floor of **2,691,781 bytes (72.4 % of the guest)** for a guest cut to
busybox + musl + baselayout. Against the 48,531,419-byte total that is **5.5 %** — not
"under 1 %". The trim set this document proposed (`apk-tools` + `ssl_client` +
`/usr/share/apk`) explicitly excluded `libcrypto3`/`libssl3`/`ca-certificates-bundle`,
which is the single largest thing in the guest. Those are relative magnitudes measured by
exclusion against a control re-tar (`IMAGE-AUDIT.md:99-101`), so treat the 2.46 MB as a
magnitude, not a to-the-byte promise — but the magnitude is not in doubt.

The three free or near-free savings, ranked, all measured:

| | bytes off the shipped total | how |
|---|---:|---|
| trim the guest to busybox + musl + baselayout | ~2,691,781 | `rm` in the `base` stage, before the flatten (§4); needs a build round (§6 item 3) |
| strip DWARF from `out.wasm`, then `gzip -9` | 857,408 | post-build, no rebuild (§6 item 9); of which 346,474 is the gzip level alone |
| `gzip -9` the existing `imagemounter.wasm.gzip` | 128,824 | post-build, no rebuild (§2c) |

Together ≈ **3.68 MB, about 7.6 %** of the 48,531,419 shipped. Two of the three rows need
no Docker at all. That is real, and it is still an order of magnitude below the wizer
trade — both statements are true at once, and only the second one was in this document
before.

## 4. Traps, from this project's own history

**Applies — layer whiteouts are not honoured.** The bug that broke the hermes guest:
imagemounter does not apply whiteouts, so a file deleted in a later layer reappears.
`uvloop`, `pip` and 148 `__pycache__` dirs were all present despite being removed;
~25,000 files where the build intended ~7,000. Only *additions* ever take effect.
The `FROM scratch` + `COPY --from` stage in §1 is the whole mitigation and it must
never be removed. The old ASKK build's `docker export | docker import` did the same
job by another route.

**Applies — estargz breaks the mounter.** `compression=estargz` yields
`Junk found after end of compressed data`. Lazy pull is not available on this path;
layers download whole. `force-compression=true` is required because buildx caches
converted layers.

**Applies — Homebrew `c2w` cannot build anything.** Upstream deleted every tag its
embedded Dockerfile clones. `--assets` at a local checkout is mandatory. **That
checkout is not in this repository** — it lives only in `Dev/wasmbox/c2w-src` at
commit `3f0f9be`. Until it is vendored or pinned here, this recipe is still not
fully self-contained. See §6 item 6.

**Applies — wizer traps at high guest RAM.** `OPTIMIZATION_MODE=wizer` with
`VM_MEMORY_SIZE_MB=2048` traps out-of-bounds during the build-time wasmtime run.
512 builds; the ceiling between them is unmeasured.

**Applies — persistence is refused, on measurement.** Tarring the workspace out
through the PTY runs at ~79 KB/s: a 5 MB workspace is 63 seconds on every debounce
*and* every boot, during which no agent can run anything. So the root stays
`overlay … upperdir=/run/rootfs-upper` on tmpfs, `WorkspacePort::durable()` returns
false, and **the image must never grow a persistence layer.** Nothing written in the
guest survives a reload; that is a stated product fact, not a gap.

**Applies — GitHub's 100 MB file cap.** `out.wasm.gzip` at 36.6 MB is fine, but a
non-external-bundle wizer build (126 MB gz, historically) needs splitting.
`publish.sh` refuses anything ≥ 99 MB.

**Does not apply — `LOAD_MODE=separated`.** Recorded so nobody tries it: it is
undocumented and broken upstream. Payloads land at `/image`, `/rootfs`, `/bios`
while the generated args still reference `/pack/*`; `-incoming file:/pack/vm.state`
is emitted although `vm.state` is never shipped; `efi-virtio.rom` is missing so
`virtio-net-pci` aborts. Even patched in-page it dies with
`RuntimeError: function signature mismatch`. Use the default.

**Does not apply — the ingressd `http_proxy` and service-worker orphan traps.**
Those belong to the hermes relay. HARNESS boots `/bin/sh` with no network stack.

## 5. "Runs on any device" — what actually constrains it

Four hard gates, in the order a device hits them.

1. **SharedArrayBuffer, therefore cross-origin isolation.**
   `crates/adapters_web/src/c2w.js:73` throws
   `"this page is not cross-origin isolated, so SharedArrayBuffer is unavailable"`
   before it loads anything. GitHub Pages
   cannot send COOP/COEP, so `web/coi-sw.js` synthesises them from a service worker
   — which means **the first visit must register the worker and reload**, and any
   context where the SW cannot take over (some private-browsing modes, an iframe
   embed, a browser with SW disabled) is excluded outright, not degraded.
2. **Memory. This is the real exclusion, and the number is now measured — but only
   as a property of the module, never on a device.** File size is not what decides
   "runs on any device"; the **declared wasm memory minimum** is, because a wasm memory
   with a minimum and no maximum must be allocated in full at instantiation before a
   single guest instruction executes. Measured this round by parsing the memory section
   of each module (`section id 5`, limits flag 0 = no maximum):

   | module | flags | declared minimum |
   |---|---|---:|
   | `e9-extbundle-wizer` — **what we ship** | extbundle, wizer, RAM 512 | **9,244 pages = 577.75 MiB (605,847,552 bytes)** |
   | `e1-bochs-wasi` | embedded image, wizer, RAM 512 | 9,378 pages = 586.12 MiB |
   | `e5-ram128` | embedded image, wizer, **RAM 128** | 3,224 pages = 201.50 MiB |
   | `e6-extbundle-wasi` | extbundle, **native**, RAM 512 | 820 pages = 51.25 MiB |
   | `e4-nowizer` | embedded image, **native**, RAM 512 | 954 pages = 59.62 MiB |

   This reproduces `IMAGE-AUDIT.md:58-59` independently and adds the four comparisons.
   Read down it: **the 577.75 MiB is the wizer snapshot, and `VM_MEMORY_SIZE_MB` sets
   it.** Without wizer the floor is 51 MiB. With wizer the floor is roughly guest RAM
   plus ~80–90 MiB of emulator (512 MB → 586 MiB, 128 MB → 201 MiB).

   On top of the allocation the tab holds the 36.6 MB fetch and the 106,879,126-byte
   decompressed module while it instantiates, so peak is roughly **710 MB**, not the
   "620 MB" this section previously guessed.

   **Which devices that excludes, concretely.** Any browser that cannot hand one tab a
   single 605,847,552-byte contiguous linear-memory allocation *plus* ~107 MB of
   JS-side buffer: that means every 32-bit browser build (armv7 Android, 32-bit
   Windows Chrome), where a 578 MiB contiguous reservation inside a 2–4 GB user
   address space is unreliable rather than merely large; and iOS/iPadOS, where the
   per-tab budget is enforced by the OS, not the engine. **Mobile Safari is expected to
   fail** and it fails the worst possible way: iOS kills the tab with no exception and
   no console message, so it reads as "the page crashed", not "out of memory". Every
   iOS and iPadOS browser is WebKit, so there is no Chrome-on-iPhone escape. Android
   Chrome on a 64-bit device with ≥ 4 GB RAM is plausible and untested.
   **Nobody has run this on a phone. Do not claim it works** — the table above is a
   fact about the artifact, not about any device (`IMAGE-AUDIT.md:206-207`).
3. **One core, on every device.** Bochs is a pure x86 interpreter on a single
   thread; the guest reports `nproc` = 1 whether the host has 4 cores or 16, and
   `VM_CORE_NUMS` cannot help because extra guest cores round-robin onto the same
   host thread. Measured at ~276x native on a shell loop. So "runs on any device" is
   true in an unusual sense: a phone and a workstation get the *same* machine, and
   the only variable is single-core clock.
4. **48 MB cold.** On mobile data that is the gate, long before CPU is. It caches
   in the service worker and a repeat visit is free — which is exactly the argument
   that justifies wizer, and exactly the argument that fails a first-time visitor.

**The lever for gate 2 is `VM_MEMORY_SIZE_MB`, and it is nearly free — now with the
number.** 512 → 128 moved the module only 110 → 105 MB on disk, because the wizer
snapshot tracks what the kernel touched, not what was allocated; but it moved the
declared minimum **586.12 MiB → 201.50 MiB**, a 384.6 MiB cut in what the tab must
allocate, measured above. So a mobile-viable build is a *guest RAM* change, not an image
change, and it is the single highest-leverage setting in this document for the stated
goal. What it costs is the tmpfs the workspace lives in — the root is
`overlay … upperdir=/run/rootfs-upper` on guest RAM
(`crates/adapters_web/src/c2w.rs:24`), so 128 MB of guest RAM is 128 MB of everything.
Whether this image boots and survives a `start_process` at 128 is **unmeasured** (§6
item 5).

## 6. The open list — and the five items this revision closed

Items 3, 4, 6, 8 and 9 were open when this document failed review; each is now measured
or resolved, and each says which. Items 1, 2, 5 and 7 still need Docker.

1. **`grep -I` in busybox.** `core/findfiles.rs:26` emits `grep -IHns -m1 -e`. If
   Alpine's busybox grep does not take `-I`, every `find_files` call with a `text`
   argument fails. One command in the guest settles it:
   `find . -type f -exec grep -IHns -m1 -e x {} + ; echo $?`. If it fails, the
   minimal image gains exactly one package — GNU `grep`, ~250 KB — and that package
   then has a named caller. Check `find … -exec … +` in the same command.
2. **The flattened layer size.** Expected 3.7–4.0 MB gz. If it lands materially
   above 3.85 MB the flatten is costing bytes and the trade needs restating.
3. **Trimming the guest — MEASURED, and the recommendation is reversed.** No longer a
   prediction: `IMAGE-AUDIT.md:105` puts the OpenSSL stack at **2,463,052 bytes gz,
   66.2 % of the guest**, and `IMAGE-AUDIT.md:112` puts the busybox + musl + baselayout
   floor at **2,691,781 bytes, 72.4 % of the guest and 5.5 % of the shipped total**.
   The earlier "0.2–0.4 MB, under 1 %" was an estimate this document should not have
   made; it was low by 7–13x.

   **The escape-hatch argument does not survive being checked.** It said: keep `apk`
   because it is the last way to add something to a guest with no network. But there is
   no network (`crates/adapters_web/src/c2w.js:92` boots `["/bin/sh"]` with no proxy and
   no net flag; `IMAGE-AUDIT.md:139-141`) and the rootfs is mounted read-only
   (`root=/dev/sr0 … ro`, `IMAGE-AUDIT.md:70-71`). `apk` in this guest cannot install
   anything from anywhere onto anything. It is not an escape hatch; it is 197,098 bytes
   of a door with no wall. The same goes for the OpenSSL stack: nothing in the toolset
   does TLS in-guest and nothing could reach a server if it did.

   So: **trim**, in the `base` stage above the flatten, gated on one build-round check.
   The trim set, largest first:
   `libcrypto.so.3`, `libssl.so.3`, `ssl_client`, `ca-certificates.crt`,
   `/usr/lib/ossl-modules/`, `/usr/lib/engines-3/`, `sbin/apk`, `libapk.so.3`,
   `/lib/apk/`, `/etc/apk/`, `/usr/share/apk`, `scanelf`.
   **The check that gates it:** boot the trimmed image and run the full applet
   inventory from `image/Dockerfile`. Alpine's busybox links only musl, so it should be
   untouched — but that is a reasoned expectation, **not a measurement**, and removing
   `libcrypto` from under a busybox that turned out to want it is a guest that does not
   boot. Measure, then keep.
4. **The `python3` question.** Not a size question, a product one — see §1, where the
   two places the product names `python3` to a model are now cited correctly
   (`crates/core/src/process.rs:67`, `crates/ui/src/examples.rs:29`). The measured
   neighbour, re-measured this round rather than quoted: `Dev/wasmbox/images/alpine-lean`
   — `FROM alpine:latest` + `apk add --no-cache python3 git curl`
   (`wasmbox/images/lean.Dockerfile`) — is **26,022,838 bytes** of OCI layout against
   `alpine-base`'s 3,847,875, i.e. **+22,174,963 bytes for the three together**.
   (`alpine-dev`, which adds `vim` and `build-base`, is 133,760,701 — for scale.)
   `python3` **alone is still unmeasured**; do not assume a share of the 22 MB, measure
   it. All three would take the shipped total from 48.5 MB to ~70 MB, which is the
   number the owner is actually being asked to rule on.
5. **The guest RAM floor.** Find the lowest `VM_MEMORY_SIZE_MB` at which this image
   boots to a shell and survives a `start_process`, then measure real tab commit at
   that setting on an actual phone. Both halves, or the mobile claim stays unmade.
6. **Reproducing the runtime — half answered, half open.** The command is no longer
   unknown: it is in §2a, read out of `Dev/wasmbox/logs/e9-extbundle-wizer.log:1`, and
   the artifact it produced is byte-identical to what we ship (§0). What is still open
   is whether re-running it reproduces those bytes, and that is now a *bit-for-bit
   reproducibility* question rather than an archaeology one. Two things stand between
   this repo and a self-contained build and neither is measured:
   **(a)** the c2w checkout is not here — it lives only in `Dev/wasmbox/c2w-src` at
   commit `3f0f9be`, and upstream deleted every tag, so nothing in this repository can
   fetch it; **(b)** the build pulls `docker/dockerfile:1.5` and a Linux kernel source
   at build time, and the shipped snapshot contains a kernel built
   `Thu Aug 13 17:14:57 UTC 2026` (`IMAGE-AUDIT.md:67`), so an identical rebuild is
   unlikely without pinning those too. Vendor or submodule the checkout; then rebuild
   and record whether the output still hashes to
   `edfa854a5d6dd9f781052c179f9ee2ed40e40f172504bcdb560d3498c168dd1d`.
7. **The Alpine digest.** `alpine:3.24.1` has moved since 2026-06-16. Pin whatever
   the build round pulls and record whether the layer still hashes to
   `sha256:55afa1ec…`. If not, the guest changed under us at some point and nobody
   would have known — which is the failure this whole document exists to end.
8. **The vendored `xterm-pty` version — ANSWERED, and it is a trap, not a detail.**
   It is **0.9.4**, established two ways: `Dev/wasmbox/mkhermes.sh:43-44` fetched
   `workerTools.js` from `cdn.jsdelivr.net/npm/xterm-pty@0.9.4/workerTools.js` and our
   copy is byte-identical to that file (sha256 `4455291d…`); and our `xterm-pty.js`
   exports the `Termios` and `TtyServer` globals, which is the 0.9.4 API.
   `Dev/wasmbox/RESULTS.md:242-247` records the trap in full: **the WASI page requires
   0.9.4** (0.10.1 removed `Termios`/`TtyServer`) while **the QEMU/emscripten page
   requires 0.10.1** (`-lemscripten-pty.js`), and using one for the other fails
   *silently* in one direction (the page loads and never fetches the runtime) and
   loudly in the other (`function signature mismatch`). An earlier revision of this
   document knew only the QEMU half and called the WASI half unknown. Pin
   `xterm-pty@0.9.4` in whatever vendors it, and do not "upgrade" it.
9. **The DWARF in `out.wasm` — MEASURED, safe, and free.** The shipped module carries
   **2,287,619 bytes** across eight `.debug_*` custom sections (`.debug_str` 855,091,
   `.debug_info` 685,455, `.debug_pubnames` 330,614, `.debug_ranges` 185,838,
   `.debug_pubtypes` 150,687, `.debug_line` 36,733, `.debug_abbrev` 35,042,
   `.debug_loc` 8,159 — reproduced this round, matching `IMAGE-AUDIT.md:53`). Stripping
   them is safe for a reason the spec gives: custom sections carry no semantics and an
   engine must ignore the ones it does not know, and these are the *only* custom
   sections in the module — there is no `name` section to lose. Verified rather than
   asserted: `wasm-tools strip -a` yields 104,591,333 bytes, `wasm-tools validate`
   passes on the result, and `gzip -9` of it is **35,774,456** against the shipped
   36,631,864 — **857,408 bytes (2.34 %) off every visitor's first load**, of which
   346,474 is the `gzip -9`/`-6` difference alone (§2a). What is lost is DWARF for the
   Bochs emulator in browser devtools, which nobody here debugs. Add
   `wasm-tools strip -a` between the build and the `gzip` in §2a — and note it is a
   *post-build* step, so it needs no rebuild and could be applied to the shipped file
   today. (`IMAGE-AUDIT.md:87-89` says 35,774,460 / 857,404 for the same operation; the
   four bytes are the gzip header's stored filename, which differs between `gzip -9 -c`
   and `gzip -9 <file>`. Same measurement, both correct.)

## 7. Citation audit — every reference in this document, opened

A bar-raiser found `crates/core/src/procstart.rs:67` cited for a claim that file does not
make. One invented reference makes every other reference in a document that promises
"numbers are never guessed" unverifiable by default, so all of them were opened.

**Thirty distinct references were opened. Five were wrong; all five are corrected
above. A sixth was imprecise rather than wrong** — "wasmbox's alpine + python3 + git +
curl at 25 MB" is 26,022,838 bytes, restated exactly in §6 item 4.

| was | is | how wrong |
|---|---|---|
| `crates/core/src/procstart.rs:67` shows `python3 -m http.server` | `crates/core/src/process.rs:67` does; `procstart.rs:67` is `blank_as(rest, "(nothing)")` and the file has no `python` | **fabricated** — wrong file, and it was the sole evidence under an escalation to the owner |
| `c2w.rs:8` says "~48 MB" | `crates/adapters_web/src/c2w.rs:5` | off by three lines |
| `publish.sh:55-64` gates five paths + `img/` | `55-58` paths, `59-60` `img/`, `63-64` size floor | range conflated three separate gates |
| `web/c2w/worker.js` boots `["/bin/sh"]` | `crates/adapters_web/src/c2w.js:92` does; `worker.js` only forwards `{info, args}` | right fact, wrong file |
| `img/` totals 3,847,265 | 3,847,875 (`find -type f`) | omitted the 611-byte config blob — the discrepancy `IMAGE-AUDIT.md:169-171` flagged |

Verified correct and left alone (spot list, not exhaustive):
`crates/agent/src/workspace.rs:25-104` (the ten tools, and only those ten);
`crates/core/src/findfiles.rs:26` (`-exec grep -IHns -m1 -e … +`, verbatim);
`crates/core/src/observe.rs:51-60` (`printf`/`cut`/`pwd`/`ls`/`wc`/`awk`/`df`);
`crates/core/src/procstart.rs:31-35`, `procwatch.rs:18,69-72`, `proctable.rs:28-35`
(`date`/`sleep`/`tail`/`rm`/`basename`/`tr`/`base64`);
`crates/adapters_web/src/c2w.js:73` (the cross-origin-isolation throw), `:92`
(`["/bin/sh"]`), `:100` (`set +m; stty -echo`), `:188-189` (escape stripping);
`crates/adapters_web/src/c2w.rs:24` (`overlay … upperdir=/run/rootfs-upper`), `:84-85`
(`durable()` returns false); `web/sw.js:30-31,85` (the c2w runtime in its own long-lived
cache); `publish.sh:67-68` (≥ 99 MB refused); `img/blobs/sha256/d529dd0c…` (layer
`55afa1ec…`, diff_id `34884abb…`, created 2026-06-16); `Dev/wasmbox/c2w-src` at commit
`3f0f9be`.

**Still unverified, and marked as such rather than dropped:** the ADR/commit claims
carried over from `d16048c` — boot 26.7s → 3.16s, the 13–15x compute penalty, the
~79 KB/s persistence measurement, the `--to-js` 4.2x/2.6x A/B, the `LOAD_MODE=separated`
failure modes, the estargz `Junk found after end of compressed data`, and the
"wizer + 2048 MB traps out-of-bounds" ceiling. Each was measured by a previous round on a
running Docker and none of them can be re-checked from bytes on disk. They are cited to
their source, not re-derived here.
