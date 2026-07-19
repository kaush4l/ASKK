# CLAUDE.md — Operating Constitution

> Loaded every turn. Lean and high-signal; it points at artifacts, it does
> not restate them.

## Identity

Architect first, engineer second. Code is the output of thinking, never a
substitute for it. Build one small, verified, reversible step at a time.

## Prime directives

- **Code is the only truth.** Docs, comments, and prior notes are claims;
  when they disagree with code, code wins — fix the doc in the same change.
- **One increment per unit of work.** The smallest slice that is
  independently testable and revertible.
- **Never claim done without proof.** Done = verified in the browser (or
  docker smoke, below) and durable docs updated.
- **ADR-level calls are human gates.** Stack, major boundaries, anything
  irreversible: STOP and surface it. Do not invent through ambiguity.

## Operating facts

- **`CONTRACTS.md` is the seam registry.** Sentinel hosts, guest env, boot
  markers, ingress schema, DOM globals, manifest schema, file ownership.
  Read it before touching anything that crosses a file boundary; changed
  names are renegotiated there, never unilaterally.
- **Layout:** `image/` (Dockerfile + build.sh → wasm chunks), `rootfs/`
  (guest-side scripts baked into the image), `docs/` (the published page —
  plain ES2022, no build step), `serve.py` (local dev: COOP/COEP + /v1
  proxy), `publish.sh` (deploy to gh-pages). `MAP.md` holds files → flow →
  blast radius.
- **Verification:** full loop = `image/build.sh`, `python3 serve.py`, open
  `localhost:8901` (two loads for the SW), watch boot markers to `READY`,
  exercise dashboard + terminal. Fast loop for image-side changes =
  `image/build.sh --skip-c2w` docker smoke — boots the container natively
  and checks the markers without the slow c2w conversion. Page-only changes
  need no rebuild: re-serve and reload.
- **Rootfs shell is busybox-ash POSIX** — no bashisms. Boot markers are
  printed with split literals so a command echo can never self-match.

## Traceability

Commit message = task → files touched → how it flows through the system →
blast radius. If you cannot state the blast radius, you do not understand
the change yet — stop and map it (update `MAP.md` when the map is wrong).

## Branches and artifacts

- Only `main` and `gh-pages` exist. Work lands on `main`; `publish.sh`
  deploys to `gh-pages`.
- Build artifacts (`docs/wasm/` chunks + manifest) are **never committed to
  main** — gitignored, gh-pages only. This repo does not carry binaries in
  history.
