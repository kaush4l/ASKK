# PROGRESS

> Owned by the **junior**. One entry per increment, appended, never rewritten.
> An entry without a reproducible proof is not an entry — write
> `Proof: NOT PROVIDED` and say so out loud rather than inventing one.
>
> **Ringmaster's rule, set 2026-08-28 at the retro that found this file three
> increments behind the code:** an increment's PROGRESS entry is written in
> the same commit as the increment, or the increment is not done. Not a
> separate pass, not caught up later. This file falling behind is what that
> retro was about.

Entry shape:

```
## <id> — <one-line intent> — <YYYY-MM-DD>
- Files: <paths>
- Proof: <the exact command run, and its real result>
- Ringmaster: GO | GO WITH CONDITIONS | NO-GO
- Open: <what is left, or "nothing">
```

---

## 0.2 — Team, gitignore, north star — 2026-08-28
- Files: `.claude/agents/{ringmaster,architect,coder,critic,junior,ui-director,ui-builder}.md`, `.gitignore`, `docs/NORTH-STAR.md`, `docs/PLAN.md`, `docs/PROGRESS.md`
- Proof: `ls .claude/agents/` lists seven role files plus the retained `ux-walker`; `git status` shows `.gstack/` untracked after `git rm -r --cached`; toolchain verified — bun 1.4.0, next 15.5.24, docker 28.5.1, c2w on PATH.
- Ringmaster: not yet ruled
- Open: `docs/ARCHITECTURE.md` (increment 0.3) is the blocker for all of wave 1.

