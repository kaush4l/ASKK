# IMAGE-AUDIT — what is actually in `web/c2w`

Byte-level accounting of the shipped container2wasm artifact, ordered largest first.
Goal it is measured against, verbatim: *"our goal will be to build the smallest most
efficient image that run on any device."*

**Every number below was measured on the artifact in the tree.** Nothing is estimated.
Docker was not running and no image was built; this is inspection only. Method: `gzip -l`,
a WebAssembly section-table parser over the decompressed modules, `tar` + `gzip -9` over
the unpacked OCI layer, and `strings` over the reconstructed data section. Parsers are in
the session scratchpad, not committed. Feeds roadmap item 4 in `docs/STATUS.md`
("minimal image + its recipe", IN FLIGHT).

## 1. The headline

| | bytes | share |
|---|---:|---:|
| **Emulator** (`out.wasm.gzip` + `imagemounter.wasm.gzip` + `dist/` + `vendor/` + `worker.js`) | 44,683,544 | **92.07 %** |
| **Guest** (`img/` — the Linux the agent actually runs in) | 3,847,875 | **7.93 %** |
| total on disk | 48,531,419 | 46.28 MiB |

The emulator outweighs the guest **11.6 : 1**. Shrinking the guest cannot move the total
much; the 92 % is where the size is. This is the single most important finding, and it
inverts the intuition that "the image" is the thing to make smaller.

## 2. The 47 MB, largest first

| # | path | bytes | % | what it is | agent need? |
|---|---|---:|---:|---|---|
| 1 | `out.wasm.gzip` | 36,631,864 | 75.48 | Bochs x86 emulator + Linux 6.1.0 + wizer boot snapshot | **partly** — see §3 |
| 2 | `imagemounter.wasm.gzip` | 7,791,972 | 16.06 | Go program that mounts the OCI blob as `/dev/sr0` | **yes**, as built |
| 3 | `img/blobs/sha256/55afa1ec…` | 3,846,391 | 7.93 | the whole guest: stock Alpine 3.24.1 minirootfs | **26 % of it** — see §4 |
| 4 | `dist/stack-worker.js` | 98,960 | 0.20 | c2w worker glue | yes |
| 5 | `dist/worker-util.js` | 91,244 | 0.19 | c2w worker glue | yes |
| 6 | `dist/runcontainer.js` | 41,402 | 0.09 | c2w boot entry | yes |
| 7 | `vendor/xterm-pty.js` | 18,980 | 0.04 | PTY protocol (the exec bridge) | yes |
| 8 | `vendor/xterm-pty-workerTools.js` | 7,776 | 0.02 | PTY worker half | yes |
| 9 | `worker.js` | 1,346 | 0.00 | our own worker shim | yes |
| 10 | `img/` metadata (`index.json`, `oci-layout`, manifest, config) | 1,484 | 0.00 | OCI descriptors | yes |
| | **total** | **48,531,419** | 100 | | |

Sum verified against `find . -type f`: 48,531,419 bytes exactly (46.28 MiB).

## 3. Inside `out.wasm` — the dominant 75 %

Decompresses to **106,879,126 bytes** (2.92× ratio). Internal name recorded in the gzip
header: `e9-extbundle-wizer.wasm`, mtime 2026-08-13 17:18:18.

| section | bytes | % of module | what |
|---|---:|---:|---|
| `data` | 101,514,996 | **94.98** | pre-booted memory snapshot |
| `code` | 3,063,531 | 2.87 | **the actual emulator** |
| `.debug_*` (8 custom sections) | 2,287,619 | 2.14 | DWARF debug info |
| everything else | 12,980 | 0.01 | types, imports, elements, exports |

**The emulator is 3 MB. The other 101.5 MB is a memory image.** The `data` section is
**100,000 segments** written into a linear memory whose declared minimum is **9,244 pages
= 577.8 MiB (605.8 MB)**, with no maximum. 78,891 of those segments are ≤ 64 bytes and the
median segment is 40 bytes — the scatter signature of a wizer snapshot diff, not of a
normal image payload.

What the snapshot contains, by `strings` over the reconstructed 100,687,924 payload bytes:

- **Bochs 2.7** BIOS and VGA BIOS (`BIOS Bochs 2.7 29/12/2019`, `_BOCHSCPU0.1`) — the CPU
  emulator is Bochs, an interpreter. This is the 13–15× compute penalty recorded in
  `d16048c`; it has no lever.
- **Linux 6.1.0**, built `Thu Aug 13 17:14:57 UTC 2026` by `root@buildkitsandbox` with
  gcc 11.4.0 (Ubuntu 22.04) — produced in a BuildKit sandbox the day it was committed.
- Kernel command line, baked:
  `BOOT_IMAGE=/boot/grub/bzImage console=hvc0 root=/dev/sr0 rootwait ro
  virtio_net.napi_tx=false quiet loglevel=0 init=/sbin/tini -- /sbin/init`
