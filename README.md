# ASKK

A personal assistant that runs entirely inside your browser tab. There is no
server: the page, the agent, its memory and its Linux sandbox are all on your
own machine, and the only thing that ever leaves it is the request to whichever
model you point it at.

## What you need before it can answer anything

**A model.** This app has no model of its own and no key of its own. In
*settings* you name one of three things — and if you have none of them today,
the third needs nothing but patience:

- an **OpenAI-compatible** server — LM Studio, vLLM, Ollama's OpenAI endpoint,
  OpenAI itself. Give it the base URL ending in `/v1`, the model name that
  server uses, and a key if it wants one. A model running on your own machine
  wants no key.
- **Anthropic** — the same, with an Anthropic key.
- **transformers.js** — a small model that downloads into the tab and runs
  there. No endpoint, no key, and a wait of minutes the first time.

Until one of those answers, the page says so on its own: it checks the address
when it opens and, when nothing is there, says which address it tried instead of
waiting for your first question to fail.

## What to expect the first time

- **The first question that runs a command downloads about 50 MB.** That is the
  Linux sandbox, and it is fetched once, on the first `shell` call of the
  session. Questions that need no command never pay for it.
- **The sandbox is slow on purpose-built work.** It is an emulator, a few
  hundred times slower than the machine it runs on. Fine for a file, a check, a
  short script. Not a place to build software.
- **A question can take minutes.** While one is running, the bar across the top
  counts the seconds and names any second agent working on your behalf — so
  `researcher: fetch · step 2` means a helper is on its second pass, reading a
  page for you. A clock that keeps moving means the tab is alive.
- **Nothing is uploaded.** Conversations, settings and the agent's files are in
  your browser's own storage. In a private window there is no storage, and the
  app says so and keeps working for the length of the tab.

## What it can do

Answer from what it knows; search the web and read a page; run a command in a
private Linux userland with Python 3.12 in it; keep files of its own that last
between conversations and that you can read; hand a question to a second agent
that works on its own thread; and ask itself a question on a period — hourly,
daily — in the conversation you set it up in, for as long as that tab is open. What is in *settings* is the model, the voice, and
which agent you are talking to.

An agent is a markdown file — `agents/main/agent.md` is the one the app opens
with, `agents/researcher/agent.md` is the helper it can hand questions to.
Changing how the assistant behaves is editing that file and reloading. There is
no build step between the file and the behaviour.

## Running it yourself