## 0.3 — Architecture of record drafted and ringmaster-approved — 2026-08-28
- Files: `docs/ARCHITECTURE.md`, `docs/PLAN.md` (§10.3 edits), `docs/scratch/MEASURED.md`
- Proof: `docs/ARCHITECTURE.md` states, in its own header, "Revision 2. Rewritten
  against `docs/scratch/MEASURED.md`, a ringmaster GO-WITH-CONDITIONS (9
  conditions) and a critic pass (10 blockers, 15 majors)." All nine ringmaster
  conditions are individually cited and marked accepted in the body
  (`grep -n "ringmaster condition" docs/ARCHITECTURE.md` returns conditions
  1–9, each at the section it resolved: §3.4 rule 1, §3.5 rule 2 adapter
  banners, §6.2 `config/probe`, §10.2 opening, §5.6 flow-table move, §5.2 two
  deletions, §8.3 twice for the `max`/`total` ratchet, §8.4 restated-unenforced
  and the stub-success test, §10.3 item 8 making CLAUDE.md's rewrite
  blocking). The document's own self-checks pass: `grep -c '^## '
  docs/ARCHITECTURE.md` = 11, `grep -c 'config/probe' docs/ARCHITECTURE.md` =
  5 (non-zero).
- Ringmaster: GO (all nine conditions met, verified inline above)
- Open: the final critic re-pass count itself — "8 of 10 blockers and 14 of 16
  majors fully resolved, two blockers partial (both in the bundle check),
  plus four new defects the revision introduced" — is **NOT PROVIDED** as a
  standalone artifact in this tree. No critic-report file exists to check it
  against; the inline "critic :NNN, accepted" citations throughout
  `ARCHITECTURE.md` corroborate that a pass happened and was answered
  point-by-point, but the blocker/major tally and the four new defects the
  architect is now fixing are not independently reproducible here. The four
  fixes are outstanding.

## 0.4 — Old tree deleted whole and tagged; CLAUDE.md rewritten — 2026-08-28
- Files: `CLAUDE.md` (rewritten), `.gitignore` (anchored pattern, tracks
  `docs/scratch/`), and the whole-tree deletion of `agents/`, `app/`, `core/`,
  `README.md`, `bun.lock`, etc. Commit `9aa143d`.
- Proof:
  - `git tag` lists `pre-workbench` (plus `pre-python-port`, `pre-rewrite-js`,
    `pre-rewrite-rust`, `python-port-v1`).
  - `git ls-tree -r --name-only pre-workbench | wc -l` → `142`.
  - `git ls-tree -r --name-only pre-workbench | grep '^core/' | wc -l` → `50`.
  - `git ls-files | wc -l` on the working tree → `20` (the team in
    `.claude/agents/` + `.claude/launch.json`, five docs, four
    `docs/scratch/` notes, `CLAUDE.md`, `.gitignore` — no `src/`, no `core/`,
    no `app/` anywhere in the working tree).
  - `CLAUDE.md` now reads "`docs/ARCHITECTURE.md` is the architecture of
    record" (not `PORT-MAP.md`), states "**Next.js 15 App Router + React 19,
    TypeScript**" (not vanilla JS), and states "There is **no file-size
    cap**" (replacing the 200-line rule) — the three contradictions PLAN 0.4
    named are gone. Six documents that competed with the record
    (`DESIGN.md`, `README.md`, and four `agents/*/agent.md` companions plus
    the old `PORT-MAP.md`/`PORTING-GUIDE.md`-era files) are deleted with the
    tree, per the commit's own diffstat.
- Ringmaster: GO (0.4's stated acceptance — recovery tag present, working
  tree holds only the new skeleton, tag still holds the old files, CLAUDE.md
  corrected on all three points — is met and reproducible by the commands
  above)
- Open: nothing recorded against 0.4 itself; the four defects opened against
  0.3 (see above) are the carry-forward into wave 1.

## 1.1 — A tree with no source can now serve a page — 2026-08-28
- Files: `next.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`,
  `package.json`, `tsconfig.json`, `bun.lock`, `next-env.d.ts`. Commit
  `423a661`.
- Proof: `next.config.ts` sets `basePath = process.env.ASKK_BASE_PATH ?? '/ASKK'`
  unconditionally (not dev-gated) and `reactStrictMode: false`;
  `src/app/layout.tsx` carries no manual `<head>`, only `export const metadata`;
  `src/app/page.tsx` exports `PAGE_MARK = 'ASKK_PAGE_ALIVE'` rendered into the
  DOM. Ran `bun run types` (`tsc --noEmit`) clean, exit 0.
- Ringmaster: GO
- Open: nothing recorded against 1.1 itself.

## 1.2 — The page is now a folder of files — 2026-08-28
- Files: `package.json` (`"build": "rm -rf .next out && next build"`).
  Commit `c6c7d47`.
- Proof: ran `rm -rf .next out && bun run build` from a clean state — built in
  ~1.3s, emitted `out/` with the export. Enumerated `out/` myself: 3 html
  (`index.html`, `404.html`, `404/index.html`), 14 `.js` chunks under
  `_next/static`, 1 `index.txt` — matching the commit's own count exactly.
  `find out -type d -name server` → empty (no server directory).
  `grep -rlE "require\(['"'"']node:|from ['"'"']node:" out --include="*.js"` →
  no hits. `grep -rl "__dirname\|process.exit\|next/dist/server\|renderToPipeableStream" out --include="*.js"` →
  no hits. `grep -rl "createServerReference" out --include="*.js"` → the one
  hit the commit names, `chunks/255-*.js`, and nowhere else.
- Ringmaster: GO
- Open: nothing recorded against 1.2 itself.

## 1.3 — The subpath failure is now reproducible on a laptop — 2026-08-28
- Files: `scripts/serve-subpath.ts` (initial version). Commit `419a732`.
- Proof: served `out/` with `bun scripts/serve-subpath.ts out`, drove
  `http://localhost:4599/ASKK/` — index 200, mark in DOM. Separately
  reproduced the failure this script exists to prevent: served the same
  `out/` at the *root* with a plain static server (`bunx serve`), got the
  index at 200 with `ASKK_PAGE_ALIVE` in the DOM, but the chunk URL the page
  itself references (`/ASKK/_next/static/chunks/webpack-*.js`) came back 404
  at that root-served host — document alive, assets dead, no console error
  possible before hydration even starts. This is the "white page, no console
  error" failure the increment names, and it reproduces on demand.
- Ringmaster: GO
- Open: nothing recorded against 1.3 itself.

## 1.4 — The page can now be published, and a browser says so first — 2026-08-28
- Files: `scripts/verify-export.ts`, `scripts/deploy.sh` (added, then
  corrected twice). Commits `2724584`, `ac6fe29`, `4faa4d2`.
- Proof:
  - Deployed page: `curl -s -o /dev/null -w '%{http_code}'
    https://kaush4l.github.io/ASKK/` → 200, and `ASKK_PAGE_ALIVE` is present
    in the fetched body.
  - `gh-pages` history: `git fetch origin gh-pages && git log --oneline
    origin/gh-pages -3` → `ebaea59 Deploy 4faa4d2` / `8b637dc Deploy 2724584`
    / `e38d514 Deploy 01edd0e`. `git merge-base --is-ancestor e38d514 8b637dc`
    and `... 8b637dc ebaea59` both succeed — both moves are fast-forwards, no
    rewrite. `git ls-remote origin gh-pages` → `ebaea59...` matching the local
    fetch, one ref, no divergence.
  - `bun run build` clean from a fresh `rm -rf .next out`, and `bun run types`
    exits 0 — both re-run myself, both green.
  - **Watched-red claim 1, reproduced**: ran `bun scripts/verify-export.ts`
    against the export served at the wrong prefix (root, via `bunx serve`)
    — output: `React never hydrated: no __react key on [data-page-mark]`
    plus five 404s, one per chunk the page actually requested, exit 1. This
    matches the commit's own description ("five 404s on the chunks and no
    hydration") on a build made in this same session, not a historical log.
  - **Watched-red claim 2, reproduced**: checked out
    `serve-subpath.ts` as it stood one commit before `4faa4d2`
    (`git show ac6fe29~1:scripts/serve-subpath.ts`), ran it, and
    `curl -sL http://localhost:4599/nope.woff2` returned `200`, `4712` bytes
    of the index page — the exact numbers `4faa4d2`'s own commit message
    states it measured. Ran the *current* `serve-subpath.ts` the same way:
    `/nope.woff2` → 404. Also deleted a real chunk from a copy of `out/` and
    confirmed the current server answers that path 404, not a masked 200.
  - `scripts/**` size: `wc -l scripts/*.ts scripts/*.sh` → 381 lines total,
    against a declared budget of +60 for this increment. The overrun is real
    and unshrunk as of this reading; recorded here, not judged here.
- Ringmaster: GO WITH CONDITIONS — both historical failures this wave claims
  to have watched red are independently reproducible on this machine as of
  this entry, which is the bar this file exists to hold work to. The
  conditions are the two items below, both already named by the coder rather
  than found by me:
  1. `scripts/deploy.sh`'s "nothing changed — gh-pages already serves this
     export" branch (line 114, the no-op path when `git diff --cached
     --quiet` on the worktree finds no change) has never been exercised —
     every deploy so far has had a diff to publish. Untested paths in a
     script that pushes to a public branch are a standing risk, not a defect;
     noting it rather than running a real deploy to force it, per
     instruction.
  2. `scripts/**` is 381 lines against a declared +60 budget for 1.4 alone.
     The coder declared this rather than burying it. Whether that overrun is
     acceptable is a ringmaster call, not mine.
- Open: the deploy.sh no-op branch (untested), and the scripts/** line
  overrun (declared, unjudged).

## 0.1 — Recon: three passes over two prior trees and ten outside harnesses — 2026-08-28
- Files: `docs/scratch/SALVAGE.md`, `docs/scratch/LESSONS.md`,
  `docs/scratch/MEASURED.md`, `docs/scratch/REFERENCES.md`. No commit hash
  recorded against this increment anywhere I can find — it predates the first
  commit in `git log` that names an increment number, and this entry itself
  is the first record of it existing as "0.1." Written from the documents as
  they stand today, after `MEASURED.md` and `LESSONS.md` were both since
  amended in place by later work (see 1.5 below).
- Proof (reading the four documents, not running anything — recon has nothing
  to execute):
  - `SALVAGE.md` inventories the old JS tree: ~1,400 lines to copy near-verbatim
    (the prompt/response/phase pillars), a fixed list of files to copy as text
    and never edit (four `agent.md` bodies, `tests/golden/*`), fifteen ideas
    ranked, seven things cut with a named reason each, and a "SERVERLESS
    OVERTURN" section that reverses its own earlier verdict once the
    zero-backend constraint is applied — the file catches its own
    contradiction rather than shipping it.
  - `LESSONS.md` compares ASKK against a second prior tree ("powerhouse") and
    names nine located defects, each converted to a rule (e.g. "never branch
    on `typeof window`", "no defensive `x.y ? x.y() : fallback` on our own
    code"). One of its own claims — defect 1, the realm-duplicated singleton —
    is itself overturned in the file by `MEASURED.md` M3: the guard was read
    from source and never checked against the built bundle, and the built
    bundle does not contain it.
  - `MEASURED.md` is the one document with executable content: five numbered
    facts (M1–M5) each taken from a scratch probe run in another directory,
    each with the actual emitted JS or console output pasted in, not
    paraphrased. M5 is the one this recon later had to correct — see 1.5.
  - `REFERENCES.md` studies ten outside agent harnesses and ranks ten mechanics
    worth stealing, with a "deliberately NOT stolen" section naming two
    specific reasons (Devika's isolation code is literally 0 bytes;
    smolagents' AST interpreter is not a security boundary by its own docs).
- Ringmaster: NOT PROVIDED — no ringmaster ruling on 0.1 itself is recorded
  anywhere in this tree; 0.3's entry above records a ringmaster GO on the
  *architecture* these four documents fed, not on the recon pass itself.
- Open: this entry is being written three increments after the fact, which is
  the exact defect the rule at the top of this file now exists to stop. The
  one thing recon could not have known at the time it was written: `MEASURED`
  M5 was wrong about what it had proven, and the correction (11dc9ea) landed
  inside 1.5, not here — recorded there, not edited into this file's account
  of what 0.1 actually produced.

## 1.5 — The measured facts became standing assertions, and one of them was wrong — 2026-08-28
- Files: `src/engine/probe.worker.ts`, `src/client/worker-probe.ts`,
  `scripts/verify-worker.ts`, `src/app/page.tsx`. Commit `cf08c69`, corrected
  in place by `11dc9ea` (`docs/scratch/MEASURED.md` only — no code changed
  between the two commits; the second commit is the correction of what the
  first commit's own measurement meant, not a new implementation).
- Proof:
  - `bun run gate` — GREEN, 6 checks, reported below under 1.6/2.1 together
    with the tree-wide run.
  - Built clean (`rm -rf .next out && bun run build`), served with
    `bun scripts/serve-subpath.ts out`, ran
    `bun scripts/verify-worker.ts http://localhost:4599/ASKK/` myself:
    ```
    control: a known-missing path returns 404 — this server can report failure
    probe: {"sentinel":"ASKK_WORKER_ALIVE","hasIDB":true,"hasLS":false,"hasLocks":true,"freeGrant":true,"heldByFirst":true,"secondGrantedWhileHeld":false}
    PASS ... the writer lock refuses a second holder while the first is pending
    ```
  - **Reproduced the watched-red claim myself, not cited it.** Edited
    `src/engine/probe.worker.ts`'s `hold()` to the wrong-but-obvious
    implementation the commit describes — `resolve(true); return
    Promise.resolve()` in place of `resolve(true); return new
    Promise<never>(() => {})` — rebuilt, re-served, re-ran the same command:
    ```
    probe: {..."secondGrantedWhileHeld":true}
    FAIL http://localhost:4599/ASKK/
      - THE ELECTION IS BROKEN: a second {ifAvailable:true} request was GRANTED
        while the first callback was still pending.
    ```
    Restored `probe.worker.ts` from a copy taken before the edit;
    `git diff --stat src/engine/probe.worker.ts` shows no diff against HEAD
    afterward — the working tree is clean of my edit. This is the correction
    to my own wave-1 error: I had cited M5 in an earlier report as proof the
    election worked. It measured the API, not the mechanism. The commit
    message says exactly this ("a probe that does not implement the mechanism
    does not test the mechanism") and I now have watched both sides of it
    myself rather than trusting the sentence.
- Ringmaster: NOT PROVIDED for this increment specifically. `11dc9ea`'s own
  message stands as the self-correction; no separate ringmaster ruling on
  1.5 is recorded in this tree.
- Open: `scripts/verify-worker.ts` is not yet wired into `bun run gate` —
  it runs only from `scripts/deploy.sh`'s browser step (added at 1.6). It is
  also not yet run against the deployed site as of this entry — see 1.6's
  Open note on deploy staleness.

## 1.6 — The gate: six checks, and it says out loud what it does not run — 2026-08-28
- Files: `scripts/gate.ts`, `scripts/checks/gate-coverage.ts`,
  `scripts/checks/size.ts`, `package.json`, `scripts/deploy.sh`. Commit
  `c5a61c3`.
- Proof: ran `bun run gate` myself just now. Real output:
  ```
  types — ok (tsc --noEmit, 0.5s)
  tests — 7 pass, 0 fail, 17 expect() calls, ok
  purity — src/core, 1 file scanned, ok
  size — src 5 files, scripts 7 files, total 1325 lines, max 214
         (scripts/checks/purity.ts; ratchet not armed until end of wave 2)
  gate-coverage — 3 checks on disk, 3 named by gate.ts, ok
  export — rm -rf .next out && next build, 19 files in out/, ok
  gate: 6 checks ran, 0 failed — GREEN
  ```
  The gate itself names seven checks not yet written (`realm.ts`,
  `layers.ts`, `protocol.ts`, `orphans.ts`, `bundle.ts`, `design.ts`,
  `smoke.ts`) and states which wave each arrives in, rather than staying
  silent about coverage it does not have.
- Ringmaster: NOT PROVIDED — no separate ringmaster ruling on 1.6 is recorded
  in this tree.
- Open: the deploy-time browser step (`verify-worker.ts` + `verify-export.ts`
  inside `deploy.sh`) has not actually been exercised against a real deploy
  since this commit — the deployed site (see below) is three commits stale,
  so neither browser check in the gate's own commit message has been proven
  against production, only against a local server. `scripts/verify-export.ts`
  is mid-edit uncommitted in the working tree as I write this (a coder is
  adding the §8.4 control assertion the retro named missing); I did not touch
  it and its current state is not part of this proof.

## 2.1 — The core has one door to the environment, and a check that watches it — 2026-08-28
- Files: `src/core/ports.ts`, `scripts/checks/purity.ts`,
  `tests/ports.test.ts`. Commit `f3e35de`. Amended by `4b6f5ca` (no code — a
  declaration-collision ruling written into `docs/ARCHITECTURE.md` and
  `docs/PLAN.md`: storage shapes stay in `core`, wire shapes stay in
  `protocol`, `engine/wire.ts` maps between them; 2.1 closed at "+260
  declared, +347 actual").
- Proof: `bun run gate`'s `purity` check passed against `src/core` as shown
  above (1 file scanned, ok). `tests/ports.test.ts` is 38 lines and its 7
  cases are inside the 7 `tests — pass` count the gate printed. I did not
  independently watch purity go red on the five planted violations the commit
  message names (`fetch(`, `Date.now()`, `new Date()`, `Math.random()`,
  `node:fs`) — the commit message states it was done, but the planted
  violations are not preserved anywhere in this tree for me to re-trigger,
  and reconstructing five deliberately-wrong files myself to verify a
  three-increment-old claim was not judged worth the cost given the working
  tree already has `src/core/ports.ts` mid-edit for a different reason (an
  in-progress coder change removing `isConfigured`, uncommitted, not part of
  this proof).
- Ringmaster: NOT PROVIDED for 2.1 in isolation — `4b6f5ca`'s message records
  "PLAN: 2.1 DONE" as the coder's own closing note, not a ringmaster ruling
  distinct from that.
- Open: `scripts/checks/purity.ts` shipped at 2.1 with `bun run purity` as its
  only caller and was not wired into `bun run gate` until 1.6, one commit
  later — "a check nobody runs" (this project's most-repeated defect,
  `LESSONS.md` defect 7 in spirit) landed and stood for one commit before the
  coder's own next commit caught it. `checks/gate-coverage.ts` now makes that
  gap structurally visible, but it did not stop this specific instance from
  landing first.

## Retro findings, recorded because the record itself was the finding — 2026-08-28
- **The deployed artifact is stale as I write this.** `git fetch origin
  gh-pages && git log --oneline origin/gh-pages -3` → `ebaea59 Deploy
  4faa4d2` is still the tip — the 1.4-era build. `curl -s
  https://kaush4l.github.io/ASKK/` → 200, contains `ASKK_PAGE_ALIVE`, but
  `grep -c data-worker-probe` on the fetched body → `0`. The 1.5/1.6/2.1 work
  above has never been deployed; every proof above that says "local server"
  says so because that is the only place it could be checked. A coder is
  working now (`src/core/ports.ts`, `tests/ports.test.ts`,
  `scripts/verify-export.ts` all show uncommitted changes at the moment of
  this entry) but nothing had landed as of this reading.
- **`verify-export.ts` had no control assertion.** Confirmed by the
  uncommitted diff on disk right now, which is adding one — this is being
  fixed as this entry is written, not yet proven green.
- **Cumulative budget, measured as of this entry** (working tree, `git
  ls-files`, including the uncommitted in-flight edit to `src/core/ports.ts`):
  `src/**/*.{ts,tsx}` → 360 lines (5 files). `scripts/**/*.ts` → 985 lines (7
  files); `scripts/deploy.sh` → 126 lines; scripts total (ts+sh) → 1111 lines
  (8 files). `tests/**/*.ts` → 38 lines (1 file). Grand total src+scripts+tests
  → 1509 lines. `bun run gate`'s own `size` check reports a narrower number
  by its own method (excludes `.sh`, and possibly other exclusions I did not
  trace) — 1325 lines across src+scripts, 12 files. Both numbers are recorded
  because they disagree and I could not account for the full gap; see
  UNCLEAR below. Not judging whether either number is acceptable against the
  declared +800 — that is the ringmaster's call, already made per this
  increment's framing.

## 2.2 — The inference contract, and a fake honest enough to drive a turn — 2026-08-28
- Files: `src/core/inference/base.ts` (new, 91 lines / 81 non-blank),
  `src/core/inference/scripted.ts` (new, 84 lines / 78 non-blank),
  `tests/inference.test.ts` (new, 5 cases). Written by the coder; this entry
  lands in the same commit as the code, per the retro rule in this file's
  header.
- Proof: `bun run gate` → **`gate GREEN`, 6 checks ran, 0 failed** (types,
  tests, purity, size, gate-coverage, export). Within it: `10 pass / 0 fail /
  24 expect() calls` across 2 files; `purity: src/core — 3 file(s) scanned,
  ok`; `size: total 1455 non-blank lines across src + scripts`, `max 195 lines
  — scripts/checks/purity.ts` (ratchet still unarmed, it arms at the end of
  wave 2). PLAN's acceptance — *a scripted fake drives a full turn in a host
  test* — is `tests/inference.test.ts`'s `runTurn`, which reads the session,
  appends the user message, records `describeRequest` as an event, streams the
  reply through `onDelta`, and appends the assistant message; the store
  allocates both `seq`s (1, 2) and the assertion is on those numbers. The
  transport is constructed with `stubPorts().fetch`, so a network call would
  fail the suite with `no fetch port configured` rather than pass quietly.
- Watched red: the streaming assertion was proven, not trusted. Replacing
  `for (const chunk of reply.chunks)` with
  `for (const chunk of [reply.chunks.join("")])` in `scripted.ts` turned
  **2 of 10 tests red** — `expect(received).toBeGreaterThan(expected) /
  Expected: > 1 / Received: 1`, and the abort case, which can no longer
  interrupt a one-chunk stream. Restored, `10 pass / 0 fail`. Recorded because
  of what stayed *green* under the break: `deltas.join('') === text` passed
  with one chunk, which is exactly why the chunk **count** is a separate
  assertion and not folded into the concatenation one.
- Ringmaster: not yet ruled.
- Open:
  - **`inferenceFor(kind, config, fetchPort)` (ARCHITECTURE.md §5.2) was NOT
    implemented**, deliberately. It is `core/inference/catalog.ts` in §4 and it
    would be a factory with one entry until 2.3 lands the second concrete —
    "no knob with one caller". It belongs to 2.3.
  - **`RequestRecord` is declared in `core/inference/base.ts`, not imported
    from `protocol/shapes.ts`** where §4 also names it. That is §7.4's ruling
    applied — core owns its vocabulary, protocol declares its own, `engine/
    wire.ts` maps between them — and it is the second instance of the
    collision 2.1 found with `MessageRecord`. Flagged rather than resolved,
    because resolving it is 3.2's job and `SHAPE_PAIRS` will need this pair.
  - **`RequestRecord` has no `headers` field**, so the Context surface cannot
    render the Authorization header. That is on purpose (§7.2's `hasKey`
    reasoning: the key must not reach the render realm) but it means "the
    literal request body that left the tab" is literal about the *body* and
    silent about the headers. If 6.4 needs a redacted header list, it is an
    architect decision, not a coder one.
  - `src/core/ports.ts`'s header comment still reads "Four members, each with
    a caller." As of this increment `FetchPort` has one — `Inference`'s
    constructor — and the other three still do not. Left alone: it is the one
    untrue sentence the retro found that no check can catch, and rewriting it
    is the architect's.

## 2.3 — The second concrete, streaming from a real endpoint — 2026-08-28
- Files: `src/core/inference/openai.ts` (new, 241 lines / 226 non-blank),
  `src/core/inference/catalog.ts` (new, 41 / 37),
  `tests/inference-http.test.ts` (new, 12 cases against a fake chunked
  `ReadableStream`), `tests/inference-http-live.test.ts` (new, 2 cases against
  a real endpoint, skipped when none answers). Written by the coder; this entry
  lands in the same commit as the code.
- Proof: `bun run gate` → **`gate GREEN`, 6 checks ran, 0 failed** (types,
  tests, purity, size, gate-coverage, export). Within it: `24 pass / 0 fail /
  65 expect() calls` across 4 files; `purity: src/core — 5 file(s) scanned,
  ok`; `size: total 1725 non-blank lines across src + scripts`, `max 226 lines
  — src/core/inference/openai.ts` (ratchet still unarmed).
- **The acceptance was taken against a real endpoint, not a fake.** omlx on
  `http://127.0.0.1:8873/v1` answered; `tests/inference-http-live.test.ts` runs
  inside `bun test` and therefore inside the gate, driving
  `granite-4.2-30b-MLX-8bit` through `OpenAiInference` with the **global
  `fetch` passed as the `FetchPort`**. Seven `content` deltas arrived, the
  first and last separated in time, `deltas.join('') === result.text`, and
  `usage.completionTokens` came back 110 from the server's own
  `stream_options: {include_usage: true}` frame. On a machine where nothing
  answers `/models` in 2s the file skips and says so by name; the fake-stream
  suite is the regression guard that runs everywhere.
