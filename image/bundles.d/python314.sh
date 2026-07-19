# python314.tar.gz — python-build-standalone musl CPython 3.14 (stripped
# variant, ~29MB; the unstripped one is 109MB). PBS extracts to ./python,
# which python311.tar.gz already owns under /opt — repack so the root dir
# is python314/ (guest untars into /opt -> /opt/python314).
if [ ! -s docs/bin/python314.tar.gz ]; then
    PBS_URL="https://github.com/astral-sh/python-build-standalone/releases/download/20260623/cpython-3.14.6%2B20260623-x86_64-unknown-linux-musl-install_only_stripped.tar.gz"
    PBS_TGZ=$(fetch_cached "$PBS_URL") || exit 1
    ls -l "$PBS_TGZ"

    echo "== python314.tar.gz: repack root dir python -> python314 =="
    WORK=out/python314-repack
    rm -rf "$WORK"
    mkdir -p "$WORK"
    tar -xzf "$PBS_TGZ" -C "$WORK" || exit 1
    [ -d "$WORK/python" ] || { echo "python314: no python/ root in PBS tarball" >&2; exit 1; }
    mv "$WORK/python" "$WORK/python314"
    # ponytail: host tar (bsdtar on mac); COPYFILE_DISABLE keeps AppleDouble junk out
    COPYFILE_DISABLE=1 tar -czf docs/bin/python314.tar.gz.new -C "$WORK" python314 || exit 1
    mv docs/bin/python314.tar.gz.new docs/bin/python314.tar.gz || exit 1
    rm -rf "$WORK"
fi
ls -l docs/bin/python314.tar.gz
emit_artifact docs/bin/python314.tar.gz
