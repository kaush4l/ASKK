#!/bin/sh
# ASKK startup seam — SELF-CONTAINED image (ADR-051). python + hermes are
# baked into the image, so this script only STARTS them; there are NO shelf
# downloads. Edit in-guest: vi /etc/askk/startup.sh (lost on reload), or
# persist a "startup.sh" via the page to override at every boot.

[ -f /etc/askk/env ] && . /etc/askk/env
mkdir -p /var/log/askk
export PATH=/opt/python/bin:$PATH HOME=/root PYTHONDONTWRITEBYTECODE=1

# Ingress relay (unit 4's daemon) — optional, guard its absence.
if command -v askk-ingressd >/dev/null 2>&1; then
    askk-ingressd >/var/log/askk/ingressd.log 2>&1 &
fi

# Outbound probe — through the proxy, tolerant: network may be down locally.
# /models is a real 200 on OpenAI-compatible endpoints (the bare /v1 is a 404).
# Status only: the LLM backend is the CHAT dependency, not an app dependency.
if wget -q -O /dev/null -T 5 "${ASKK_MODEL_URL:-http://llm.askk.internal/v1}/models" 2>/dev/null; then
    printf '@ASKK:''NET@\n'
else
    echo "askk: outbound probe failed (model endpoint unreachable) -- chat needs that backend; app bringup continues"
fi

# READY = the shell is usable. Hermes bringup is backgrounded so a slow start
# never holds the console hostage; the HERMES (or an ERR) marker arrives when
# it resolves. Phase timings print as T markers (guest clock — console only).
printf '@ASKK:''READY@\n'

# Hermes bringup — everything is already on disk (baked into the image), so
# this is just: render config -> start dashboard -> start gateway -> start
# ws bridge. No askk-get, no tarballs, no extraction into tmpfs.
(
    T0_ALL=$(date +%s)
    # Render the config template with the env the page injected.
    if [ -f /root/.hermes/config.yaml.tmpl ]; then
        sed -e "s|__ASKK_MODEL_NAME__|${ASKK_MODEL_NAME:-gemma-4-12B-it-qat-mxfp8}|" \
            -e "s|__ASKK_MODEL_URL__|${ASKK_MODEL_URL:-http://llm.askk.internal/v1}|" \
            /root/.hermes/config.yaml.tmpl > /root/.hermes/config.yaml
    fi
    # Embedded chat: hermes' TUI launcher aborts on the missing ui-tui checkout
    # before trying the wheel's prebuilt bundle — HERMES_TUI_DIR short-circuits
    # straight to the prewarmed dist baked at build time.
    TUI_SRC=/opt/python/lib/python3.11/site-packages/hermes_cli/tui_dist/entry.js
    if [ -f "$TUI_SRC" ]; then
        mkdir -p /root/.hermes/tui-dist/dist
        cp "$TUI_SRC" /root/.hermes/tui-dist/dist/entry.js
        export HERMES_TUI_DIR=/root/.hermes/tui-dist
    fi
    hermes dashboard --host 127.0.0.1 --port 9119 > /var/log/askk/hermes.log 2>&1 &
    t0=$(date +%s)
    i=0
    # env-cleared: busybox wget ignores no_proxy, so the inherited http_proxy
    # would route this loopback probe through the wasm proxy (always fails)
    until http_proxy= https_proxy= HTTP_PROXY= HTTPS_PROXY= \
        wget -q -O /dev/null -T 3 http://127.0.0.1:9119/ 2>/dev/null; do
        i=$((i+1))
        if [ "$i" -gt 200 ]; then
            printf '@ASKK:''ERR:hermes dashboard never answered@\n'
            tail -20 /var/log/askk/hermes.log 2>/dev/null
            exit 1
        fi
        sleep 3
    done
    printf '@ASKK:''T:hermes_up=%s@\n' "$(( $(date +%s) - t0 ))"
    # Chat gateway (ADR-050): the `hermes dashboard` web server and the agent
    # GATEWAY are separate processes — the dashboard serves the UI, the gateway
    # answers /api/ws (chat) and drives the model. Without it the chat socket
    # 403s and the UI shows "WebSocket connection failed" / MODEL error, i.e.
    # "not connecting to any model" even though the backend is reachable.
    # Long-running (also runs cron); backgrounded so bringup continues.
    if command -v hermes >/dev/null 2>&1; then
        hermes gateway restart > /var/log/askk/gateway.log 2>&1 &
    fi
    # WS-over-relay bridge (CONTRACTS.md): holds real WebSocket connections to
    # the dashboard so the iframe's polyfilled sockets (chat, events feed) work
    # through the ingress relay. env-cleared: loopback only.
    if [ -f /usr/local/bin/askk-wsbridge ] && [ -x /opt/python/bin/python3 ]; then
        http_proxy= https_proxy= HTTP_PROXY= HTTPS_PROXY= no_proxy= NO_PROXY= \
        /opt/python/bin/python3 /usr/local/bin/askk-wsbridge \
            > /var/log/askk/wsbridge.log 2>&1 &
    fi
    printf '@ASKK:''T:bringup_total=%s@\n' "$(( $(date +%s) - T0_ALL ))"
    printf '@ASKK:''HERMES@\n'
) &
