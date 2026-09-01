# The three seats

Every slice is built and judged by three fresh contexts. None of them sees
another's reasoning. They see the artifact and the verdicts.

This file exists because these roles were carried in the lead's head for four
waves, and a misheard word — "razor" for "raiser" — ran that whole time with
nobody able to check it against anything. A role that is not written down is
not a role, it is a habit.

## Coder

Builds the slice. Owns the files named in the brief and no others.

## Critic

Asks one question: **is this true.**

Runs the gate. Re-derives every number the coder reported rather than
believing it. Spot-checks citations against the cited line. Breaks each
covered source line and confirms the test goes red — a test that passes
against broken source covers nothing.

Hunts this tree's signature defect: something declared, documented as
load-bearing, and never emitted. It has shipped in `AgentState::phase`, in
`## observations`, in the redirect-landed URL, and it will ship again.

Verdict is PASS or FAIL. Praise is not useful.

**A gate claim names the tree it was run against.** Where slices share one
working tree, "`bun run check` is green" is not a claim any single seat can own:
four coders in one tree produced six mutually contradicting pass counts and
three false REDs from concurrent writes, all in one wave. Report the run and the
tree state; the run after integration is what settles it. `docs/GATE.md`.

## Bar raiser

Asks a different question: **is this the standard we want to be held to.**

The critic can pass code that is correct and still beneath the bar. The bar
raiser is the seat that says so. It is not a second critic and it does not
re-run the gate.

It owns four things:

**Current platform standards.** This tree is Bun 1.4 and modern browsers, with
no transpile step over `src/`. Hand-rolled code that duplicates a platform
primitive is beneath the bar: `AbortController`/`AbortSignal.any`, `structuredClone`,
`Object.groupBy`, `Array.prototype.at`, `#private` fields, `??=`, iterator
helpers, `Promise.withResolvers`. Naming a primitive is not enough — the bar
raiser must show the rewrite.

**Code style the linter cannot see.** biome owns the mechanical half. The bar
raiser owns the rest: what a module exports, how a file is ordered, whether a
name says what the thing is, whether a comment argues for a decision or just
restates the line under it.

**Design, and composition first.** Inheritance is the default this tree keeps
reaching for — `git grep extends src/` is the running count, and it is 19 real
`extends` today, down from 25; both three-deep chains were deleted in the wave
that count comes from, so nothing is deeper than two right now. Composition over inheritance is the standing rule:
an abstract base with exactly one real implementation is an interface pretending
to be a hierarchy, and a base class that reaches down into subclass behaviour
is a hierarchy pretending to be a strategy. The tree already has the pattern it
should be using — a capability that needs the outside world arrives as a **port
passed to a constructor**, and `composition.js` is the only file that knows both
a service and an adapter exist. Where a new hierarchy appears, the bar raiser
asks whether a port would have done it.

**Nothing that does not earn its place.** A raised bar is not more code. A
layer, an option, an abstraction or a paragraph of prompt that earns nothing
lowers the bar, because everyone after pays for it — and prompt text is paid on
every turn of every run, forever, on an endpoint with no caching. This is the
old razor, kept, because refusing ceremony is part of the standard and not a
separate seat.

Verdict is MEETS or RAISE. A RAISE names the file and line, the rewrite, and
what it buys. "Consider extracting" is not a verdict.

## The standing rules

These are not slogans. Each one is checkable against a diff, and each was
written because the survey in `docs/LEDGER.md` found the same defect more than
once.

**A declaration ships with its writer, in the same diff.** Any constructor
parameter, enum value, prompt-block id or `static` default that a change adds
must have a line, somewhere in that same change, that writes a non-default
value to it — and `git grep` for the name must return a producer outside the
file that declares it. If it does not, delete the declaration rather than land
it dark.

This rule was written when the count stood at five: `AgentState::phase`,
`## observations`, the redirect-landed URL, `Engine`'s `soul`, and `Format`'s
JSON arm. The wave cut to close those found five more by sweeping rather than
reading, and three of those are still dark. The running list is
`docs/LEDGER.md`, "The bar-raiser survey", and it is kept there rather than here
because a rule that has to be edited every time it is broken stops reading as a
rule.

The corollary that wave paid for: **a slice owns files, but a defect belongs to
whoever finds it.** `Envelope.methods` was found independently by two seats and
closed by neither, because it sat outside every coder's owned file set. A
declaration nobody may delete is not reported — it is a row, filed the same
hour, with the grep that found it.

**A subclass ships with behaviour.** A new `extends` is a RAISE unless the
subclass body holds at least one method that does more than return a literal.
If every member is a `static` constant or a one-expression hook, it is a row in
the registry that already constructs it, and the value belongs in that registry
object rather than in a file of its own.
