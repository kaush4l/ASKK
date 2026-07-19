#!/bin/sh
# ASKK startup seam — the user-editable boot script.
# Edit in-guest: vi /etc/askk/startup.sh (lost on reload), or persist a file
# named "startup.sh" via the page's persistence store to override this at
# every boot (askk-boot fetches $ASKK_PERSIST_URL/startup.sh first).
# Pull big tools into the running guest with: askk-get <name>

[ -f /etc/askk/env ] && . /etc/askk/env
mkdir -p /var/log/askk

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

# READY = the shell is usable. The hermes bringup below is backgrounded so a
# 100MB+ bundle download never holds the console hostage; the HERMES (or an
# ERR) marker arrives when it resolves. Phase timings print as T markers
# (guest clock — skewed vs real time; console-only, the page ignores them).
printf '@ASKK:''READY@\n'

# Hermes bringup (ADR-048): pull python + the hermes overlay off the page's
# binary shelf, render the config against the injected model endpoint, start
# the dashboard for the ingress relay / iframe. Unconditional: the shelf is
# a different host than the model endpoint, and the app must come up even
# when the chat backend is off (LLM unreachability is the warning above).
(
    T0_ALL=$(date +%s)
    export PATH=/opt/python/bin:$PATH HOME=/root
    # curl: askk-ingressd's pollers depend on it (the minimal image is
    # busybox-only) and self-heal within one backoff once it appears.
    # Fully parallel with the pulls below — nothing here waits on it.
    if ! command -v curl >/dev/null 2>&1; then
        (
            t0=$(date +%s)
            askk-get curl || echo "askk: curl fetch failed -- dashboard relay stays down" >&2
            printf '@ASKK:''T:curl=%s@\n' "$(( $(date +%s) - t0 ))"
        ) &
    fi
    if ! command -v hermes >/dev/null 2>&1; then
        echo "askk: pulling python311 + hermes bundles off the shelf (this is the slow part)..."
        # python extract and the hermes download run concurrently (disjoint
        # paths). hermes.tar.gz is an overlay INTO /opt/python, so only its
        # DOWNLOAD is parallel — its extract waits on python below.
        (
            t0=$(date +%s)
            askk-get python311.tar.gz /opt || exit 1
            printf '@ASKK:''T:python311=%s@\n' "$(( $(date +%s) - t0 ))"
        ) &
        PY_PID=$!
        # ~74MB lands in tmpfs (RAM) — transient, deleted right after extract.
        (
            t0=$(date +%s)
            wget -q -T 15 -O /tmp/hermes.tgz \
                "${ASKK_BIN_URL:-http://bin.askk.internal}/hermes.tar.gz" || exit 1
            printf '@ASKK:''T:hermes_dl=%s@\n' "$(( $(date +%s) - t0 ))"
        ) &
        HDL_PID=$!
        # node runtime (disjoint /opt/node): the embedded chat's per-session
        # PTY runs the prebuilt Ink TUI under node. Non-fatal — dashboard
        # works without it, only chat sessions need it.
        if [ ! -x /opt/node/bin/node ]; then
            (
                t0=$(date +%s)
                if askk-get node.tar.gz /opt; then
                    printf '#!/bin/sh\nLD_LIBRARY_PATH=/opt/node/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH} exec /opt/node/bin/node "$@"\n' \
                        > /usr/local/bin/node
                    chmod 755 /usr/local/bin/node
                    printf '@ASKK:''T:node=%s@\n' "$(( $(date +%s) - t0 ))"
                else
                    echo "askk: node fetch failed -- dashboard chat sessions stay down" >&2
                fi
            ) &
        fi
        if ! wait "$PY_PID"; then
            # ponytail: kill hits the job subshell; an in-flight wget child may
            # hold the unlinked tmpfs file until it exits (~74MB, fatal path)
            kill "$HDL_PID" 2>/dev/null
            wait "$HDL_PID" 2>/dev/null
            rm -f /tmp/hermes.tgz
            printf '@ASKK:''ERR:python bundle fetch failed@\n'
            exit 1
        fi
        if wait "$HDL_PID"; then
            t0=$(date +%s)
            if ! tar -xzf /tmp/hermes.tgz -C /; then
                rm -f /tmp/hermes.tgz
                printf '@ASKK:''ERR:hermes bundle fetch failed@\n'
                exit 1
            fi
            rm -f /tmp/hermes.tgz
        else
            # download failed (or the artifact went multi-part on the shelf) —
            # askk-get speaks the parts protocol; let it do fetch+extract.
            rm -f /tmp/hermes.tgz
            t0=$(date +%s)
            askk-get hermes.tar.gz / || { printf '@ASKK:''ERR:hermes bundle fetch failed@\n'; exit 1; }
        fi
        # ponytail: on the fallback path this counts fetch+extract together
        printf '@ASKK:''T:hermes_extract=%s@\n' "$(( $(date +%s) - t0 ))"
    fi
    # Render the config template with the env the page injected.
    if [ -f /root/.hermes/config.yaml.tmpl ]; then
        sed -e "s|__ASKK_MODEL_NAME__|${ASKK_MODEL_NAME:-gemma-4-12B-it-qat-mxfp8}|" \
            -e "s|__ASKK_MODEL_URL__|${ASKK_MODEL_URL:-http://llm.askk.internal/v1}|" \
            /root/.hermes/config.yaml.tmpl > /root/.hermes/config.yaml
    fi
    # Embedded chat: hermes' TUI launcher aborts on the missing ui-tui
    # checkout before trying the wheel's prebuilt bundle — HERMES_TUI_DIR
    # short-circuits straight to a prebuilt dist (hermes_cli/main.py).
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
    # "not connecting to any model" even though the backend is reachable. Start
    # it after the dashboard is up (it registers with it); inherit the env
    # (proxy included) so its outbound model calls route like the dashboard's.
    # Long-running (also runs cron); backgrounded so bringup continues.
    if command -v hermes >/dev/null 2>&1; then
        hermes gateway restart > /var/log/askk/gateway.log 2>&1 &
    fi
    # WS-over-relay bridge (CONTRACTS.md): holds real WebSocket connections
    # to the dashboard so the iframe's polyfilled sockets (chat, events
    # feed) work through the ingress relay. Needs hermes' python packages —
    # start only after the dashboard answered. env-cleared: loopback only.
    if [ -f /usr/local/bin/askk-wsbridge ] && [ -x /opt/python/bin/python3 ]; then
        http_proxy= https_proxy= HTTP_PROXY= HTTPS_PROXY= no_proxy= NO_PROXY= \
        /opt/python/bin/python3 /usr/local/bin/askk-wsbridge \
            > /var/log/askk/wsbridge.log 2>&1 &
    fi
    printf '@ASKK:''T:bringup_total=%s@\n' "$(( $(date +%s) - T0_ALL ))"
    printf '@ASKK:''HERMES@\n'
) &