- **Watched red, five ways.** Each break was applied to the shipped file, the
  suite run, and the file restored:
  1. *Collapse the stream to one delta* (accumulate, emit once at the end) —
     `Expected: > 1 / Received: 1`, 4 of 12 red.
  2. *Buffer the whole body, then chop it into frames* — the exact "fake it"
     shape. **`more than one delta arrives` stayed GREEN**, 10 of 12 passed,
     and only `deltas arrive before the stream is finished, not after` caught
     it, by hanging to its 5000ms timeout. That case's fake refuses to produce
     its second chunk until the first delta has fired, so a buffering transport
     deadlocks instead of passing. This is why a chunk **count** is not
     sufficient evidence of streaming and the timing case exists.
  3. *Remove the `JSON.parse` guard* — `SyntaxError: JSON Parse error:
     Unterminated string`, 2 of 12 red; restored, a truncated `data:` frame and
     a `data: not json at all` frame are dropped and the reply survives.
  4. *Remove the mid-loop `signal?.aborted` check* — `Received promise that
     resolved`, 1 of 12 red.
  5. *Reset the UTF-8 carry between chunks* — `Expected: "héllo 🌊 wörld" /
     Received: "héllo �� wörld"`, 1 of 12 red. A frame split mid-character
     across two reads is what that decoder is for.
  The live `>1` assertion was also watched red for a real reason before it was
  green: at `max_tokens: 48` the endpoint never left its reasoning phase and
  flushed the whole accumulated `reasoning_content` as **one** `content` chunk
  on `finish_reason: length`. Raising the budget to 600 made it seven deltas.
  A server's truncation behaviour, recorded because it will bite the budget
  work in 2.6.
