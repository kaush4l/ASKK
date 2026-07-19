# bun.tar.gz — Bun runtime for the guest (guest runs `askk-get bun.tar.gz /`
# -> /usr/local/bin/bun). MUST stay the musl-baseline asset: the guest is
# Alpine (musl) on emulated Bochs baseline x86-64 with no AVX2 — the default
# build hard-requires AVX2 and will not run.
if [ -s docs/bin/bun.tar.gz ]; then
    echo "== bun.tar.gz: exists, skipping build =="
else
    BUN_URL="https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-linux-x64-musl-baseline.zip"
    BUN_ZIP=$(fetch_cached "$BUN_URL")
    ls -l "$BUN_ZIP"

    echo "== bun.tar.gz: repack zip -> usr/local/bin/bun =="
    STAGE=out/cache/bun-stage
    rm -rf "$STAGE"
    mkdir -p "$STAGE/usr/local/bin" "$STAGE/usr/lib"
    unzip -q -o "$BUN_ZIP" -d "$STAGE/zip"
    mv "$STAGE"/zip/*/bun "$STAGE/usr/local/bin/bun"

    # bun's musl build still dylinks libstdc++/libgcc; the guest image is
    # bare alpine (no apk) — carry them in the tarball.
    echo "== bun.tar.gz: add libstdc++/libgcc from alpine =="
    C=$(bundle_container bun)
    docker exec "$C" apk add -q libstdc++ libgcc
    docker exec "$C" cat /usr/lib/libstdc++.so.6 > "$STAGE/usr/lib/libstdc++.so.6"
    docker exec "$C" cat /usr/lib/libgcc_s.so.1 > "$STAGE/usr/lib/libgcc_s.so.1"
    bundle_rm "$C"

    chmod 755 "$STAGE/usr/local/bin/bun" "$STAGE"/usr/lib/*
    COPYFILE_DISABLE=1 tar --uid 0 --gid 0 --uname '' --gname '' -czf docs/bin/bun.tar.gz -C "$STAGE" usr
    rm -rf "$STAGE"
fi
emit_artifact docs/bin/bun.tar.gz
