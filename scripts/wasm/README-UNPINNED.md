# What this build still depends on, and what happens the day it goes

`scripts/wasm/build.sh` pins every origin it can to immutable content:
commit shas, image manifest digests, tarball sha256s (`PINS.env`). That is
worth doing and it is **not** the same thing as reproducibility.

**A content pin turns "silently different" into "loudly absent."** It cannot
make the build survive an origin disappearing. Only vendored bytes do that,
and nothing here is vendored yet.

The list below is the amd64/WASI path only — the stages a
`--target-arch=amd64` build actually executes. The riscv64, aarch64, QEMU and
emscripten paths in the same Dockerfile add roughly ten more origins that this
build never touches.

## Pinned by content — verified, still needs the origin to answer

| origin | what for | pin |
|---|---|---|
| github.com/container2wasm/container2wasm | c2w itself, its config templates and its `init` | commit sha, vendored into the build via `--assets` |
| github.com/ktock/Bochs | the x86 emulator that becomes the .wasm | commit sha |
| github.com/ktock/tinyemu-c2w | riscv emulator (not on this path) | commit sha |
| github.com/torvalds/linux | the guest kernel | tag + asserted commit sha |
| github.com/opencontainers/runc | container runtime inside the guest | commit sha |
| github.com/krallin/tini | guest init | tag + asserted commit sha |
| github.com/hoytech/vmtouch | guest page-cache warm | commit sha (upstream pins **nothing** here) |
| github.com/kateinoigakukun/wasi-vfs | packs the rootfs into the wasm | commit sha |
| github.com/bytecodealliance/wizer | pre-initialises the wasm | commit sha |
| github.com/WebAssembly/wasi-sdk (release) | the clang that builds Bochs | sha256 |
| github.com/WebAssembly/binaryen (release) | `wasm-opt --asyncify` | sha256 |
| busybox.net | guest userland | sha256 |
| mirrors.kernel.org | grub 2.06, for the boot ISO | sha256 |
| docker.io ubuntu / golang / rust | four base images | manifest digest |

**Two of these are `ktock/*` accounts** — the same account that moved
`container2wasm` out from under this build and left a fork stub behind. A
commit sha does not survive a repository being deleted or renamed.

**One is a single-origin tarball with no mirror in the build** (busybox.net).
grub had exactly this shape until today, when `ftp.gnu.org` stopped answering
and the build died; the fix was to repoint at a different host, which is only
possible because the content hash proves the substitution is honest.

## Not pinned at all, and not pinnable without more work

1. **Every `apt-get install`.** Nine stages run `apt-get update && apt-get
   install -y …` against the live Ubuntu and Debian archives. The versions
   installed change week to week, and when Ubuntu 22.04 leaves support the
   packages move to `old-releases.ubuntu.com` and every one of those lines
   breaks at once. This is the largest hole and it is upstream's, not ours.
   Closing it means a snapshot archive (`snapshot.ubuntu.com`) pinned to a
   timestamp, in nine places.
2. **`proxy.golang.org`** — building `c2w`, `runc` and the guest `init`
   downloads Go modules. `go.sum` verifies the content; the proxy still has to
   be reachable.
3. **`crates.io`** — `wizer` and `wasi-vfs` are cargo builds. `Cargo.lock`
   verifies content; the registry still has to be reachable.
4. **Registry availability.** A digest is content-addressed but Docker Hub
   still has to serve it, and Hub applies rate limits to anonymous pulls.
5. **`dl-cdn.alpinelinux.org`.** `scripts/wasm/image/Dockerfile` installs the
   guest's Python with `apk add --no-cache python3`, against the live 3.21
   repositories and with no version in the line. Alpine 3.21 is on
   `python3-3.12.14-r0` today; a point release moves it without changing this
   repository, and the version that landed is only visible in the artifact —
   `bun run toolchain` prints it, and `bun run check` runs it. Pinning it means
   `python3=3.12.14-r0`, which turns a silent version drift into a build that
   fails the day Alpine retires that exact package, and that trade has not been
   made either.

## What would actually make this reproducible

Vendor the bytes. Everything in the first table is content-addressed already,
so a `scripts/wasm/mirror/` directory plus a `--build-context` per fetch would
make the build depend on this repository and nothing else. The cost is roughly
**150 MB of tarballs** (wasi-sdk 74 MB, binaryen 74 MB, grub 11 MB, busybox
2.5 MB) plus git bundles for eight repositories plus four base images — call it
a gigabyte in-tree, against a 200-line-file, zero-dependency house style.

That trade has not been made. Until it is, this build works because seventeen
servers are up today.

## The sandbox image (`scripts/wasm/image/`)

`alpine:3.21` by tag, not by digest, plus `python3` from Alpine's repositories
and whatever is copied in beside it. The image is what the agent's shell tool
actually runs in, and it is rebuilt with

    docker build --platform=linux/amd64 -t localhost:5000/askk-sandbox:1 scripts/wasm/image
    docker push localhost:5000/askk-sandbox:1
    PROFILE=ship OUT_NAME=sandbox.wasm scripts/wasm/build.sh localhost:5000/askk-sandbox:1

The image argument is REQUIRED and used to have a default of `alpine:3.21`.
Dropping it built a guest with neither `mcp-disk` nor Python in it, and every
check in the tree stayed green over that artifact, so `build.sh` now refuses to
run without being told what to bake in.

Three things about the rest of it, all found the hard way:

- **c2w resolves images through a registry, not the local daemon.** A locally
  built image it has never seen is answered with `pull access denied`, so a
  registry on localhost is part of the build rather than an optional nicety.
- **`--platform=linux/amd64` is required on Apple silicon.** Without it the push
  carries an arm64 manifest and c2w — which hardcodes linux/amd64 — reports
  `no matching manifest for linux/amd64`, which reads like a c2w bug and is not.
- **Port 5000 is not free on macOS.** AirPlay Receiver, inside `ControlCenter`,
  listens on it and answers `403 Forbidden` with a `Server: AirTunes` header.
  Anything that probes the port to decide whether a registry is up gets a
  perfectly good TCP connection from Apple and skips starting one, and the push
  then fails much later with `connection refused` against the loopback address
  the *daemon* sees. Wait for `listening on` in `docker logs` instead of for the
  port to answer, or turn the receiver off in System Settings.
