# Porting guide

Read this before writing a line. `PHILOSOPHY.md` says what the design is;
`PORT-MAP.md` says where each Python file lands; this says **how to port**.

---

## 1. The Bun we target

**Bun 1.4.0**, released 2026-08-20, which is what is installed. It is the newest
release; there is nothing to upgrade to. `docs/BUN-FACTS.md` is the full
factsheet — every claim in it was either read from the release notes with a
source URL or executed against the local binary. **A capability not listed there
is one this port does not rely on.**

The nine facts that decide how this port is written:

**1. `bun test` runs in Bun, not in a browser.** `document` and `window` are
undefined inside a test. That is exactly the property the pure core needs: the
whole backend is testable on the host with no DOM and no browser. Use
`import { test, expect } from "bun:test"`. `expect.extend`, `test.each`,
snapshots, `mock`/`spyOn`, and fake timers all exist.

**2. `bun test --isolate`** gives each test file a fresh `globalThis` and closes
leaked handles between files. The gate runs with it, so a test that pollutes a
global fails instead of quietly helping the next one pass.

**3. Bun ships no typechecker.** `bun tsc` does not exist. `tsc --checkJs` under
`strict` is still the answer, with `@types/bun` and — mandatory now —
`"types": ["bun"]` in the config, because TypeScript 6 stopped auto-discovering
`@types/*`. Our `jsconfig.json` already has it.

**4. `Bun.YAML.parse` exists and is excellent** — 402/402 on the yaml-test-suite,
YAML 1.2 (so `yes` parses as the string `"yes"`, not `true`). **But it is a Bun
runtime API and does not exist in a browser bundle.** Agent files are edited by
the user at runtime and live in OPFS, so frontmatter has to parse *in the page*.
That is why `core/frontmatter.js` is hand-rolled (PORT-MAP R7) — and why its
tests should assert the hand-rolled parser agrees with `Bun.YAML.parse` on every
real `agent.md` and `SKILL.md` in the Python tree. Bun's parser is the oracle
for ours; it just cannot be shipped.

**5. A fully static export is one command.**
`bun build ./app/index.html --outdir=dist --production`, with
`--public-path=/ASKK/` for a subpath deploy — which replaces the old
sed-the-HTML hack, because it rewrites the paths embedded in the JS too.
Two measured traps: **never put `[hash]` in `naming.entry`** or the HTML entry
itself gets hashed and there is no `index.html`; and **`bun build`'s CLI does not
support plugins** — only `Bun.build()` does.

**6. Workers must be their own build entrypoints.** Measured: `bun build
--target=browser` does **not** rewrite or emit
`new Worker(new URL("./w.js", import.meta.url).href)` — the string comes out
byte-identical and the worker file is never written. So the build passes the
worker host as a second entrypoint and the `new URL(...)` must match the name it
lands under. Plan for that in PORT-MAP R3.

**6b. An unresolvable `import()` is a hard build error unless it is lexically
inside a `try`.** Measured while building the shell: a dynamic import of a module
that does not exist yet fails the whole static export — but the *same* switch
with the `try` wrapping it degrades to an optional import the page reports at
runtime. It has to be the `try` around the `import()`, not a `try` at the caller.
That is what lets the router ship before its views do, and it is the difference
between a build that fails and a page that says which view is missing.

**7. Keep workers to the Web-standard subset.** Bun's `Worker` has extensions
browsers do not have — `"open"`/`"close"` events, `ref`/`unref`, `smol`,
`preload`, `Bun.isMainThread`. Using any of them breaks the browser. Pass
`{ type: "module" }` even though Bun does not require it, because the browser
does. `postMessage` transferables are **unverified** in Bun — do not assume
zero-copy; structured clone is the contract.

**8. Behaviour changes in 1.4 that would bite.** `fs.rmdir(recursive)` now
throws — use `fs.rm`. `Bun.TOML.parse` and `Bun.YAML.parse` now throw on input
they used to tolerate. `Response.clone()` tees the body instead of silently
draining the original. `Temporal` is defined by default.

**9. `Bun.WebView` is new in 1.4** — headless browser automation with CDP, in
the runtime. That is what the browser smoke gate should use rather than a
third-party driver, and it costs no dependency.

---

## 2. The seven rules of this port

### Rule 1 — the bytes are the product

Any string the model reads is copied **character for character** from the
Python: prompt text, field descriptions, error messages that reach a transcript,
tool return strings, headings, the batching-rules paragraph, the six numbered
TOON rules.

Never paraphrase. Never improve the grammar. Never fix a typo. Four files in
`tests/golden/` hold the expected bytes and they are not editable — a diff means
the port is wrong, not the fixture.

When you are unsure whether a string is model-facing: it is. Copy it.

### Rule 2 — port the comments that carry a reason

The Python's comments are the most valuable thing in that codebase, because they
almost never explain mechanism. They explain **why the code could not be
simpler**:

> "Kept, not discarded: the call still happens, but as a failure that tells the
> model what was wrong with what it wrote."

> "A cached clock is a wrong clock."