It builds and runs with [Bun](https://bun.sh) — one install, no other toolchain:

    curl -fsSL https://bun.sh/install | bash   # if you do not have it
    bun install
    bun run dev                                # http://localhost:3000/ASKK

# Notes for whoever is working on it

Vanilla JavaScript. React and Next for the view layer; everything below the view
is plain classes with no runtime dependencies.

    bun run check      # lint, tests, build, boot the page, and make the guest run Python
    bun run dev        # http://localhost:3000/ASKK
    bun run build      # static export to out/
    bun run smoke      # build, then boot it in headless Chrome
    bun run toolchain  # make three real guests write, run and read back a Python test suite
    bun run lint       # biome
    bun run format     # biome, writing fixes
    bun run bench      # this agent against a reference scaffold, same model
    bun run bench:blind  # the same transcripts, projected into one grammar; exits 0 now

`bun run check` is the gate; `docs/GATE.md` says what each of its steps can see
and what still gets past all five. See `ARCHITECTURE.md` for the layer rules and
what comes next, and `CAPABILITIES.md` for what this thing can actually do and
how each answer was measured.

**`bench:blind` exited 1 for two waves and exits 0 now, and what changed is
the meaning of the word, decided rather than discovered.** It builds the set a
panel is handed and then judges its own work. For two waves it reported *"NOT
BLIND — 5 of 5 pair(s) can be sorted into arms"* because five of the six
sorting terms were tool names, which this repository argues may not be renamed.
The lead's decision (`docs/LEDGER.md` row P4) was to rename nothing and render
everything: every tool is a numbered slot, every turn one grammar, every
ending one vocabulary, and the assembled prompt is in the file so criterion 1
can be scored. Re-run by the accountant on 2026-09-01 over the run the third
panel scored: exit 0 at all three indices, and a control with a planted tool
name exits 1. The prompt's own prose is left as it is, on purpose, and it
identifies both arms to anyone who has read either project — five of five
judges said so first. `docs/LEDGER.md`'s bar — *"a blind critic picks ours"* —
is **not met** on that panel: ours 12, theirs 21, tie 14 over the cells that
came back, and all eighteen cells of the two tasks where ours dies at the token
ceiling went the other way. The loop's fix for that ceiling is in `src/`
and not yet in `bench/driver.js`, which is why those eighteen cells are the
next brief (rows P9 and S62).

**The trap that used to be in that list is closed, and how it was closed is the
part worth keeping.** `lint` covers `bench`, and `bun run bench` writes
model-generated files into `bench/work/`. That directory is gitignored, which
stops nothing: `biome.json` has no `vcs` block, so biome does not read
`.gitignore`. For one wave, running the benchmark turned the gate red on six
files no human wrote, and the gate could not tell that from a real fault
(`docs/LEDGER.md` row S30, now closed). The fix is one line — `"!bench/work/**"`
in `biome.json`'s include list — and it is an **allowlist of what the gate
judges**, not a denylist of error spellings. Re-derived here with the line
removed and restored: with it, 133 files and no errors; without it, 139 files and
6 errors. A planted unused constant in `bench/driver.js` is still caught, so the
negation narrows the gate's subject without blunting it.

This is the same collision as `test`'s, one instrument over: the rig's output
lands inside the gate's own targets. `bun test` was scoped to `./test` for it
and `biome check` had not been. Both are fixed now; a third instrument will
find it again, so it is written here rather than in a changelog.

## The guest

The agent's environment is an Alpine userland in an x86 emulator, a single wasm
module. Two forms of it, and the difference is the whole reason it can ship:

    public/sandbox/sandbox.wasm      143,205,983 bytes   gitignored, over GitHub's block
    public/sandbox/sandbox.wasm.gz    52,602,121 bytes   TRACKED — this is what loads

It holds Alpine 3.21, busybox, a 15-line `sh` MCP server and **Python 3.12.14**.
Python is what the last rebuild added, and it cost 12,572,161 gzipped bytes —
half of GitHub's 104,857,600 per-file block is now spent, which is the budget
every future addition comes out of.

The page fetches the `.gz`, sniffs `1f 8b` and inflates it with
`DecompressionStream`, and that is the path `bun run check` boots on every run.
A fresh clone therefore HAS a working guest.

**The two sizes above are `HEAD`'s as well as the working tree's** since
`e59eeba`: inflate the blob at `HEAD` and count occurrences of `python3.12` and
the answer is 703, the same as on disk, so a clone of `HEAD` passes
`bun run toolchain`. For one wave it did not — the tracked `.gz` was the
40,029,960-byte pre-Python guest — and `docs/LEDGER.md` row S51 is that wave's
record.

`scripts/wasm/build.sh <image>` rebuilds the raw module from pinned sources
(about 18 minutes, needs Docker and a local registry; `ARCHITECTURE.md` has the
commands). The image argument is required — run it bare and it prints the recipe
and exits 2, because the default it used to carry silently built a guest with
neither the MCP server nor Python in it.

## The files

The agent has a workspace — a third IndexedDB store, named in every prompt as
`your files:`, readable by `read_file`, writable by `write_file`, and staged into
the guest by name on each `shell` call. **As of this wave the person it works for
can see it too**: the `files` button on the rail lists it, opens a file into a
read-only coloured view and hands over a copy. Driven end to end in a browser:
the agent wrote `receipt.py`, the page listed and displayed it, and the guest ran
it and printed `total 42`.

Nothing goes the other way. There is no upload, no editor and no `files.write`
route, so the human reads and the agent writes.

## Deploying

    bun scripts/deploy.js        # dist/, built from a CLEAN CHECKOUT of a commit
    bun scripts/deploy-check.js  # open dist/ in a real browser and drive the agent

`deploy.js` extracts the tracked tree with `git archive`, installs into an empty
`node_modules` and builds — so nothing in your working tree can reach the output,
and a stranger with this repository and nothing else gets the same directory. It
does not push: publishing is the owner's, and a script that both builds and
publishes turns one review into none. `deploy-check.js` then serves that
directory over a host that sends no COOP, no COEP and no CORP — the same silence
GitHub Pages sends — and runs a real shell command through the real agent loop
in real Chrome.

`deploy.js` builds from a commit, so **an untracked file in the working tree is
invisible to it and the build fails on the import**. Reproduced here:
`bun scripts/deploy.js --ref $(git stash create)` exited 1 with
*"Module not found: Can't resolve './PromptPanel.jsx'"* while that file was
untracked, because `git stash create` does not carry untracked files. It is
tracked now and the message is unchanged for the next untracked file.
`git add` before measuring a deploy.

Neither is part of `bun run check`; `docs/DEPLOY.md` says why and what each one
proves. What a first visit costs, measured on both sides of this wave by driving
the built `dist/` in a real browser: **700,092 → 710,701 bytes** on the wire, 19
requests, ready in 165 ms either way. The guest is not in that number — it is
fetched on the first turn, whatever that turn does, and it is **52,602,121 bytes**.

**The live site is not deployed from either of them yet**:
`https://kaush4l.github.io/ASKK/` answers 200 and
`/ASKK/sandbox/sandbox.wasm.gz` answers 404, so every `shell` call a visitor
makes there still reports that it could not run.

Everything before the rebuild is recoverable: `git show pre-narrated-rebuild:<path>`.
