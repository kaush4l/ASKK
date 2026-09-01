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

The agent's environment is an Alpine userland in an x86 emulator, a single
~102 MiB wasm module at `public/sandbox/sandbox.wasm`. It is **not in this
repository** — GitHub blocks files over 100 MiB — so a fresh clone has none.
Build it once with `scripts/wasm/build.sh` (about 18 minutes, needs Docker and a
local registry; `ARCHITECTURE.md` has the commands). Without it everything works
except running a command, and `bun run check` says on stdout that it skipped that
step rather than passing over it in silence.

`gzip -9` puts the same guest at 40,029,960 bytes — under GitHub's block — and
that compressed file is what the page loads and what `bun run check` boots. The
deployed page at `kaush4l.github.io/ASKK` still has no sandbox anyway, because
the `.gz` is untracked: `sandbox/sandbox.wasm` and `sandbox/sandbox.wasm.gz` are
both 404 there and the shell tool reports that it could not run.
`SANDBOX_IMAGE=<url> bun run build` points a build at another host instead;
nothing has tried one yet.

Everything before the rebuild is recoverable: `git show pre-narrated-rebuild:<path>`.
