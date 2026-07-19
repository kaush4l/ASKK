# python311.tar.gz — python-build-standalone musl CPython 3.11, trimmed
# (extracts to ./python — guest untars into /opt). The guest rootfs is
# tmpfs, so every extracted byte is guest RAM: strip build-time and
# never-imported trees (stdlib tests, tkinter/idle, headers, static libs,
# precompiled pycs — imports byte-compile lazily, only for what actually
# runs). hermes.sh builds on the same cached PBS tarball (the pristine
# download, NOT this trimmed artifact).
PBS_URL="https://github.com/astral-sh/python-build-standalone/releases/download/20260623/cpython-3.11.15%2B20260623-x86_64-unknown-linux-musl-install_only.tar.gz"
PBS_TGZ=$(fetch_cached "$PBS_URL")
ls -l "$PBS_TGZ"

echo "== python311.tar.gz: trim + repack (docker, amd64) =="
C=$(bundle_container python311)
docker cp "$PBS_TGZ" "$C":/tmp/python.tgz
docker exec "$C" sh -eu -c '
    mkdir -p /work && tar -xzf /tmp/python.tgz -C /work   # -> /work/python
    P=/work/python
    L=/work/python/lib/python3.11
    echo "pre-trim:  $(du -sm "$P" | cut -f1) MB extracted"
    rm -rf "$P/include" "$P/share" \
           "$L/test" "$L/idlelib" "$L/tkinter" "$L/turtledemo" \
           "$L/ensurepip/_bundled" \
           "$L"/config-3.11-*
    # tcl/tk runtime is orphaned once tkinter is gone
    rm -rf "$P"/lib/libtcl* "$P"/lib/libtk* "$P"/lib/tcl* "$P"/lib/tk* \
           "$P"/lib/itcl* "$P"/lib/thread* "$P"/lib/pkgconfig
    # bin/python3.11 is statically linked (the VERIFY below runs without
    # this .so); libpython.so only serves embedders and the guest has none
    rm -f "$P"/lib/*.a "$P"/lib/libpython*.so* "$P"/bin/idle*
    find "$P" -type d -name __pycache__ -prune -exec rm -rf {} +
    find "$P" -name "*.pyc" -delete
    echo "post-trim: $(du -sm "$P" | cut -f1) MB extracted"
    # VERIFY the trimmed tree still runs before shipping it
    "$P/bin/python3" --version
    "$P/bin/python3" -c "import ssl, sqlite3, ctypes, json, zlib, asyncio; print(\"stdlib ok\")"
    "$P/bin/python3" -m pip --version
    cd /work && tar -czf /tmp/python311.tgz python
    ls -l /tmp/python311.tgz
'
docker cp "$C":/tmp/python311.tgz docs/bin/python311.tar.gz
bundle_rm "$C"
emit_artifact docs/bin/python311.tar.gz