- Line budget: **+260 declared, +618 actual** (382 of it tests). Recorded, not
  waived. The overrun is three things the increment could not buy separately:
  a hand-written incremental UTF-8 decoder (`TextDecoder` is an ambient global
  and §3.4 grants `src/core/**` none), the defensive frame reader, and the
  timing case in 2 above, which is the only assertion that can tell streaming
  from buffering. The architect's call, per §8.3.
- Ringmaster: not yet ruled.
- Open:
  - **`Uint8Array` is not in `checks/purity.ts`'s `ES_GLOBALS`**, so
    `new Uint8Array()` fails purity as a "free global". Typed arrays are
    ECMAScript built-ins that carry no environment, exactly like `Map` and
    `JSON` which are on the list. Not worked around and not fixed: the code
    reads `if (step.value !== undefined)` instead of defaulting, and the reason
    is a comment at the call site. `checks/purity.ts` is not this increment's
    file.
  - **`inferenceFor('scripted', …)` cannot be given a fixture.** §5.2's
    declared signature is `(kind, config, fetchPort)` and `ScriptedInference`
    needs a third construction argument. The catalogue passes `[]`, so the
    fake it returns refuses its first call with `scripted inference has no
    reply 1 — the fixture holds 0` — loud, and asserted. It is not silent, but
    it is a catalogue entry that cannot produce a usable transport, and whether
    `scripted` belongs in the catalogue at all is the architect's call, not a
    coder's contortion of the declared signature.
  - **The base needed no change to fit the second concrete.** `infer(req,
    onDelta?, signal?)` and `describeRequest` were both sufficient as written,
    which is the two-concrete justification §5.2 claimed, now observed.
  - **`stopReason` has no honest empty value.** It is `string`, not
    `string | null`, so a server that names no `finish_reason` gets
    `end-of-stream` — a fact about the stream rather than a guessed `stop`.
    Flagged because `usage` was deliberately made nullable for the same reason
    and `stopReason` was not.
  - **`reasoning_content` is dropped, not streamed.** The measured endpoint
    interleaves it; §5.2 says `text` is the model's reply, and reasoning is
    not the reply. If a Thinking surface ever wants it, that is a base change.
  - **No retries, and no timeout.** SALVAGE F-7 named retries as one of three
    things the old transport claimed and lacked; this one does not claim them.
    §6.5 already forbids the deadline that cannot cancel.
  - **`docs/PLAN.md`'s 2.3 row still reads `TODO`** and `ARCHITECTURE.md` §4's
    entries for `core/inference/openai.ts` and `core/inference/catalog.ts` are
    untagged. Both are the architect's files; this entry is the coder's only
    edit under `docs/`.

