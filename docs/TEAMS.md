# TEAMS — how the four lanes run

> The lead agent owns this file, `STATUS.md`, `packages/kernel`, the gates, and
> the deploy. Everything else belongs to a lane.

## The four lanes

| Lane | Name | Owns, exclusively | Never touches |
|---|---|---|---|
| A | **PAPER** | `packages/context/**` | anything else |
| B | **LOOP** | `packages/agent/**` | `packages/context` (imports it, never edits it) |
| C | **SPINE** | `packages/core/**`, `packages/adapters-web/**` | `packages/agent`, `packages/context` |
| D | **FACE** | `apps/web/**` | every `packages/**` (imports, never edits) |

**File ownership is the whole conflict story.** Two lanes never edit one file.
Disjoint files is not enough on its own — a lane that needs a change in another
lane's package files a REQUEST in `STATUS.md` under *Cross-lane requests* and
keeps going against the contract that was frozen, rather than reaching across.

## The increment protocol

A lane does one increment per turn. An increment is:

1. **Read the lifecycle first.** Before writing a line, read the Rust source it
   replaces AND everything that calls it. A faithful translation reproduces the
   BEHAVIOUR and the reasons, not the shape. Where the Rust shape was a
   consequence of Rust — a trait to get dynamic dispatch, a newtype to get a
   distinct type, a module to get a privacy boundary — the JavaScript is
   allowed and expected to be simpler. Where the shape was a consequence of the
   PROBLEM, it survives.
2. **Write the code.** Files ≤ 200 lines, functions ≤ 40, `strict` types, typed
   errors, every dependency justified in one line.
3. **Write the test that executes the claim.** Not a test that asserts the code
   does what it does — a test that would FAIL if the behaviour regressed. Host
   only: `bun test`, no browser.
4. **Run the gate.** `bun run gate`. Green or the increment is not done.
5. **Bar-raiser.** See below. A NO-GO returns to step 2, not to step 1.
6. **Commit.** One commit per increment, message in the house style: what
   changed, and the reason a reader could not have guessed.
7. **Report one row** for `STATUS.md`.

## The bar-raiser

Every increment is reviewed by an agent that did not write it, against these
questions and no others:

- **Can a person read this in one pass?** Name the function that cannot be, and
  say what it is doing that hides its shape.
- **How many things must be held in mind at once to change this safely?** If the
  answer is more than three, name them.
- **Is anything here ceremony?** A wrapper that only forwards, a type with one
  construction site, an abstraction with one implementation, a config nobody
  reads. Name it and propose the deletion.
- **Does a test EXECUTE each claim, or only assert it?** Name the claim that is
  prose (I16, I17).
- **Is any truth held and not stated?** A constraint the model or the person is
  never told, a limit nobody surfaces, a failure that returns empty instead of
  saying what went wrong.
- **Would this file be at home beside `packages/kernel/src/event.js`?** Same
  comment density, same directness, same refusal to explain the obvious.

The bar-raiser returns **GO** or **NO-GO with the specific change**. Vague
disapproval is not a NO-GO. **Two NO-GOs on the same increment returns it to the
lane lead for a re-plan** — the third attempt is not more of the same attempt.

## The rules that outrank convenience

- **The gate is the standard** (I17). If a claim cannot be executed, either make
  it executable or delete it.
- **No speculative generality.** No option nobody selects, no port with one
  adapter that will never have two, no event nobody folds.
- **Typed errors, always.** A failure that returns `null` or an empty string is
  a failure a person will debug at 2am with nothing to read.
- **Say what is missing.** A capability this build does not have must SAY so
  when it is reached for. Silence reads as absence, and a model plans from it.
- **Do not port dead code.** If the Rust has no construction site or no caller,
  it does not get a JavaScript file. Say so in the report instead.

## When the shared gate is red on somebody else's file

Four lanes commit to one branch, so a neighbour's half-saved file can hold
`bun run gate` red while your own work is finished and correct.

**A lane lands when its own scope is green.** That means: `bun run typecheck:pkg
<yours>` clean, `bun test packages` green (the whole suite — your change must not
break a neighbour), `purity` and `viewmodel` ok, and every file you touched
inside 200/40. Say in your report which shared-gate failures were not yours and
name the file, so the claim is checkable.

**The lead verifies the shared gate at the end of every round**, and a round is
not closed until it is green. What a lane must never do is weaken a check, edit a
neighbour's file to get past it, or report `gateGreen: true` when it is not.

## Cross-lane requests

Filed in `STATUS.md`. The lead rules on them; a lane never resolves its own.
