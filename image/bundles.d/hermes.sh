# hermes.tar.gz — overlay: /opt/python/bin + site-packages after
# `pip install hermes-agent[web,pty]`, plus /root/.hermes prewarmed dashboard
# assets and the config template (extracts at /). Requires python311's PBS
# tarball (fetched via the shared cache) as the interpreter base.
#
# The guest is stock musl Alpine with no compilers — everything that needs
# building or Node happens HERE, in the build container, and only the
# resulting files ship. NOTE: this overlay shares /opt/python paths with
# python311.tar.gz — guest-side extraction must happen AFTER the python
# base (startup.sh owns that ordering).
PBS_URL="https://github.com/astral-sh/python-build-standalone/releases/download/20260623/cpython-3.11.15%2B20260623-x86_64-unknown-linux-musl-install_only.tar.gz"
PBS_TGZ=$(fetch_cached "$PBS_URL")

echo "== hermes overlay build (docker, amd64) =="
C=$(bundle_container hermes)
docker cp "$PBS_TGZ" "$C":/tmp/python.tgz

docker exec "$C" sh -eu -c '
    apk add -q nodejs npm curl jq ca-certificates
    mkdir -p /opt && tar -xzf /tmp/python.tgz -C /opt   # -> /opt/python
    export PATH=/opt/python/bin:$PATH HOME=/root
    python3 --version
    pip3 install --no-cache-dir --no-compile "hermes-agent[web,pty]" 2>&1 | tail -3
    hermes --version || hermes --help | head -5
'

echo "== prewarm the dashboard (Node builds the TUI bundle at first launch) =="
docker exec "$C" sh -eu -c '
    export PATH=/opt/python/bin:$PATH HOME=/root
    hermes dashboard --host 127.0.0.1 --port 9119 >/tmp/dash.log 2>&1 &
    echo $! > /tmp/dash.pid
    i=0
    until curl -fsS -o /dev/null http://127.0.0.1:9119/ 2>/dev/null; do
        i=$((i+1))
        [ "$i" -gt 150 ] && { echo "DASHBOARD NEVER CAME UP"; tail -40 /tmp/dash.log; exit 1; }
        sleep 2
    done
    echo "dashboard up after ~$((i*2))s"
    curl -fsS http://127.0.0.1:9119/ | head -c 200; echo
    curl -fsS http://127.0.0.1:9119/openapi.json 2>/dev/null | jq -r ".paths | keys | .[0:12][]" || true
    # kill by saved pid — pkill -f would match this very shell command line
    kill "$(cat /tmp/dash.pid)" 2>/dev/null || true
    sleep 1
'

echo "== trim the overlay (tmpfs guest: every extracted byte is RAM) =="
docker exec "$C" sh -eu -c '
    SP=/opt/python/lib/python3.11/site-packages
    echo "pre-trim:  $(du -sm /opt/python | cut -f1) MB extracted"
    find "$SP" -type d \( -name __pycache__ -o -name tests -o -name test \) \
        -prune -exec rm -rf {} +
    find "$SP" \( -name "*.pyc" -o -name "*.a" \) -delete
    echo "post-trim: $(du -sm /opt/python | cut -f1) MB extracted"
'

echo "== verify trimmed overlay with no Node present (guest has none) =="
docker exec "$C" sh -eu -c '
    apk del -q nodejs npm
    export PATH=/opt/python/bin:$PATH HOME=/root PYTHONDONTWRITEBYTECODE=1
    python3 -c "import hermes_cli, uvicorn, websockets"
    hermes --version || hermes --help | head -3
    hermes dashboard --help >/dev/null
    test -f /opt/python/lib/python3.11/site-packages/hermes_cli/tui_dist/entry.js
    hermes dashboard --host 127.0.0.1 --port 9119 >/tmp/dash2.log 2>&1 &
    echo $! > /tmp/dash2.pid
    i=0
    until curl -fsS -o /dev/null http://127.0.0.1:9119/ 2>/dev/null; do
        i=$((i+1))
        [ "$i" -gt 60 ] && { echo "TRIMMED DASHBOARD NEVER CAME UP"; tail -40 /tmp/dash2.log; exit 1; }
        sleep 2
    done
    echo "trimmed dashboard up after ~$((i*2))s (no node, no pycache)"
    kill "$(cat /tmp/dash2.pid)" 2>/dev/null || true
    sleep 1
'

echo "== config template =="
docker exec "$C" sh -eu -c '
    mkdir -p /root/.hermes
    cat > /root/.hermes/config.yaml.tmpl <<EOF
model:
  default: __ASKK_MODEL_NAME__
  provider: custom
  base_url: __ASKK_MODEL_URL__
  api_key: sk-askk
telemetry: false
EOF
'

echo "== tar the overlay =="
docker exec "$C" sh -eu -c '
    cd /
    # python311.tar.gz already ships bin/python3.11 (39MB) — extract order
    # is python-then-hermes, so the overlay only needs the pip-added
    # console scripts, not a second copy of the interpreter
    tar -czf /tmp/hermes.tgz \
        --exclude opt/python/bin/python3.11 \
        opt/python/bin \
        opt/python/lib/python3.11/site-packages \
        root/.hermes
    ls -l /tmp/hermes.tgz
'
docker cp "$C":/tmp/hermes.tgz docs/bin/hermes.tar.gz
bundle_rm "$C"
emit_artifact docs/bin/hermes.tar.gz
