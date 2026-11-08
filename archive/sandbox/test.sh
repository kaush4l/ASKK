#!/bin/bash
# sandbox/test.sh — re-runs the checks in docs/sandbox-exec.md "Verified". Exits non-zero on any failure.
#   SBX_SCRATCH  work folder (default: a new /tmp folder)
#   SBX_VENV     a venv with mlx (default: made in SBX_SCRATCH with uv; MLX checks fail if neither works)
set -u
here="$(cd "$(dirname "$0")" && pwd)"; run="$here/run.sh"
S="${SBX_SCRATCH:-$(/usr/bin/mktemp -d /tmp/sbxtest.XXXXXX)}"; mkdir -p "$S" || exit 2; S="$(cd "$S" && pwd -P)"
W="$S/ws"; mkdir -p "$W"; fails=0
ok(){ echo "PASS $1"; }; bad(){ echo "FAIL $1"; fails=$((fails+1)); }
check(){ local name="$1"; shift; if "$@"; then ok "$name"; else bad "$name"; fi; }

# job.sb
check "job: writes in workspace" "$run" job "$W" -- /bin/sh -c 'echo hi > in.txt && [ "$(cat in.txt)" = hi ]'
out="$S/outside-$$.txt"
check "job: cannot write outside" bash -c "! '$run' job '$W' -- /bin/sh -c 'echo x > $out' 2>/dev/null && [ ! -e $out ]"
check "job: cannot read ~/.ssh"   bash -c "! '$run' job '$W' -- /bin/ls '$HOME/.ssh' 2>/dev/null"
check "job: cannot list ~/Library" bash -c "! '$run' job '$W' -- /bin/ls '$HOME/Library' 2>/dev/null"
check "job: no DNS/HTTPS"          bash -c "! '$run' job '$W' -- /usr/bin/curl -sS -m 5 https://example.com -o /dev/null 2>/dev/null"
check "job: no raw IP"             bash -c "! '$run' job '$W' -- /usr/bin/curl -sS -m 5 http://1.1.1.1 -o /dev/null 2>/dev/null"
check "job: no nested sandbox-exec" bash -c "printf '(version 1)(allow default)' > '$W/in.sb'; ! '$run' job '$W' -- /usr/bin/sandbox-exec -f in.sb /bin/echo x 2>/dev/null"
check "job: wall clock limit"      bash -c "! SBX_WALL_SECONDS=2 '$run' job '$W' -- /bin/sleep 30"

# mlx.sb
V="${SBX_VENV:-$S/venv}"
if [ ! -x "$V/bin/python" ] && command -v uv >/dev/null; then
  command uv venv -q "$V" --python 3.12 && command uv pip install -q --python "$V/bin/python" mlx
fi
if [ -x "$V/bin/python" ]; then
  py="$(readlink -f "$V/bin/python")"; pyroot="$(dirname "$(dirname "$py")")"
  cat > "$W/mm.py" <<'PY'
import socket, mlx.core as mx
assert mx.default_device() == mx.gpu, mx.default_device()
a = mx.random.normal((2048, 2048)); c = a @ a; mx.eval(c)
assert c.shape == (2048, 2048)
try: socket.create_connection(("1.1.1.1", 80), timeout=3); raise SystemExit("network open")
except OSError: pass
print("gpu matmul ok, network denied")
PY
  check "mlx: GPU matmul, no network" env SBX_WALL_SECONDS=120 SBX_TOOLS="$V:$pyroot" "$run" mlx "$W" -- "$V/bin/python" -I mm.py
  check "job (no Metal rules): MLX GPU fails" bash -c "! SBX_WALL_SECONDS=30 SBX_TOOLS='$V:$pyroot' '$run' job '$W' -- '$V/bin/python' -I mm.py >/dev/null 2>&1"
else
  bad "mlx: no venv with mlx (set SBX_VENV or install uv)"
fi
echo "$fails failure(s)"; exit $((fails>0))
