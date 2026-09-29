# Local Bun package (Apple Silicon)

This opt-in directory package supplies Bun **1.4.2**, the companion source, a launcher and a Bun command shim. It requires no installed Node or Bun at launch. It is not an installer, certificate issuer, OS sandbox, notarized application or background service. Browser Linux remains a separate execution choice. Pairing a relay does not grant or select native execution.

The moved-package native acceptance passed all 11 checks on 2026-09-29, 00:11:38–00:11:44UTC: trusted-CA HTTPS/WSS, relay-only capability refusals, Unicode file/CAS, actual exits, process-group cancellation, a 103×37 PTY, and a Next 16.3.6 App Router static export using the package's Bun 1.4.2 with no Node/npm on PATH. The export took 2663.870 ms. This is functional acceptance using existing installed dependencies, not an isolated performance benchmark or browser-trust/UI proof. See the repository's `docs/rewrite/evidence/companion-package-darwin-arm64.md` and matching redacted JSON receipt.

The exact tested package remains immutable at `.cache/companion/acceptance-20260929-0011/moved package`. Its manifest covers 11 files totaling 61,935,041 bytes. This repository README was updated after acceptance; rebuilding will change its documentation hash. The receipt and tested package retain their original README and manifest. Production signing/notarization and an automated trust installer remain separate unverified release gates.

## Produce and review the package

From the repository, using the reviewed installed Bun executable:

```sh
bun scripts/companion/build.js --dry-run
bun scripts/companion/build.js
```

The first command verifies inputs and prints the exact manifest without writing a package. The second copies only an explicit allowlist to `.cache/companion/askk-local-darwin-arm64`. It fails if that directory exists. No compilation, dependency installation, runtime download or recursive repository copy occurs. In particular, workspace files, `.env`, credentials, certificates, TLS keys and caches cannot enter this allowlist.

`runtime-pin.json` records the current Bun version, source revision and measured executable SHA-256. The builder checks Darwin ARM64 Mach-O identity and that hash before creating output. This pin records the installed binary's provenance; it is not an independent release signature verification. Updating Bun requires reviewing and updating that pin, then rerunning the package gates. Per-file source hashes record the exact inputs even when the source checkout has uncommitted edits. `manifest.json` and `SHA256SUMS` support corruption checks, not publisher authentication. The unchanged source bytes are reproducible for the same inputs; archive metadata, signatures and notarization are out of scope.

Move the complete output directory to its final location. Keep its `runtime`, `bin`, `host`, `scripts`, `licenses`, manifest and launcher together. The builder refuses to overwrite an existing destination; choose `--output /new/absolute/directory` for another package. `--bun /absolute/bun` still must match the reviewed pin.

## Start explicitly

Prepare a browser-trusted certificate/key for `127.0.0.1` outside the project/package using your existing trust workflow. The companion validates certificate dates, IP SAN and key match at startup; it cannot establish browser trust for you. Create a private pairing directory yourself, with mode 0700 and owned by your user. Do not reuse another running companion's pairing file.

```sh
mkdir -m 700 "$HOME/.askk-pairing"

/absolute/askk-local-darwin-arm64/askk-companion \
  --root /absolute/project \
  --allow-origin https://kaush4l.github.io \
  --capabilities fs,exec,terminal,model-relay,network-relay \
  --tls-cert /absolute/private/loopback-cert.pem \
  --tls-key /absolute/private/loopback-key.pem \
  --pairing-file "$HOME/.askk-pairing/session.json"
```

All grants are required flags. For relay-only use, specify only `--capabilities model-relay,network-relay`. `--allow-origin` accepts exact HTTPS origins (or HTTP loopback origins); repeat it for additional pages. `--port` defaults to 7717. `--check` verifies hashes and path configuration without opening a server or creating a token; it does not verify TLS key matching or browser trust. `--help` is safe without credentials.

