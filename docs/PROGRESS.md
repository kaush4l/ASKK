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
