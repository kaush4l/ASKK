# ASKK

A personal agent that runs entirely in the browser. Static export, no server.

Vanilla JavaScript. React and Next for the view layer; everything below the view
is plain classes with no runtime dependencies.

    bun run check      # lint, tests, build, and boot the built page in a browser
    bun run dev        # http://localhost:3000/ASKK
    bun run build      # static export to out/
    bun run smoke      # build, then boot it in headless Chrome
    bun run lint       # biome
    bun run format     # biome, writing fixes
    bun run bench      # this agent against a reference scaffold, same model
    bun run bench:blind  # the same transcripts, scrubbed, for a blind judge

`bun run check` is the gate; `docs/GATE.md` says what each of its steps can see
and what still gets past all four. See `ARCHITECTURE.md` for the layer rules and
what comes next, and `CAPABILITIES.md` for what this thing can actually do and
how each answer was measured.

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

    public/sandbox/sandbox.wasm      107,054,914 bytes   gitignored, over GitHub's block
    public/sandbox/sandbox.wasm.gz    40,029,960 bytes   TRACKED — this is what loads

The page fetches the `.gz`, sniffs `1f 8b` and inflates it with
`DecompressionStream`, and that is the path `bun run check` boots on every run.
A fresh clone therefore HAS a working guest. `scripts/wasm/build.sh` rebuilds the
raw module from pinned sources (about 18 minutes, needs Docker and a local
registry; `ARCHITECTURE.md` has the commands) and is only needed to change what
is inside it.

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

Neither is part of `bun run check`; `docs/DEPLOY.md` says why and what each one
proves. **The live site is not deployed from either of them yet**:
`https://kaush4l.github.io/ASKK/` answers 200 and
`/ASKK/sandbox/sandbox.wasm.gz` answers 404, so every `shell` call a visitor
makes there still reports that it could not run.

Everything before the rebuild is recoverable: `git show pre-narrated-rebuild:<path>`.
