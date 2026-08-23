# TEAMS — the gauntlet loop

> The lead holds the goal and does not write code. A team is four roles and one
> increment. Nothing lands that has not survived the gauntlet.

## The law this file serves

Simplicity is the architecture. Every other property (legibility, testability,
swappability) is downstream of it. The measures, not the adjectives:

- A file ≤ 200 lines. A function ≤ 40. A dependency carries a one-line reason.
- **Deleting beats adding.** An increment that removes a mechanism and keeps the
  capability outranks one that adds a mechanism.
- **No speculative generality.** A type with zero construction sites is a defect,
  not a foundation. (`crates/script` was 155 lines of `todo!()` in the shipping
  graph for one unconstructed error variant.)
- **I17: a claim the gate cannot execute is not a verified claim.** The gate is
  six checks (`docs/STATUS.md`); one of them deploys.
- **I16: a truth the system holds and does not state is a defect.**
- One seam: `handle(Request) -> Response`. Everything reaching the LLM is a
  component (`docs/ARCH-COMPONENTS.md`). Adding one is a declaration.

## The four roles

| Role | Owns | Forbidden |
|---|---|---|
| **researcher** | Read-only survey. Returns `file:line` facts and MEASUREMENTS, never opinions. Every number is a command someone else can re-run. | Writing files. Proposing fixes. |
| **planner** | Turns the survey into ONE increment: scope, the files it owns, and falsifiable acceptance criteria. Names what it is NOT doing. | Writing product code. Widening scope past one increment. |
| **coder** | Implements exactly the planned increment. Runs the six-check gate. Stops. | Landing anything outside its file list. Shipping a green claim it did not execute. |
| **bar-raiser** | Attacks its own team's work, hostile and specific. Rules GO or NO-GO with evidence. A NO-GO must name the command that shows the defect. | Politeness. Ruling on prose alone. |

## The gauntlet (one increment)

```
researcher  -> measurements       (no fixes)
planner     -> charter            (scope + acceptance + file ownership)
bar-raiser  -> attack the CHARTER  (before a line is written)
coder       -> implement + 6-check gate
bar-raiser  -> attack the RESULT   (GO / NO-GO with a reproducing command)
lead        -> rule, then ship
```

A NO-GO returns to the coder with the reproducing command. Two NO-GOs on the
same increment returns to the planner: the charter was wrong, not the code.

## AAA output standard (every role, every artifact)

1. **Every claim carries its evidence inline** — `path:line`, or the command and
   its output. A claim with no command behind it is deleted, not softened.
2. **Positive control on every new test** (T59 rule): state in the commit message
   the one-line revert that makes the new test go RED. A test that stays green
   under the broken version measures nothing.
3. **Name what you did NOT do and why.** Silent narrowing is the defect; stated
   narrowing is a decision.
4. **Numbers, not adjectives.** "Faster" is a defect; "26.7s → 3.16s" is work.
5. **Write for a reader who was not here.** Prose discipline is not verification —
   it is the half a reviewer cannot audit, so it never substitutes for a gate.

## File ownership

Teams run in parallel ONLY over disjoint file sets. Each charter lists the files
it owns; a coder that needs a file it does not own stops and reports to the lead.
(Measured 2026-08-22: overlapping ownership produced empty-file overwrites and a
silent alphabetical-order hijack.)

## Reporting

Each team reports to the lead at three points: charter written, gate green,
bar-raiser ruled. A team that cannot report a measurement reports the blocker
instead. The lead steers on divergence; a team never blocks waiting for the lead
except on secrets, network allowlists, or destructive storage (§17).
