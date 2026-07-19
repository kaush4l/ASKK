# node.tar.gz — Node.js runtime for the guest (root dir 'node'; guest runs
# `askk-get node.tar.gz /opt` -> /opt/node). Needed by hermes' embedded
# chat: the per-session PTY runs the prebuilt Ink TUI (tui_dist/entry.js)
# under node. Alpine's musl-native nodejs relocated to /opt/node with its
# shared-lib deps (libstdc++/libgcc/ada/icu/... whatever ldd names) so the
# stock busybox guest needs no apk.
if [ -e docs/bin/node.tar.gz ] || [ -e docs/bin/node.tar.gz.parts ]; then
    echo "== node.tar.gz already built — skipping (rm docs/bin/node.tar.gz* to rebuild) =="
    if [ -e docs/bin/node.tar.gz ]; then
        emit_artifact docs/bin/node.tar.gz
    fi
    return 0
fi

echo "== node runtime build (docker, amd64) =="
C=$(bundle_container node)
docker exec "$C" sh -eu -c '
    apk add -q nodejs
    node --version
    mkdir -p /opt/node/bin /opt/node/lib
    cp /usr/bin/node /opt/node/bin/
    # every shared object node needs, resolved from the dynamic loader itself
    for lib in $(ldd /usr/bin/node | awk "{print \$3}" | grep "^/" | sort -u); do
        cp -L "$lib" /opt/node/lib/
    done
    # musl loader path: node links /lib/ld-musl-x86_64.so.1 which the guest
    # (stock alpine) already has — only non-base libs need shipping.
    LD_LIBRARY_PATH=/opt/node/lib /opt/node/bin/node -e "console.log(\"node-ok\")"
    cd / && tar -czf /tmp/node.tgz opt/node
    mv /tmp/node.tgz /node.tgz
'
docker cp "$C":/node.tgz docs/bin/node.tar.gz.build
# repack rooted at 'node/' so `askk-get node.tar.gz /opt` -> /opt/node
mkdir -p out/node-repack && rm -rf out/node-repack/*
tar -xzf docs/bin/node.tar.gz.build -C out/node-repack
rm docs/bin/node.tar.gz.build
mv out/node-repack/opt/node out/node-repack/node
(cd out/node-repack && COPYFILE_DISABLE=1 tar -czf node.tar.gz.new node)
mv out/node-repack/node.tar.gz.new docs/bin/node.tar.gz
rm -rf out/node-repack
bundle_rm "$C"

echo "== clean-container verify (no apk nodejs) =="
docker run --rm --platform linux/amd64 -v "$PWD/docs/bin:/shelf:ro" alpine:latest sh -eu -c '
    mkdir -p /opt && tar -xzf /shelf/node.tar.gz -C /opt
    LD_LIBRARY_PATH=/opt/node/lib /opt/node/bin/node -e "console.log(1+1)" | grep -qx 2
    echo "node guest-verify OK"
'
emit_artifact docs/bin/node.tar.gz