The URL and token are written to the exclusive mode 0600 pairing file. Console output names its path, never its token. Read it locally and enter its URL/token into Settings → Runtime; do not paste it into an agent conversation. Explicitly select Local Bun only when you intend native commands. Any different workspace location still requires the workbench's explicit review/transfer flow.

The process remains in the foreground. Ctrl+C or SIGTERM closes its server, cancels owned jobs and terminals, and removes its own unchanged pairing file. No auto-restart occurs. A crash/SIGKILL can leave a stale pairing file; after confirming the old process has stopped, remove that specific file before starting again. Each start creates a fresh token and runtime session; previous build verification does not transfer to it.

## Owned command runtime

The launcher calls the packaged `runtime/bun` by absolute path with automatic `.env` loading disabled, a fixed package Bun configuration and no automatic package install. Child jobs and PTYs receive a deliberately selected environment, with package `bin` before macOS system paths. Provider secrets, inherited pairing tokens and Node/Bun preload flags are omitted. The native controller uses a non-login `/bin/sh -c`; the PTY uses non-login `/bin/sh`, so shell profiles do not reorder that PATH.

The `bin/bun` shim executes the exact packaged binary with `--bun`. Native build commands also state `bun --bun run build`. This matters because Bun otherwise respects Node shebangs in commands such as Next. There is no `node` or `npm` compatibility shim promising a real Node runtime. Use Bun commands for this profile; native addon compatibility and arbitrary Node-specific tools need separate checks. Explicit absolute executables, command scripts and package code retain your user's host privileges. This is reproducible command lookup, not executable confinement.

Required real-package acceptance after timing-sensitive guest experiments finish:

1. Build the package; verify every manifest file and run `--help` with PATH restricted to system directories.
2. With existing trusted external TLS, start relay-only and verify its health grants; native file/job/PTY requests must be refused.
3. Restart with explicit fs/exec/terminal grants; execute `command -v bun` and `bun -p 'process.execPath'` through the non-login job shell and PTY. Both must point into the moved package, with no system Bun/Node available. Verify actual exit, cancellation and shutdown.
4. Build an installed minimal Next static-export fixture using `bun --bun run build`. This is a native companion check, not browser-guest acceptance.

The repository includes an explicit acceptance runner for that sequence. It creates a new package, moves it to a path containing a space, launches under a system-only PATH and empty temporary home, checks relay-only refusals, then restarts with native grants for jobs, PTY, cancellation and an App Router export. It reuses repository `node_modules` without installing anything. HTTPS and WSS verify against the supplied public CA; TLS validation is not disabled. It stops each owned server and writes a mode 0600 receipt with exact source/runtime hashes. That private receipt can contain local paths and should be reviewed before publication. The runner is not part of the shipped payload.

```sh
bun scripts/companion/acceptance.js --execute \
  --directory /absolute/new-private-proof \
  --tls-cert /absolute/private/loopback-cert.pem \
  --tls-key /absolute/private/loopback-key.pem \
  --tls-ca /absolute/private/public-rootCA.pem
```

`--help` starts nothing; omitting `--execute` refuses the run. The Next job is bounded to 180 seconds and shutdown to 10 seconds. A failed gate produces a failed receipt, not a package acceptance claim. This API probe does not establish browser certificate trust, a workbench interaction or browser-contained execution.

The package includes Bun's unchanged upstream licensing overview, including linked-library notices and relinking-source instructions. Public redistribution also needs the applicable notices/source obligations and macOS distribution-signing review; this local handoff does not claim those release gates complete.

Primary references: [Bun runtime and `--bun`](https://bun.sh/docs/runtime#--bun), [standalone executables and embedded-runtime CLI mode](https://bun.sh/docs/bundler/executables#act-as-the-bun-cli), [pinned Bun licensing and relinking instructions](https://github.com/oven-sh/bun/blob/bun-v1.4.2/LICENSE.md). This package copies the reviewed runtime directly rather than compiling an extra executable just to expose the same CLI.
