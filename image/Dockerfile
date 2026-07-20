# ASKK guest image — SELF-CONTAINED (ADR-051). python + hermes are baked
# INTO the image, so the whole agent ships inside the one wasm and there is
# NO runtime shelf download. c2w packs the container rootfs into the module
# as a read-only ISO (mkisofs -> rootfs.bin -> wasi-vfs pack), and the
# container's writable layer is tmpfs — so baked files live on the read-only
# ISO (read on demand) instead of being extracted into tmpfs at boot the way
# askk-get did. Bigger module, smaller peak guest RAM, zero-download start.
# Built by image/build.sh, flattened via export/import, converted by c2w.

# ---- builder: python-build-standalone (musl) + hermes, trimmed -------------
# All compiling / Node work happens HERE; only the resulting /opt/python tree
# and prewarmed dashboard assets ship. The guest is stock musl Alpine with no
# compilers and no Node, so the same tree that verifies here runs there.
FROM --platform=linux/amd64 alpine:latest AS hermes-build
ARG PBS_URL="https://github.com/astral-sh/python-build-standalone/releases/download/20260623/cpython-3.11.15%2B20260623-x86_64-unknown-linux-musl-install_only.tar.gz"
RUN apk add --no-cache curl jq nodejs npm ca-certificates
RUN mkdir -p /opt && curl -fL "$PBS_URL" -o /tmp/python.tgz \
    && tar -xzf /tmp/python.tgz -C /opt \
    && rm /tmp/python.tgz            # -> /opt/python
ENV PATH=/opt/python/bin:$PATH HOME=/root
RUN python3 --version \
    && pip3 install --no-cache-dir --no-compile "hermes-agent[web,pty]" 2>&1 | tail -3 \
    && ( hermes --version || hermes --help | head -5 )

# Prewarm the TUI bundle: Node builds it on the dashboard's first launch, and
# the guest has no Node — so bake the prebuilt dist now.
RUN set -eu; \
    hermes dashboard --host 127.0.0.1 --port 9119 >/tmp/dash.log 2>&1 & \
    echo $! >/tmp/dash.pid; \
    i=0; \
    until curl -fsS -o /dev/null http://127.0.0.1:9119/ 2>/dev/null; do \
        i=$((i+1)); \
        [ "$i" -gt 150 ] && { echo "DASHBOARD NEVER CAME UP"; tail -40 /tmp/dash.log; exit 1; }; \
        sleep 2; \
    done; \
    echo "dashboard up after ~$((i*2))s"; \
    kill "$(cat /tmp/dash.pid)" 2>/dev/null || true; \
    sleep 1

# Trim: every megabyte here is a megabyte of wasm module. Strip build-time and
# never-imported trees (stdlib tests, tkinter/idle, headers, static libs,
# precompiled pycs, hermes test dirs).
RUN set -eu; \
    P=/opt/python; L=/opt/python/lib/python3.11; SP=$L/site-packages; \
    echo "pre-trim:  $(du -sm "$P" | cut -f1) MB"; \
    rm -rf "$P/include" "$P/share" \
           "$L/test" "$L/idlelib" "$L/tkinter" "$L/turtledemo" \
           "$L/ensurepip/_bundled" "$L"/config-3.11-*; \
    rm -rf "$P"/lib/libtcl* "$P"/lib/libtk* "$P"/lib/tcl* "$P"/lib/tk* \
           "$P"/lib/itcl* "$P"/lib/thread* "$P"/lib/pkgconfig; \
    rm -f  "$P"/lib/*.a "$P"/lib/libpython*.so* "$P"/bin/idle*; \
    find "$SP" -type d \( -name __pycache__ -o -name tests -o -name test \) \
        -prune -exec rm -rf {} +; \
    find "$P" -type d -name __pycache__ -prune -exec rm -rf {} +; \
    find "$P" \( -name "*.pyc" -o -name "*.a" \) -delete; \
    echo "post-trim: $(du -sm "$P" | cut -f1) MB"

# Config template — startup.sh renders it against the injected model endpoint.
RUN mkdir -p /root/.hermes && printf '%s\n' \
    'model:' \
    '  default: __ASKK_MODEL_NAME__' \
    '  provider: custom' \
    '  base_url: __ASKK_MODEL_URL__' \
    '  api_key: sk-askk' \
    'telemetry: false' > /root/.hermes/config.yaml.tmpl

# Verify the trimmed tree runs with NO Node present (the guest has none).
RUN set -eu; \
    apk del -q nodejs npm; \
    export PYTHONDONTWRITEBYTECODE=1; \
    python3 -c "import hermes_cli, uvicorn, websockets"; \
    ( hermes --version || hermes --help | head -3 ); \
    hermes dashboard --help >/dev/null; \
    test -f /opt/python/lib/python3.11/site-packages/hermes_cli/tui_dist/entry.js

# ---- final: minimal Alpine + baked python/hermes + rootfs scripts ----------
FROM --platform=linux/amd64 alpine:latest
# curl: askk-ingressd's long-poll relay needs it (busybox wget can't).
# ca-certificates: none of the loopback traffic is TLS, but keep it for any
# future TLS-through-proxy. Everything else stays busybox-minimal.
RUN apk add --no-cache curl ca-certificates

COPY --from=hermes-build /opt/python /opt/python
COPY --from=hermes-build /root/.hermes /root/.hermes

# rootfs install via staging (CONTRACTS.md): tolerate sibling-unit files that
# are absent in this worktree (askk-ingressd belongs to unit 4).
COPY rootfs/ /tmp/rootfs/
RUN set -eu; \
    mkdir -p /etc/askk /var/log/askk; \
    for f in askk-boot:/sbin/askk-boot \
             askk-session:/usr/local/bin/askk-session \
             askk-get:/usr/local/bin/askk-get \
             startup.sh:/etc/askk/startup.sh \
             askk-ingressd:/usr/local/bin/askk-ingressd; do \
        src="/tmp/rootfs/${f%%:*}"; dst="${f#*:}"; \
        if [ -f "$src" ]; then install -m 755 "$src" "$dst"; sh -n "$dst"; fi; \
    done; \
    # askk-wsbridge is python, not sh — install without the sh -n check
    if [ -f /tmp/rootfs/askk-wsbridge ]; then \
        install -m 755 /tmp/rootfs/askk-wsbridge /usr/local/bin/askk-wsbridge; \
    fi; \
    [ -x /sbin/askk-boot ]; \
    rm -rf /tmp/rootfs

# PATH/PYTHONDONTWRITEBYTECODE are re-exported by startup.sh too (the flatten
# import in build.sh only re-stamps TERM/LANG), so hermes runs even if a boot
# path skips this ENV. Keeping them here makes an interactive shell sane.
ENV TERM=linux LANG=C.UTF-8 \
    PATH=/opt/python/bin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    PYTHONDONTWRITEBYTECODE=1
ENTRYPOINT ["/sbin/askk-boot"]
