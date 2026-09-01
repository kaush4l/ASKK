# ASKK

A personal agent that runs entirely in the browser. Static export, no server.

Vanilla JavaScript. React and Next for the view layer; everything below the view
is plain classes with no runtime dependencies.

    bun run check    # lint, tests, build, and boot the built page in a browser
    bun run dev      # http://localhost:3000/ASKK
    bun run build    # static export to out/
    bun run smoke    # build, then boot it in headless Chrome
    bun run lint     # biome
    bun run format   # biome, writing fixes

`bun run check` is the gate; `docs/GATE.md` says what each of its steps can see
and what still gets past all four. See `ARCHITECTURE.md` for the layer rules and
what comes next, and `CAPABILITIES.md` for what this thing can actually do and
how each answer was measured.

## The guest

The agent's environment is an Alpine userland in an x86 emulator, a single
~102 MiB wasm module at `public/sandbox/sandbox.wasm`. It is **not in this
repository** — GitHub blocks files over 100 MiB — so a fresh clone has none.
Build it once with `scripts/wasm/build.sh` (about 18 minutes, needs Docker and a
local registry; `ARCHITECTURE.md` has the commands). Without it everything works
except running a command, and `bun run check` says on stdout that it skipped that
step rather than passing over it in silence.

The same 102 MiB is why the deployed page at `kaush4l.github.io/ASKK` has no
sandbox: the file cannot be pushed, so `sandbox/sandbox.wasm` is a 404 there and
the shell tool reports that it could not run. `SANDBOX_IMAGE=<url> bun run build`
points a build at a host that will serve it; nothing has tried one yet.

Everything before the rebuild is recoverable: `git show pre-narrated-rebuild:<path>`.
