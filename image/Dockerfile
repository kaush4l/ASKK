# ASKK guest image — smallest possible Alpine (amd64), busybox only.
# No language runtimes baked in: big binaries (hermes, python, …) are pulled
# into the RUNNING guest over the fetch-proxy network via askk-get from the
# page's docs/bin/ folder (sentinel host bin.askk.internal). See CONTRACTS.md.
# Built by image/build.sh, flattened via export/import, converted by c2w.
FROM --platform=linux/amd64 alpine:latest

# ponytail: no apk at all — busybox wget covers askk-get/probes over the
# plain-http proxy. Add ca-certificates only if TLS-through-proxy ever lands.

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

ENV TERM=linux LANG=C.UTF-8
ENTRYPOINT ["/sbin/askk-boot"]
