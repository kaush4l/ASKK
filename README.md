# ASKK

A personal agent that runs entirely in the browser. Static export, no server.

Vanilla JavaScript. React and Next for the view layer; everything below the view
is plain classes with no runtime dependencies.

    bun run dev      # http://localhost:3000/ASKK
    bun run build    # static export to out/
    bun run lint     # biome
    bun run format   # biome, writing fixes

See `ARCHITECTURE.md` for the layer rules and what comes next.

Everything before the rebuild is recoverable: `git show pre-narrated-rebuild:<path>`.