- **An initramfs holding a full Go runtime**: `runc`/`libcontainer`, CRIU, eBPF+BTF,
  protobuf 1.36.5, `golang.org/x/sys` 0.30.0, Go's `crypto` (incl. FIPS 140), `net`,
  `text/template`, and the complete HTML entity table — c2w's own init layer. Confirmed
  distinct from the guest: `tini` is in the snapshot and **absent from the guest rootfs**.

Two consequences worth stating plainly:

- **`root=/dev/sr0 … ro`** — the guest filesystem is mounted read-only from the OCI blob
  as a CD-ROM. That is the "extbundle" architecture, why `img/` is a separate file rather
  than being inside `out.wasm`, and consistent with c2w not persisting.
- **577.8 MiB declared memory minimum** is the "runs on any device" constraint, and it is
  a property of the module, not a runtime knob: instantiation must allocate it up front.
  Measured as a fact about the artifact; behaviour on a low-memory device was **not**
  tested (§7).

**Measured waste:** stripping all custom sections (the 2,287,619 bytes of DWARF) yields
104,591,333 bytes, which at `gzip -9` is **35,774,460** — a saving of **857,404 bytes
(2.34 %)** off the shipped file, for zero functional change. Real, small, free.

## 4. Inside the guest — the 8 %

`img/` is a **single-layer, stock, unmodified `alpine:latest`**. The OCI config records
exactly two history entries: `ADD alpine-minirootfs-3.24.1-x86_64.tar.gz /` and
`CMD ["/bin/sh"]`. Created `2026-06-16`. Nothing was installed. There is no derived
image here — this is `c2w alpine:latest`.

Unpacked: **516 entries, 8,472 KiB apparent, 16 apk packages.** Compressed cost per
component, measured by exclusion against a control re-tar of
3,720,118 bytes (the control differs from the shipped 3,846,391 by tar metadata and
member ordering, so treat these as relative magnitudes, which is what they are used for):

| component | gz delta | % of guest | does the agent need it? |
|---|---:|---:|---|
| **OpenSSL stack** (`libcrypto.so.3` 1,904,507 · `libssl.so.3` 380,378 · `ca-certificates.crt` 105,366 · `ossl-modules/` · `engines-3/` · `ssl_client`) | **2,463,052** | **66.2** | **No.** Nothing in the toolset does TLS in-guest and no networking is configured (§5). `libcrypto.so.3` is 4,985,616 bytes uncompressed — the largest single file in the guest. |
| `busybox` | 497,629 | 13.4 | **Yes** — it is every command the agent runs |
| `ld-musl-x86_64.so.1` | 414,751 | 11.1 | **Yes** — the loader; nothing runs without it |
| **apk-tools** (`sbin/apk`, `libapk.so.3`, `lib/apk/`, `etc/apk/`) | 197,098 | 5.3 | **No** — no network to install from, and the rootfs is mounted `ro` |
| `libz.so.1.3.2` | 54,981 | 1.5 | Marginal — busybox gzip/tar link it |
| `scanelf` | 31,374 | 0.8 | **No** — a build-time ELF tool |

**Measured floor:** a guest reduced to busybox + musl + baselayout compresses to
**1,028,337 bytes** — a **2,691,781-byte (72.4 %) reduction** of the guest.

Against the 48.5 MB total that is a **5.5 % saving**. Worth doing, and nowhere near
sufficient on its own. See §1.

## 5. What the agent actually needs, from the code

`crates/agent/src/workspace.rs` defines the entire guest-facing surface — **ten tools**:
`exec`, `read_file`, `write_file`, `list_files`, `start_process`, `list_processes`,
`read_process`, `stop_process`, `observe`, `find_files`. The file states it directly:
*"Every one of them is the same `WorkspacePort::exec` underneath (ADR-013); none of them
is a second way into the Linux."*

Every command the harness itself issues, read out of `crates/core/src/observe.rs`,
`crates/core/src/procwatch.rs` and `crates/adapters_web/src/c2w.rs`:
`printf`, `cut`, `pwd`, `ls`, `wc`, `cat`, `kill`, `mkdir -p`, `cd`, `find`, `grep`,
`uname`, and reads of `/proc/uptime`. **All of it is busybox + musl.** Nothing the
product does touches OpenSSL, apk or scanelf.

Two honest qualifications:

1. `exec` runs arbitrary commands a model writes, so the guest is general-purpose by
   design. Removing a package removes a capability the model might reach for. Whether
   that matters is a product decision, not a measurement — but it should be made
   deliberately rather than inherited from `alpine:latest`.
2. No networking is configured. `web/c2w/worker.js` passes only `info` and `args`,
   `crates/adapters_web/src/c2w.rs` sets no proxy or net flag, and the only net-adjacent
   string in `dist/runcontainer.js` is an unused `"proxy"` key. So the OpenSSL stack —
   66 % of the guest — has no reachable use at all.

## 6. Provenance — what history does record

The task brief said no prior record exists. That is right for *this* artifact and wrong
for the project. What exists:

- **`d16048c`** — "18: container2wasm as a second engine". The decision, the rationale
  (CheerpX streams from Leaning Tech's CDN under a community licence; c2w is ours), the
  A/B performance table, the wizer trade (*"26.7s to a shell without it, 3.16s with, for
  +20MB gzipped"*), and the note that *"the 47MB runtime lives in its own cache"*. It
  records the numbers. **It does not record a build command.**
- **`7c35f9b:image/Dockerfile`** — the pre-rewrite ASKK guest image recipe. Explicitly
  *"smallest possible Alpine (amd64), busybox only… no apk at all"* — the older project
  had already reached this audit's conclusion and written it down.
- **`8ef07f5:scripts/vm-c2w/README.md`** — the closest thing to a recipe that ever
  existed here: `c2w --dockerfile container2wasm/Dockerfile --assets container2wasm
  alpine:latest out/alpine-amd64.wasm`, plus a note that the bochsrc was patched to
  `cpu: ips=1000000000` + `clock: sync=none` because upstream's `ips=40000000` caps the
  guest.

Both live only in history; neither reproduces the artifact in `web/c2w` today. **The
sovereignty gap is real** — the argument for c2w over CheerpX was "an image we build,
host and ship", and two of those three are currently true.

**Cross-reference.** `docs/IMAGE-RECIPE.md` was written in parallel this round and
independently reproduces the file-level numbers above. It also closes §7 item 3 by
subtraction against the sibling `Dev/wasmbox` build (~20.4 MB gz of wizer snapshot).
Two points to reconcile before either doc is trusted on detail: it totals `img/` at
3,847,265 where `find` gives **3,847,875** (it appears to omit the 611-byte config blob),
and it describes the mounter as serving the layout **over 9p**, where the kernel command
line baked into this artifact says **`root=/dev/sr0 … ro`** — a read-only CD-ROM. The
cmdline is direct evidence from the shipped bytes; the 9p claim I could not confirm.

## 7. What I could not determine, and why

1. ~~**The exact command that produced `out.wasm`.**~~ **RESOLVED after this audit, in a
   sibling repo on this machine.** `Dev/wasmbox` holds both the artifact and the build
   log: `wasmbox/out/e9-extbundle-wizer.wasm` is 106,879,126 bytes and sha256
   `edfa854a5d6dd9f781052c179f9ee2ed40e40f172504bcdb560d3498c168dd1d`, byte-identical to
   the decompressed `out.wasm.gzip` shipped here; `wasmbox/htdocs/any-wizer/out.wasm.gzip`
   is byte-identical to the shipped gzip itself. `wasmbox/logs/e9-extbundle-wizer.log:1`
   records the full buildx argv, dated `2026/08/13 13:01:32`:
   `--platform=linux/amd64 --build-arg LINUX_LOGLEVEL=0 --build-arg INIT_DEBUG=false
   --build-arg EXTERNAL_BUNDLE=true --build-arg VM_MEMORY_SIZE_MB=512
   --build-arg OPTIMIZATION_MODE=wizer`, against `c2w-src` at commit `3f0f9be`.
   **`e9` is that repo's experiment index** — `out/e1…e9` are its numbered build
   experiments, and the name reaches the gzip header only as c2w's `OUTPUT_NAME`
   build-arg. `docs/IMAGE-RECIPE.md` §0 and §2a record the invocation with each flag
   justified, and note that four of the six build-args are c2w defaults rather than
   choices (`c2w-src/cmd/c2w/main.go:45-48,231-238`). The guest `img/` is likewise
   `wasmbox/images/alpine-base/`, `diff -r`-identical, exported by `wasmbox/mkimage.sh`
   on 2026-08-03T03:07:55Z. What remains open is not the command
   but whether re-running it reproduces the bytes; see `IMAGE-RECIPE.md` §6 item 6.
2. **Whether the bochsrc speed patch is in this build.** I searched the snapshot for
   `ips=` / `sync=` and found no match (the 1,912 `ips140` hits are `fips140` inside the
   Go runtime). The setting is not recoverable from the artifact by string search.
3. **The split inside the 101.5 MB `data` section** between the wizer snapshot and the
   kernel/initramfs c2w emits anyway. Separating them needs a non-wizer build, which needs
   Docker. `d16048c` records ~20 MB gzipped and `IMAGE-RECIPE.md` derives ~20.4 MB by
   subtraction; both are **cited, not measured by me**.
4. **Whether `imagemounter.wasm` (7.8 MB Go binary — 21.0 MB code, 16.6 MB data
   uncompressed) can be reduced.** Upstream c2w machinery; alternatives not evaluated.
5. **The kernel's config.** `CONFIG_*` strings appear but no readable `.config`, so I
   cannot say what a trimmed kernel would save.
6. **Real behaviour on a low-memory device.** The 577.8 MiB minimum is measured from the
   module; no device was tested.

## 8. What this audit does not do

It recommends nothing and changes nothing. Per §1 the leverage is in the emulator, not
the guest, and choosing among emulator options is a gate decision with an owner. The
measured facts a decision can start from: **857,404 bytes** of debug info are free to
drop, **2,691,781 bytes** of guest are unused by the toolset, and **577.8 MiB** is the
memory floor any target device must clear.