> "An adversarial reviewer that read the worker's own reasoning tends to agree
> with it."

Port every one of those. Drop any comment that describes Python mechanics
(`# imported here so MCP stays an optional path`) unless the same constraint
exists in JavaScript — and where the constraint changed, write the new reason
rather than deleting the old one silently.

### Rule 3 — the core is pure, and purity is enforced

No DOM. No `fetch` off the global. No `Date.now()`, no `new Date()`, no
`Math.random()`, no `node:*`, no `Bun.*`, no `process.env`. Everything
environmental arrives through the ports object handed in at construction.

This is not fastidiousness. It is what lets the whole backend run and be tested
on the host with no browser, and it is what makes the golden prompts
reproducible — a prompt containing an ambient clock could not be compared
against a recorded file at all.

`bun run gate` greps for these and fails on a hit.

### Rule 4 — errors are values the model can read

Nothing in the tool path throws. Unknown tool, malformed JSON arguments, a tool
that explodes — each comes back as a failed result carrying text that tells the
model what was wrong, because the model is the one that has to correct itself
on the next turn.

Assembly is the deliberate exception: a malformed prompt is a programming
mistake, not a runtime condition, so the assembler **throws and does not
repair**.

Everywhere between, follow the Python exactly. It is precise about which
failures cost a skill, which cost a turn, and which cost the run.

### Rule 5 — coercions fail toward the careful branch

Unknown complexity becomes `complex`. Unknown verify verdict becomes `fail`.
Unknown critique verdict becomes `revise`. An unparseable reply becomes the
answer field rather than an exception.

Every one of these is a decision about what happens when a small model writes
something slightly wrong, and every one of them chooses more work over a wrong
answer. Port the direction, not just the mechanism.

### Rule 6 — no dependencies, and no speculative generality

Zero runtime dependencies in `core/`. If something needs a YAML parser, write
the subset that is actually used and say in the module comment that it must
never grow into a YAML implementation.

A registry with one entry is not a registry. An option nobody passes is not an
option. Files ≤ 200 lines, functions ≤ 40 — and the way to meet that is to
delete, not to relocate.

### Rule 7 — one increment, one owner, disjoint files

Other porters are working in this repository at the same moment. Create and edit
only the files your increment names. Do not touch `package.json`,
`jsconfig.json`, the golden fixtures, or another porter's file — not even to fix
something obviously broken. Report it and move on.

---

## 3. Idiom translations

| Python | JavaScript here | Note |
|---|---|---|
| `pydantic.BaseModel` field table | `static FIELDS = [...]` in declaration order | PORT-MAP R1. Order is load-bearing. |
| `Field(description=...)` | the `description` in that table | copied character for character |
| `model_validator(mode="after")` | `static normalize(data)` called from the constructor | same coercions, same direction |
| `ClassVar` | `static` | |
| `ConfigDict(frozen=True)` | `Object.freeze(this)` at the end of the constructor | what makes `key()` honest |
| `functools.cache` | a module-level `Map` keyed the same way | |
| `hashlib.sha1(json)` | a small stable string hash over the fields in declaration order | never rely on JS object key order |
| `asyncio.gather` | `Promise.all` | |
| `asyncio.to_thread` | nothing — call it | JS has no blocking IO to move off |
| `threading.Lock` | usually nothing (one JS thread) | except where ordering matters — then a promise chain |
| `asyncio.Lock` on a write queue | a promise chain each write appends to | PORT-MAP R3 |
| thread + private event loop | a Web Worker | PORT-MAP R3 |
| `run_coroutine_threadsafe` | a correlated `postMessage` round-trip | |
| `pathlib.Path` | plain string paths through the fs port | |
| `Path.replace` (atomic) | `fs.replace` in the port | the guarantee is the point |
| `logging.getLogger` | a `log` object handed in, defaulting to no-op | a pure core does not own a logger |
| `re` | `RegExp` | check the flags: Python `re.DOTALL` is JS `s` |
| `str.strip("'\"`* ")` | a character-class trim helper | JS `trim` takes no argument |
| `dict` insertion order | a `Map`, or an array of pairs | do not rely on object key order anywhere it is observable |
| `inspect.signature` | **banned** — declare the shape | PORT-MAP R6; minifiers destroy it |
| `subprocess` | the `spawn` port, host only | PORT-MAP R5 |

## 4. Two traps from this codebase's own history

- **A build cache will serve you a chunk without your edit in it.** Clear the
  build output before you believe a browser result.
- **A page that renders is not a page that works.** Unit tests cannot see a
  runtime that never started. Once there is a page, drive it.

## 5. What "done" means for an increment

1. The files you own exist and are within the size limits.
2. `bun test tests/<yours>.test.js` is green.
3. `bunx tsc --noEmit -p jsconfig.json` reports nothing in your files.
4. Every model-facing string is byte-identical to the Python.
5. You have reported: what you built, what you could not transliterate and what
   you did instead, and anything you found that looks wrong in either tree.

Nothing on that list is optional, and item 5 is the one that compounds.