## 2.4 — The react loop, ending on a declared terminal — 2026-08-28
- Files: `src/core/observer.ts`, `src/core/agent/{session,transcript,agent,react}.ts`, `tests/agent-react.test.ts`
- Proof: `bun run gate` → **6 checks ran, 0 failed · gate GREEN**; `bun test` →
  `34 pass, 0 fail, Ran 34 tests across 5 files`; `purity: src/core — 10 file(s)
  scanned · ok`; `size: max 226 lines — src/core/inference/openai.ts`.
  The ten new tests were each watched red for the reason they exist, by mutating
  `src/` and running `bun test tests/agent-react.test.ts`:
  1. *Post `assembled` after `infer` returns instead of before* — 2 of 10 red
     (`every lifecycle event fires, in order` and `assembled reports the prompt
     that is about to go out`). The second is the causal one: its observer
     asserts `inference.received` is still empty **at the moment the event
     fires**, so an implementation that emitted every event with every correct
     payload, one step late, still goes red. Event counts alone cannot see this.
  2. *Emit `entered` only on the first arrival* — 1 of 10 red. On a react agent
     the round is the only thing that moves, so a single `entered` is a live
     phase view with nothing to show after the first millisecond.
  3. *Let a repeated call reach the tool runner* — 3 of 10 red. The assertion is
     on `ran`, the list of calls the runner actually received: tier 2 of the
     guard is "the tool does **not** run", which a transcript assertion alone
     would not have caught.
  4. *Throw at the repeat limit instead of synthesising an answer* — 2 of 10 red.
     Tier 3 is the property that the loop ends **with a reply**.
  5. *Drop `onDelta` from the `infer` call* — 2 of 10 red.
  6. *Build the prompt once and reuse it* — 1 of 10 red; the prompt is rendered
     again each pass against the transcript as it then stands.
