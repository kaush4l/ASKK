# ASKK in a container (docs/portability.md §7): the desk server and the built UI on Linux (x86-64 or arm64 — a Linux
# box, a cloud VM, a Raspberry Pi, the Pixel's Linux Terminal VM). The desks run from source: a desk's main.js imports
# companion/team/compose.js by path, and desks/load reloads them live, so the image carries the source tree, not the
# one-file `dist/askk` (that one is for a bare machine).
#
#   docker build -t askk .
#   docker run --rm -p 127.0.0.1:7717:7717 \
#     -e ASKK_LLM_PROVIDER=anthropic -e ASKK_LLM_ID=claude-sonnet-5-5 -e ANTHROPIC_API_KEY \
#     -v askk-memory:/askk/memory -v "$PWD/custom:/askk/custom" askk
#
# Publish on 127.0.0.1 only: the server answers only Host localhost:<port> (DNS-rebinding guard), and it is the owner's.
# What runs inside and what does not: docs/portability.md §7 (no Apple speech/model/Shortcuts, no mflux, no preview pages
# without a Chrome — they detect themselves and drop out; the terminal runs with the container as its sandbox).

ARG BUN_VERSION=1.4.4

# ---- build: the static UI (out/) -----------------------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION} AS ui
WORKDIR /src
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun --bun next build

# ---- run ------------------------------------------------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION}-slim
# git: projects, checkpoints and the dev desk's status; tini: signals to bun; ca-certificates: the model's https wire.
# --build-arg CHROMIUM=1: the preview's pages (Bun.WebView drives Chrome on Linux; ~+400 MB). Without it browser/*
# answers "No headless browser here".
ARG CHROMIUM=0
RUN apt-get update \
 && apt-get install -y --no-install-recommends git tini ca-certificates $([ "$CHROMIUM" = 1 ] && echo chromium fonts-dejavu-core) \
 && rm -rf /var/lib/apt/lists/*
# Chrome's own sandbox needs user namespaces a container does not grant (it dies: "Chrome process closed the pipe"), so
# it runs with --no-sandbox — the container is the boundary, as for the terminal, and browser/* opens only this
# container's localhost apps (capabilities/browser.js).
RUN printf '#!/bin/sh\nexec /usr/bin/chromium --no-sandbox --disable-dev-shm-usage "$@"\n' > /usr/local/bin/askk-chromium \
 && chmod +x /usr/local/bin/askk-chromium
ENV BUN_CHROME_PATH=/usr/local/bin/askk-chromium
WORKDIR /askk
COPY package.json ./
COPY backend ./backend
COPY companion ./companion
COPY desks ./desks
COPY scripts ./scripts
COPY lib ./lib
COPY --from=ui /src/out ./out
RUN mkdir -p custom memory models && chown -R bun:bun /askk
USER bun

# The container is the terminal's sandbox (companion/capabilities/sandbox.js sandboxRunner); listen on the container's
# own interface so the published port reaches it (companion/server/server.js: honoured only inside a container).
ENV ASKK_SANDBOX=container \
    ASKK_BIND=0.0.0.0 \
    ASKK_SPEECH=off \
    NODE_ENV=production
VOLUME ["/askk/custom", "/askk/memory", "/askk/models"]
EXPOSE 7717
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD bun -e 'const r = await fetch("http://127.0.0.1:7717/__askk/desks", {headers: {host: "localhost:7717"}}); process.exit(r.ok ? 0 : 1)'
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bun", "companion/server/server.js", "--desks", "custom", "--port", "7717"]
