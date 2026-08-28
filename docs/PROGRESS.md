# PROGRESS

> Owned by the **junior**. One entry per increment, appended, never rewritten.
> An entry without a reproducible proof is not an entry — write
> `Proof: NOT PROVIDED` and say so out loud rather than inventing one.

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