- Ringmaster: not yet ruled
- Open:
  - **No `FLOWS`, no driver, no `MAX_TRANSITIONS`** — 4.5's, per §5.6. What is
    here is the shape they plug into: `OUTCOMES`, `outcomeOf()` and a `TERMINAL`
    the loop ends on and nothing else does.
  - **The prompt and the tools are seams, and neither has a stand-in in `src/`.**
    `RenderPrompt` is filled by 2.6's assembler and `ToolRunner` by 4.2's
    toolbox. The doubles are in the test file, where they are obviously doubles.
    The one place this leaks is `NO_TOOLS` in `react.ts`: a model that calls a
    tool on an agent with no runner reads `Tool not found. Available: none`,
    which is `Toolbox.call`'s own sentence minus the `<tool>: ` prefix its
    `ToolResult` renders — naming the tool means parsing the call, and the
    parser is 4.2's. The constant moves to the toolbox when the toolbox lands.
  - **`StorePort` still has no caller**, so §5.1's "arrives at 2.4" is now true
    of `newId` only. The transcript is in memory: persistence is 3.4 and
    worker-owned, and a transcript writing through a store in wave 2 is the
    migration the realm split exists to prevent. `src/adapters/test/store.ts`,
    which §4 tags `[2.4]`, is therefore not written — it is not this
    increment's file and it has nothing to serve. Architect's call.
  - **`Session.seen` keys on the whole batch text**, so `a(), b()` and
    `b(), a()` are two entries. SALVAGE records it as a known defect; ported as
    it stands, named at the field, and fixable only by the batch parser at 4.2.
  - **`Agent.turn` records `parsed.answer.trim()` and nothing else.** A
    structured reply's other fields (a react `think`) never reach the
    transcript, which is the Python's behaviour and is what makes the golden
    history in `tests/golden/react-loop.json` four lines long.
  - **The observer's `results` fires once per tool step, not per batch.**
    SALVAGE item 10 wants per batch; a batch is a fact the toolbox knows and
    2.4 has no toolbox, so the event carries the observation text the model
    reads next. It gains `ToolResult[]` at 4.2, not a guess now.
  - `docs/PLAN.md`'s 2.3 row still reads `TODO` although 2.3 shipped at
    `a455a0c`, and §4's `core/agent/*` entries are tagged `[2.4]` and now exist.
    Both are the architect's files.

