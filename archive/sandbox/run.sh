#!/bin/bash
# sandbox/run.sh <profile> <workspace> [-- ] cmd...
#   profile: job | mlx | path/to/x.sb   (mlx = job.sb + mlx.sb layered)
#   env: SBX_TOOLS="dir1:dir2"   extra read-only roots (max 4; venv, uv python, homebrew)
#        SBX_CPU_SECONDS (default 3600)  SBX_MEM_KB virtual memory cap (default unlimited:
#        Metal maps large VA ranges, a low RLIMIT_AS breaks it)  SBX_FILE_KB (default 20971520 = 20 GB)
#        SBX_NPROC (off: RLIMIT_NPROC counts all the user's processes)  SBX_WALL_SECONDS (default 7200)
#        SBX_GPU_LOCK (default /tmp/sbx-gpu.lock, mlx only: one GPU job at a time)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
[ $# -ge 3 ] || { echo "usage: $0 <job|mlx|file.sb> <workspace> -- cmd..." >&2; exit 64; }
profile="$1"; ws="$2"; shift 2; [ "${1:-}" = "--" ] && shift
if [ "$profile" = mlx ] && [ -z "${SBX_LOCKED:-}" ]; then
  # one GPU job at a time: re-run this script under lockf (shipped with macOS; flock is not)
  exec env SBX_LOCKED=1 /usr/bin/lockf -k "${SBX_GPU_LOCK:-/tmp/sbx-gpu.lock}" "$0" "$profile" "$ws" -- "$@"
fi
mkdir -p "$ws"; ws="$(cd "$ws" && pwd -P)"          # Seatbelt matches resolved paths (/private/...)
case "$ws" in /|/Users|"$HOME"|/System*|/usr*) echo "refusing workspace $ws" >&2; exit 64;; esac
tmp_sb="$(/usr/bin/mktemp /tmp/sbx.XXXXXX)"; trap 'rm -f "$tmp_sb"' EXIT
case "$profile" in
  job) cat "$here/profiles/job.sb" > "$tmp_sb" ;;
  mlx) { cat "$here/profiles/job.sb"; grep -v '^(version' "$here/profiles/mlx.sb"; } > "$tmp_sb" ;;
  *)   cat "$profile" > "$tmp_sb" ;;
esac
args=(-D "WORKSPACE=$ws" -D "HOME=$HOME")
IFS=: read -r -a tools <<< "${SBX_TOOLS:-}"
for i in 1 2 3 4; do
  t="${tools[$((i-1))]:-/nonexistent}"; [ -e "$t" ] && t="$(cd "$t" && pwd -P)"
  args+=(-D "TOOL$i=$t")
done
mkdir -p "$ws/.tmp"
run() {
  # Seatbelt limits access, not resources: ulimits do that.
  ulimit -t "${SBX_CPU_SECONDS:-3600}"
  ulimit -f "${SBX_FILE_KB:-20971520}"
  [ -n "${SBX_NPROC:-}" ] && ulimit -u "$SBX_NPROC"   # per-USER count on macOS, not per job
  [ -n "${SBX_MEM_KB:-}" ] && ulimit -v "$SBX_MEM_KB"
  cd "$ws"
  exec env -i PATH=/usr/bin:/bin HOME="$ws" TMPDIR="$ws/.tmp/" LANG=en_US.UTF-8 \
    ${SBX_ENV:-} /usr/bin/sandbox-exec -f "$tmp_sb" "${args[@]}" "$@"
}
wall="${SBX_WALL_SECONDS:-7200}"
( run "$@" ) & pid=$!
( sleep "$wall"; kill -TERM "$pid" 2>/dev/null; sleep 5; kill -KILL "$pid" 2>/dev/null ) & watch=$!; disown "$watch" 2>/dev/null || true
set +e; wait "$pid"; rc=$?; kill "$watch" 2>/dev/null; wait "$watch" 2>/dev/null; exit $rc
