# sandbox-exec (Seatbelt) for jobs

How the app runs user- and model-written jobs on macOS, including MLX jobs that need the full
Apple GPU, with no network and nothing outside a workspace (docs/design.md §5: "mlx-metal: a
child process under a Seatbelt profile — Metal allowed, network and everything outside its
workspace denied, one GPU job at a time").

Files: `sandbox/profiles/job.sb`, `sandbox/profiles/mlx.sb`, `sandbox/run.sh`, `sandbox/test.sh`.
Measured on macOS 27.2 (26B5101f), Apple M4 Max, uv 0.11.21, mlx 0.32.4, CPython 3.12.12.

## 1. What Seatbelt is

Seatbelt is the macOS kernel's sandbox: a MAC policy module (`Sandbox.kext`) that checks
operations (file open, exec, mach lookup, IOKit open, socket connect …) against a compiled
policy attached to a process. The policy language is SBPL, a Scheme dialect. Every Apple
sandbox uses it: App Sandbox, the system daemons' own profiles in
`/System/Library/Sandbox/Profiles/*.sb`, Safari's and WebKit's helpers.

`/usr/bin/sandbox-exec` compiles an SBPL file and applies it to itself (`sandbox_init` /
`sandbox_apply`), then execs the command. The policy cannot be removed or widened afterwards.

### Status: deprecated but shipped

`man sandbox-exec` says "sandbox-exec – execute within a sandbox (DEPRECATED)" and has said so
since about macOS 10.8. What that means in practice:

- It still ships and works on macOS 27.2 (verified below). Apple's own tooling, Chromium's
  and Firefox's Mac sandboxes, Bazel, Nix and others build on the same SBPL interface.
- SBPL is undocumented and unsupported: operation and filter names can change between
  releases without notice, and there is no compatibility promise. Re-run `sandbox/test.sh`
  after every macOS update.
- What Apple recommends instead is App Sandbox: entitlements in an app's code signature
  (`com.apple.security.app-sandbox`, `…network.client`, `…files.user-selected.read-write`).
  That fits a whole signed app, not "run this arbitrary command in this folder with no network".
  Section 9 compares the two.

## 2. Invoking

```
sandbox-exec -f profile.sb -D WORKSPACE=/private/tmp/ws -D TOOL1=/path cmd args...
sandbox-exec -p '(version 1)(allow default)' cmd            # inline profile
```

`-D KEY=value` sets what `(param "KEY")` returns. If a profile uses a param that was not given,
compiling fails. That is why run.sh passes `TOOL1..TOOL4=/nonexistent` when they are unset.
The exit code is the command's own, or 65 for a profile that does not compile, or 71 when the
sandbox cannot be applied.

Use `sandbox/run.sh`, not the raw command:

```
sandbox/run.sh job  <workspace> -- cmd...
SBX_TOOLS="$VENV:$UV_PYTHON_ROOT" sandbox/run.sh mlx <workspace> -- "$VENV/bin/python" -I train.py
```

run.sh:
- resolves the workspace with `pwd -P`;
- refuses `/`, `/Users`, `$HOME`, `/System*` and `/usr*` as a workspace;
- layers `mlx.sb` after `job.sb`;
- runs with `env -i`: PATH=/usr/bin:/bin, HOME and TMPDIR inside the workspace, and only what
  `SBX_ENV` adds;
- sets the ulimits;
- enforces a wall clock;
- for `mlx`, holds a GPU lock.

## 3. SBPL in brief

```scheme
(version 1)                 ; the only version
(deny default)              ; or (allow default); everything not matched below gets this
(allow file-read* (subpath "/usr/lib"))
(allow file-read* file-write* (subpath (param "WORKSPACE")))
(deny network*)
```

Operations used here:

| operation | covers |
|---|---|
| `file-read*` | `file-read-data`, `file-read-metadata`, `file-read-xattr` |
| `file-write*` | create, write, unlink, rename, setattr … |
| `file-ioctl` | ioctl on a file (ttys, /dev/dtracehelper) |
| `process-exec` | execve of a binary (and `process-exec-interpreter`) |
| `process-fork` | fork/posix_spawn |
| `network*` | `network-outbound`, `network-inbound`, `network-bind` (TCP/UDP and unix sockets) |
| `mach-lookup` | looking up a Mach/XPC service by name (`global-name`, `xpc-service-name`) |
| `iokit-open` | opening an IOKit user client (`iokit-user-client-class`) |
| `sysctl-read` | sysctl reads (hw.*, kern.*) |
| `ipc-posix-shm*` | POSIX shared memory (`ipc-posix-name`) |
| `signal` | sending signals (`(target same-sandbox)`) |
| `system-info` | some info calls (vfs.disk-space, net.link.addr are logged as denied) |

Filters:
- `(literal "/exact/path")`
- `(subpath "/dir")`: the dir and everything under it
- `(regex #"^/private/var/folders/[^/]+/")`
- `(prefix "…")`
- `(param "KEY")`, usable wherever a string is
- `(require-all …)`, `(require-any …)`, `(require-not …)`

Paths are matched after symlink resolution. `/tmp`, `/var` and `/etc` are symlinks into
`/private`, so you write `/private/tmp/...` or `/private/etc/...`.

Precedence: the last matching rule wins. A later `(allow …)` overrides an earlier `(deny …)`
for the same operation and path, and the other way round. Put the broad rules first and the
narrow exceptions after them. Layering `mlx.sb` after `job.sb` relies on this. The trailing
`(deny network*)` in job.sb only restates the default, and mlx.sb adds no network rule, so the
network stays denied.

Inheritance: everything the sandboxed process forks or execs runs under the same policy, and
no child can leave it. A process that already has a sandbox cannot apply a second one:
`sandbox_apply` returns EPERM (section 9, verified). Policies do not stack. Make one profile
per job kind and pick it at launch.

## 4. Debugging denials

Every denial is a kernel log line from sender `Sandbox`:

```
log stream --style compact --predicate 'sender == "Sandbox"'
# 2026-11-07 23:05:35.648 E kernel[0:3f1055f] (Sandbox) Sandbox: cat(13876) deny(1) file-read-data /Users/kaush/.zshrc
```

Things I checked on 27.2:
- `log stream` reliably shows sandbox-exec denials. `log show --last 1m` afterwards usually
  did not have them (they are not persisted, or are coalesced as "N duplicate report").
  Start the stream first, then run the job.
- `(debug deny)` is accepted by the compiler. The denials were logged with or without it, so
  it made no visible difference.
- `(trace "/path/out.sb")` is accepted but did nothing: no file was written. The old trick of
  "trace, then generate a profile" no longer works. Iterate from the stream instead.
- `(with report)` on a deny fails to compile: "report modifier does not apply to deny action".

The method used for mlx.sb: run under job.sb, read the denials, allow the smallest thing that
explains the failure, repeat. Then remove each allowance in turn to prove it is needed
(section 8).

## 5. Pitfalls

- **dyld shared cache**: system libraries are not on disk as files. Allow `/System`
  (Cryptexes, dyld) and `/private/var/db/dyld`, or nothing starts.
- **Symlinks**: `/tmp` → `/private/tmp`, `/var` → `/private/var`, `/etc` → `/private/etc`.
  A rule for `/tmp/ws` matches nothing. run.sh resolves the workspace with `pwd -P`.
- **Python**: a uv venv's `bin/python` is a symlink into
  `~/.local/share/uv/python/cpython-…/`. The sandbox needs both the venv and that root
  readable and exec-able (`SBX_TOOLS`). Homebrew Python needs `/opt/homebrew/Cellar/...`
  and `/opt/homebrew/opt`. Run with `python -I`, so neither the cwd nor the user's site
  packages are on the path.
- **TMPDIR**: the default `/var/folders/...` is outside the workspace. run.sh sets
  `TMPDIR=$ws/.tmp/`.
- **Home**: CoreFoundation tries `~/Library/Preferences/.GlobalPreferences*.plist` and
  `~/.CFUserTextEncoding`. Those reads are denied, logged and harmless: MLX ran fine. Do not
  allow `$HOME`; run.sh sets HOME to the workspace.
- **curl and TLS**: without `/private/etc/ssl` readable, curl fails on `openssl.cnf` before it
  ever touches the network. That would be a false pass for a "network denied" test. job.sb
  allows `/private/etc/ssl` (config only, no keys there), so curl really fails at DNS (exit 6)
  and at connect (exit 7).
- **RLIMIT_NPROC is per user on macOS.** `ulimit -u 256` made the job's first fork fail with
  "Resource temporarily unavailable", because the user already had more processes. It is off
  by default (`SBX_NPROC`).
- **RLIMIT_AS**: Metal reserves large virtual ranges, so a small `ulimit -v` breaks GPU jobs.
  It is off by default (`SBX_MEM_KB`). Not tested with MLX.
- A job that blocks inside Metal can hang rather than exit (the first MLX run under job.sb hung
  with AGXDeviceUserClient denied). Always set a wall clock.

## 6. Rules we adopt

1. `(deny default)`. Allow only by name.
2. Writes go only to the workspace (`WORKSPACE` param, resolved path). HOME and TMPDIR are
   inside it.
3. Read-only system paths: `/System`, `/usr/lib`, `/usr/share`, `/usr/bin`, `/bin`,
   `/usr/libexec`, dyld, timezone, `/Library/Preferences`, ssl config, a few `/dev` nodes.
   Toolchains are given by the caller (`TOOL1..4`). stat of any path is allowed
   (`file-read-metadata`, which some runtimes need for realpath); contents are not.
4. Exec only from the system bin dirs, the workspace and the toolchains.
5. No network at all, loopback included. No unix sockets.
6. GPU allowed only in `mlx.sb`: two IOKit user clients and the Metal compiler service.
7. Seatbelt limits access, not resources. run.sh applies `ulimit -t` (CPU seconds, default
   3600), `ulimit -f` (largest file, default 20 GB), optionally `-v` and `-u`, and a wall
   clock (default 7200 s: TERM, then KILL 5 s later).
8. One GPU job at a time: `mlx` re-runs itself under `/usr/bin/lockf -k /tmp/sbx-gpu.lock`.
   macOS has no `flock`. The lock gives the running job the whole GPU. The sandbox does not
   slow the GPU at all (section 8).
9. Treat SBPL as unstable: `sandbox/test.sh` runs after each macOS update.

## 7. The profiles

`job.sb`: the rules above. `mlx.sb`, the complete set Metal needed:

```scheme
(allow iokit-open (iokit-user-client-class "AGXDeviceUserClient" "IOSurfaceRootUserClient"))
(allow mach-lookup (xpc-service-name "com.apple.MTLCompilerService"))
```

What each one is for:
- **AGXDeviceUserClient**: the GPU driver (AGX is Apple's GPU).
- **IOSurfaceRootUserClient**: shared GPU memory and events. Without it MLX fails with
  "Failed to create Metal shared event".
- **MTLCompilerService**: the XPC service that compiles kernels. Without it MLX fails with
  "Unable to load kernel … Sandbox restriction".

No `sysctl-read` beyond job.sb's, no `ipc-posix-shm`, no other mach service and no extra
filesystem path was needed. Denials still logged during a successful run are harmless:
`com.apple.bsd.dirhelper`, `opendirectoryd.membership`, `DiskArbitration`, `analyticsd`,
`coreservicesd`, `system-info vfs.disk-space`. The kernel shader cache under
`/var/folders/.../C` is therefore never written, so kernels are compiled each run. A
persistent cache would need `dirhelper` plus a cache folder. It was not needed.

## 8. Verified

All commands ran on this Mac. `S=$SCRATCH/sbx`, `W=$S/ws`.

**job.sb: writes, isolation, network**
```
$ sandbox/run.sh job $W -- /bin/sh -c 'echo hi > ok.txt && cat ok.txt; echo x > /private/tmp/claude-501/outside.txt; echo w=$?; ls /Users/kaush/.ssh; echo ssh=$?; curl -sS -m 5 https://example.com -o /dev/null; echo curl=$?; curl -sS -m 5 http://1.1.1.1 -o /dev/null; echo curlip=$?'
hi
/bin/sh: /private/tmp/claude-501/outside.txt: Operation not permitted
w=1
ls: /Users/kaush/.ssh: Operation not permitted
ssh=1
curl: (6) Could not resolve host: example.com
curl=6
curl: (7) Failed to connect to 1.1.1.1 port 80 after 0 ms: Couldn't connect to server
curlip=7
$ curl -sS -m 5 http://1.1.1.1 -o /dev/null; echo unsandboxed=$?
unsandboxed=0
```

**Finding the Metal set** (venv: `uv venv --python 3.12` + `uv pip install mlx` in `$S`).
Run with `SBX_TOOLS="$S/venv:~/.local/share/uv/python/cpython-3.12.12-macos-aarch64-none"`;
`log stream` captured each run's denials.

1. Under job.sb, the run hung: `deny(1) iokit-open-user-client AGXDeviceUserClient`.
2. With AGX allowed: `RuntimeError: [Event::Event] Failed to create Metal shared event.` and
   `deny(1) iokit-open-user-client IOSurfaceRootUserClient`.
3. With IOSurface also allowed: `RuntimeError: [metal::Device] Unable to load kernel rbitsc /
   Unable to reach MTLCompilerService … error 159 - Sandbox restriction` and
   `deny(1) mach-lookup com.apple.MTLCompilerService (xpc)`.
4. With the compiler service also allowed:
   ```
   device Device(gpu, 0)
   matmul ok (4096, 4096) 0.117s sum 219879.359375
   net denied: [Errno 1] Operation not permitted
   ```
   The stream showed the attempt: `deny(1) network-outbound remote:*:80`.

**Each allowance is needed** (job.sb plus the other two):
- without AGXDeviceUserClient: `ImportError: [metal::load_device] No Metal device available`
- without IOSurfaceRootUserClient: `Failed to create Metal shared event`
- without MTLCompilerService: `Unable to load kernel rbitsc`

**Full GPU speed** (20 runs of an 8192² fp16 matmul; two rounds alternating plain and sandboxed):
```
plain:      20x 8192^2 fp16 matmul 1.45s 15.14 TFLOPS
sandboxed:  20x 8192^2 fp16 matmul 1.45s 15.15 TFLOPS
plain:      15.14 TFLOPS      sandboxed: 15.14 TFLOPS
```
One earlier sandboxed run gave 12.84 TFLOPS while `log stream` was capturing hundreds of
denial lines. Don't benchmark with the stream open.

**Limits and lock**
```
$ run.sh mlx ws -- sleep 3 & run.sh mlx ws -- sleep 3; wait     → elapsed=6s (serialised)
$ SBX_CPU_SECONDS=1 run.sh job ws -- sh -c 'while :; do :; done' → Cputime limit exceeded, rc=152
$ SBX_WALL_SECONDS=2 run.sh job ws -- sleep 30                   → terminated (test.sh)
```

**sandbox/test.sh**
```
PASS job: writes in workspace
PASS job: cannot write outside
PASS job: cannot read ~/.ssh
PASS job: cannot list ~/Library
PASS job: no DNS/HTTPS
PASS job: no raw IP
PASS job: no nested sandbox-exec
PASS job: wall clock limit
gpu matmul ok, network denied
PASS mlx: GPU matmul, no network
PASS job (no Metal rules): MLX GPU fails
0 failure(s)
```
Before the scratch folder fix, the script failed with exit 1 and 2 failures. That confirms
failures are counted.

**Nested sandboxes do not stack**
```
$ sandbox-exec -f outer.sb sandbox-exec -f inner.sb /bin/cat ~/.zshrc     # outer = (allow default)
sandbox-exec: sandbox_apply: Operation not permitted     rc=71
$ run.sh job ws -- /usr/bin/sandbox-exec -f inner.sb /bin/echo inner-ran
sandbox-exec: sandbox_apply: Operation not permitted     rc=71
```
A sandboxed process, even one under an allow-all profile, cannot apply a second, stricter
profile.

**App Sandbox probe** (`$S/app`): a Swift binary that calls `MTLCreateSystemDefaultDevice()`,
runs `sandbox-exec -p '(version 1)(allow default)' echo`, and runs `/bin/cat ~/.zshrc` as a
plain child. Signed ad hoc with entitlements `com.apple.security.app-sandbox = true`:
```
$ swiftc -O m.swift -o m && ./m            → metal: Apple M4 Max   (unsigned, not sandboxed)
$ codesign -f -s - --entitlements e.plist m && ./m x  → rc=133 (SIGTRAP at sandbox init: bare binary, no bundle id)
$ # as M.app with Info.plist CFBundleIdentifier=local.sbxprobe, same signing:
$ M.app/Contents/MacOS/m x
metal: Apple M4 Max
sandbox-exec: sandbox_apply: Operation not permitted
child rc 71
cat: /Users/kaush/.zshrc: Operation not permitted
```
So in an ad hoc signed App Sandbox app:
- the Metal device is created;
- it cannot sandbox-exec a child;
- its plain children inherit the App Sandbox, so the cat of `~/.zshrc` is denied.

The first run created `~/Library/Containers/local.sbxprobe` (left in place; delete it by hand).

**Not proven**
- `ulimit -v` with MLX.
- A Developer ID or App Store signed build: only ad hoc signing was tested.
- MLX itself inside an App Sandbox app: only `MTLCreateSystemDefaultDevice` was tested there.
- An XPC helper.
- Homebrew Python under these profiles.
- Behaviour on other macOS versions or GPUs.

## 9. App Sandbox vs sandbox-exec

**Same kernel, different way of applying the policy.**
- App Sandbox is Seatbelt with Apple's generated profile (`application.sb`), parameterised by
  the entitlements in the code signature. `libsystem_secinit` applies it at launch; the log
  line was `m[...] (libsystem_secinit.dylib) AppSandbox`.
- sandbox-exec applies an `.sb` file we write.

**Scope.**
- App Sandbox covers the whole app, always, from its first instruction. Every child process
  inherits it.
- What a sandboxed app can read and write is its container (`~/Library/Containers/<id>`),
  user-selected files (security-scoped bookmarks) and entitlement-granted classes
  (`network.client`, …).
- There is no "this job, this folder, no network; that job, the GPU" per child. A child gets
  the parent's policy or nothing narrower: nested sandbox-exec fails (verified).

**XPC services** are Apple's way to give part of an app different rights.
- An XPC service in `Contents/XPCServices/` is its own bundle and signing, with its own
  entitlements. It can be more restricted than the app, e.g. no network.
- It is launched by launchd on demand, not by the app forking it.
- An XPC service for jobs could hold the GPU and the job folder, and the main app the network.
  It still cannot run an arbitrary per-job `.sb`.

**Mac App Store** requires App Sandbox for the main app and for every helper and XPC service.
Consequences for us:
- jobs run from inside the container (the workspace has to live under the container or under a
  bookmarked folder);
- Python and uv have to be inside the app bundle or the container. A sandboxed app can exec a
  binary in its container, but not `~/.local/share/uv`;
- `sandbox-exec` cannot be used (verified: EPERM).

**Hardened runtime** (needed for notarisation, Developer ID).
- Library validation refuses dylibs that are not signed by Apple or the same team. MLX's
  `libmlx.dylib` and Python extension modules installed by uv are ad hoc or third-party signed.
- A host process that loads them in-process needs
  `com.apple.security.cs.disable-library-validation`, or every dylib re-signed with our team
  ID.
- A Python interpreter that it execs is a separate binary, judged by its own signature.
- JIT-style code may also need `cs.allow-jit` or `cs.allow-unsigned-executable-memory`.
  Not needed for MLX: Metal compiles in MTLCompilerService.

**Quarantine.**
- Files written by a quarantine-aware app (browsers, and sandboxed apps by default) get
  `com.apple.quarantine`. A quarantined, non-notarised executable or dylib is blocked by
  Gatekeeper when executed.
- Binaries uv downloads with its own HTTP client are not quarantined, so they run under
  sandbox-exec.
- A sandboxed app that downloads a Python or a wheel will quarantine it (`LSFileQuarantineEnabled`).
  Those files would need the attribute removed (not allowed for a sandboxed app on files it
  did not create appropriately) or must ship inside the signed bundle.

### Recommendation, staged

1. **Dev / self-hosted (now)**: an unsandboxed host process launches each job with
   `sandbox/run.sh job|mlx`. You get a per-job policy, a per-job workspace, no network, the
   full GPU (measured parity), uv toolchains, and the GPU lock. Re-check with test.sh on every
   OS update.
2. **Developer ID distribution (outside the App Store)**: hardened runtime, notarised. The app
   itself stays outside App Sandbox, or runs in App Sandbox as a shell, with a separately
   signed, non-sandboxed job helper (a launchd job or login item) that keeps using
   sandbox-exec per job. The helper needs `disable-library-validation` only if it loads MLX
   in-process; running Python as a child avoids that. Toolchains go in the helper's
   Application Support folder.
3. **Mac App Store**: no sandbox-exec. The app plus an XPC job service, each App Sandboxed:
   - the service with no network entitlement and the GPU (Metal works in App Sandbox,
     verified for device creation);
   - the main app with network if needed;
   - a bundled, signed Python and MLX;
   - workspaces inside the container.

   Per-job isolation is weaker (all jobs share the service's container), so add a per-job
   process and folder convention inside it. Treat this as a separate port, and verify MLX
   end to end there before committing to it.