## 2.5 — Structured response: the field table is the contract — 2026-08-28
- Files: `src/core/response/{base,parse,responses}.ts`, `tests/responses.test.ts`, `tests/golden/react-loop.json`
- Proof: `bun run gate` → **6 checks ran, 0 failed · gate GREEN**; `bun test` →
  `60 pass, 0 fail, Ran 60 tests across 6 files`; `purity: src/core — 13 file(s)
  scanned · ok`; `size: max 235 lines — src/core/response/base.ts`.
- Proof, the bytes: the prompt text is not asserted to be the Python port's, it
  is **measured against it**. `git worktree add /tmp/pw pre-workbench` and a
  script importing `/tmp/pw/core/responses.js` beside `@/core/response/responses`
  printed `IDENTICAL — 7 classes, FIELDS + both instructions + formatNotes +
  answerField` — every `description`, both rendered instruction blocks per
  class, `FORMAT_NOTES` and every answer field, compared string by string. The
  worktree was removed afterwards; the script is not kept, because it can only
  run where the old tree is checked out and a check that cannot run is not a
  check (§8.6). What survives in the suite are `toContain` assertions on the
  load-bearing lines, watched red below.
- Proof, the oracle: `tests/golden/react-loop.json` is restored from the tag and
  **verified, not assumed** —
  `git show pre-workbench:tests/golden/react-loop.json | md5` and
  `md5 -q tests/golden/react-loop.json` both print
  `dad3bec80ba2878f53262aa44d78caf0`, and `git hash-object` of the restored file
  is `490442ad674bd26b658240d79a8f10109872ff9d`, which is the blob
  `git ls-tree pre-workbench` names. The md5 is asserted in the suite, so
  editing the fixture is red.
- The twenty-six tests were watched red, by mutating `src/` and running
  `bun test tests/responses.test.ts`:
  1. *Try only the requested format* — 2 of 26 red.
  2. *Throw instead of dropping the reply into the answer field* — 4 of 26 red.
     This is the "never throws" property, and it is asserted over thirteen
     malformed shapes × two formats × all seven classes.
  3. *Resolve an unknown enum to the permissive value* (`simple`, `pass`) —
     1 of 26 red. `normalize` fails toward the careful branch.
  4. *Delete the act-rescue* — 2 of 26 red. `act: echo({...})` with an empty
     `result` is what small local models actually write.
  5. *Change one prompt byte* — an em dash to a hyphen in the JSON
     instructions — 1 of 26 red.
  6. *Edit one byte of the golden fixture* (`done: hey` → `done: HEY`) —
     2 of 26 red: the md5 assertion and the loop parity.
  7. *Let a list field accept a bare string* — 1 of 26 red. Pydantic's refusal
     to coerce is why an unparseable reply to `CritiqueResponse` comes back
     empty rather than as one long finding.
- Ringmaster: not yet ruled
- Open:
  - **`ReActResponse` satisfies 2.4's `ReplyModel` with no adapter**, which is
    the whole reason that seam was declared as two functions. The golden test
    hands the class straight to `new Agent({ model: ReActResponse })` and drives
    the real loop to the recorded answer and the recorded four turns.
  - **`answerOf` is new API on the base**, not in §5.4's signature list. It is
    the give-up the repeat guard synthesises, expressed once instead of at the
    call site: the old tree wrote `new model({[model.answerField()]: text})`
    inside the loop, which puts the field table in the loop's hands. A list
    answer field takes the text as its single item, because `accept` refuses a
    bare string for a list and a give-up that raised would defeat itself.
    Architect's call whether §5.4 should name it.
  - **`isAnswer` is on the base, returning `true`.** The Python had it as a free
    function reading `getattr(parsed, "is_answer", True)`; as a property it is
    the same rule, expressed where the type system can see it, and it is what
    makes every response class usable as a `ReplyModel`.
  - **Python's `str()` came across as fifteen lines inside `base.ts`, not as a
    `py-str` module.** Only one caller is left in this tree — a list answer
    field rendered with Python's `repr` per item, quote character switching so
    an apostrophe in a finding stays well formed. The other two callers named in
    the old `py-str.js` header are in `tools.js`, which is 4.2's.
  - **`ResponseContract` is not here.** It is the RESPONSE-slot component and §4
    puts it in `core/prompt/components.ts` at 2.6, along with the per-class
    memo of the rendered instructions that the old tree kept beside it.
  - **`ResponseClass<T>` names the statics it needs instead of intersecting
    `typeof BaseResponse`**, which is abstract and therefore not constructible
    — `new this(...)` is TS2511 otherwise.
  - **The other three goldens are still only at the tag.**
    `render-{bare,full,plain-text}.prompt` are prompt-assembly fixtures with no
    reader before 2.6, and 2.0 is the increment that lands `tests/golden/`
    whole with an md5 per fixture. `react-loop.json` came in early because 2.5
    has a use for it today; 2.0's job is now the other three and generalising
    the assertion this file inlines.

## 2.6 — Prompt assembly: a sorted bag of immutable components — 2026-08-28
- Files: `src/core/prompt/{slots,template,component,components,assembler,recipe}.ts`,
  `tests/prompt.test.ts`, `tests/golden/render-{bare,full,plain-text}.prompt`
- Proof: `bun run gate` → **6 checks ran, 0 failed · gate GREEN**; `bun test` →
  `86 pass, 0 fail, 408 expect() calls, Ran 86 tests across 7 files`;
  `bun run types` clean; `purity: src/core — 19 file(s) scanned · ok`;
  `size: total 3329 non-blank lines across src + scripts`,
  `size: max 235 lines — src/core/response/base.ts`.
- Proof, the oracle: the three prompt fixtures are restored from the tag and
  **verified, not assumed**. `md5 -q` and `git hash-object` of each restored
  file against `git show pre-workbench:<path> | md5` and
  `git ls-tree pre-workbench tests/golden/`:

  | fixture | md5 | blob |
  |---|---|---|
  | `render-bare.prompt` | `85a6ed70916df610ea9db80c513ce335` | `4ed7ba66dee13cabd33827851b7a59c91f516e2c` |
  | `render-full.prompt` | `76d49f369b33d058b29f68adbc89cd7b` | `37e0b61a0d34a43a2ad8e661059a9df159cfdd57` |
  | `render-plain-text.prompt` | `5c5f1a0c81b17fdc8dfdac3b7a9a87d1` | `4113ae1a52197b702bfbc936401d8f288f87eee4` |

  All three md5s are asserted in the suite, so editing a fixture is red — watched.
