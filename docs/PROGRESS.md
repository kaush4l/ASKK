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