- Proof, the bytes: measured against the old tree, not asserted about it.
  `git worktree add <tmp> pre-workbench` and a script importing
  `<tmp>/core/{components,tool-prompt,responses,assembler,component-base}.js`
  beside `@/core/prompt/*` printed **9/9 identical, byte for byte** over every
  component's rendered output (Soul, SystemInstructions, ContextBlock including
  its multi-line-value rule, History, ToolboxComponent, and ResponseContract in
  react/toon, react/json and no-model form), and `identical` for the `Slot`
  table, `MEMO_LIMIT` and all three `AssemblyError` sentences. The worktree was
  removed; the script is not kept, because it can only run where the old tree is
  checked out and a check that cannot run is not a check (§8.6). The three
  goldens are what survives in the suite.
- **The date trap is asserted, not just commented.** All three fixtures carry
  `current time: 2026-08-16 12:00:00 PDT` beside `day: Saturday`, and
  `Intl.DateTimeFormat` calls that instant a **Sunday** — the suite asserts both
  halves, so the next reader meets the contradiction as a passing test rather
  than as a bug to "fix". It is why `Recipe.context` is a function and not a
  clock.
- Eighteen assertions were watched red, by mutating `src/` (and once
  `tests/golden/`) and running `bun test tests/prompt.test.ts`. 26 tests total:
  1. *One prompt byte* — `## AVAILABLE TOOLS` → `## TOOLS` — 1 red.
  2. *One fixture byte* — `Sys.` → `Sys!` in `render-bare.prompt` — 2 red: the
     md5 and the parity.
  3. *`Slot.RESPONSE` 99 → 45* — 4 red, including two of the three goldens.
  4. *Invariant 1 deleted* (exactly one RESPONSE) — 2 red.
  5. *Invariant 2 deleted* (an agent must be someone) — 1 red.
  6. *Invariant 3 deleted* (RESPONSE sorts last) — 1 red.
  7. *`applies()` ignored* — 5 red. An elided component is elided from the
     prompt **and** from the breakdown.
  8. *Memo disabled* — 2 red.
  9. *`ContextBlock.CACHEABLE` → true* — 1 red. The memo assertions are causal:
     a counter on an overridden `render()` says the work was **skipped**, not
     that a flag was set.
  10. *`History.key()` separator NUL → space* — 1 red. `["a b","c"]` and
      `["a","b c"]` collide without it.
  11. *`key()` reading the instance's own property order instead of `FIELDS`* —
      1 red.
  12. *`NAME` read off `constructor.name`* — 2 red.
  13. *`utf8Bytes` counting UTF-16 code units* — 1 red.
  14. *`detail()` no longer carrying `CORE_MARK`* — 1 red.
  15. *The Sunday assertion aimed at Saturday* — 1 red.
  16. *Transcript lines losing their `[ROLE]` prefix* — 1 red.
- Ringmaster: not yet ruled
- Open:
  - **The `max` ratchet is NOT armed and `scripts/checks/lines.json` does not
    exist.** PLAN 2.6 names it, and it lives in `scripts/`, which was outside
    this increment's file ownership. `size.ts` still prints
    `no delta reported — scripts/checks/lines.json does not exist and nothing
    writes it` and `max 235 lines … (ratchet NOT armed)`. It needs one more
    increment, or an ownership grant, and it must be seeded **after** this work
    landed — which is now true.
  - **`ClockPort` still has no caller**, against `ports.ts`'s own comment that it
    arrives at 2.6. Rendering `2026-08-16 12:00:00 PDT` and `Saturday` from a
    `Date` and an IANA zone needs `Intl`, and §2.1 bans `Intl` from
    `src/core/**` by name because `resolvedOptions()` reads the host. So the
    derivation has no pure home: it belongs to `adapters/browser/clock.ts` (3.1)
    and `adapters/test/clock.ts`, and `Recipe.context` takes the answer. This is
    also the seam the oracle needs — the Python's test replaced `Agent.context`
    wholesale for the same reason. `adapters/test/clock.ts` is tagged `[2.6]` in
    §4 and was not built: `src/adapters/` was not in this increment's files.
  - **`{% for %}` is not in `template.ts`**, although §4 describes the renderer
    as `{{ }} / {% if %} / {% for %}`. Every component that used it —
    `CritiqueFindings`, `SkillCatalog`, `LoadedSkills` — has no data source in
    this tree, so the tag would have been a code path with no caller. It refuses
    at compile time naming the tag, so re-adding it is a load error rather than
    a silently wrong prompt. Architect's call.
  - **Four components §4 names are absent**: `PhaseInstructions`,
    `CritiqueFindings`, `SkillCatalog`, `LoadedSkills`. Phases are 4.5 and
    skills have no increment; a component with no producer is a block that can
    only render empty.
  - **No `component-registry.js` equivalent.** The old tree's name → class table
    existed to serve an `agent.md` `components:` list, which is 4.1.
    `recipe.ts` names the six components directly.
  - **`promptFor` has no production caller yet.** `engine/build-agent.ts` (4.1)
    is what wires a recipe to an `Agent`; the suite drives the real
    `RenderPrompt` seam through a real `Session` and `Transcript`.
  - **`Breakdown` is declared in `core/prompt/assembler.ts`, not in
    `protocol/shapes.ts`**, which §4 tags `[3.2]` for `PromptBreakdown`. Core
    may not import protocol, and the wire shape is 3.2's to declare and map.
  - **`CORE_MARK` is `askk/core@prompt-assembler`**, returned as
    `Breakdown.build`. Named here because `checks/bundle.ts` (3.1) is what reads
    it and the value was this increment's to pick.
