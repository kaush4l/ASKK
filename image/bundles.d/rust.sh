# rust.tar.gz — self-contained Rust toolchain (root dir 'rust'; guest runs
# `askk-get rust.tar.gz /opt` -> /opt/rust). Alpine's musl-native rustc +
# cargo relocated to /opt/rust with every shared-lib dep, plus lld and the
# crt/libc/libgcc static archives needed for gcc-free linking — the guest
# has no compiler toolchain. No docs/man ship (files are cherry-picked).
#
# Guest recipe (verified in a clean alpine container, no gcc):
#   export PATH=/opt/rust/bin:$PATH LD_LIBRARY_PATH=/opt/rust/lib
#   rustc -C linker=/opt/rust/bin/ld.lld -C target-feature=+crt-static \
#     -C link-arg=/opt/rust/lib/rustlib/x86_64-alpine-linux-musl/lib/rcrt1.o hello.rs
#
# Why not `-C link-self-contained=yes`: Alpine's rustc (triple
# x86_64-alpine-linux-musl, no rust-lld) disables that option and ships an
# empty self-contained/ dir. So the crt objects + libc.a + libgcc(_eh).a
# are staged into the rustlib lib dir (already on rustc's -L path) and
# rcrt1.o (static-pie entry — plain crt1.o segfaults, rustc links -static
# -pie) is passed explicitly.

if [ -e docs/bin/rust.tar.gz ] || [ -e docs/bin/rust.tar.gz.parts ]; then
    echo "== rust.tar.gz already built — skipping (rm docs/bin/rust.tar.gz* to rebuild) =="
    # emit_artifact ran at build time; on the split artifact it can't re-run
    # (the joined tar is gone), so keep the SIZES row alive from the parts.
    if [ -e docs/bin/rust.tar.gz.parts ]; then
        total=0
        while read -r p; do
            [ -n "$p" ] || continue
            total=$((total + $(wc -c < "docs/bin/$p" | tr -d '[:space:]')))
        done < docs/bin/rust.tar.gz.parts
        touch docs/bin/SIZES.txt
        grep -v '^rust.tar.gz ' docs/bin/SIZES.txt > docs/bin/SIZES.txt.new || true
        echo "rust.tar.gz $total" >> docs/bin/SIZES.txt.new
        mv docs/bin/SIZES.txt.new docs/bin/SIZES.txt
    fi
    return 0
fi

echo "== rust toolchain build (docker, amd64) =="
C=$(bundle_container rust)
docker exec "$C" sh -eu -c '
    apk add -q rust cargo lld musl-dev
    rustc --version; cargo --version
    mkdir -p /opt/rust/bin /opt/rust/lib /opt/rust/libexec
    cp /usr/bin/rustc /usr/bin/cargo /usr/bin/ld.lld /opt/rust/bin/
    # every shared-lib dep of the three binaries, dereferenced under its
    # soname (rustc/cargo carry an $ORIGIN/../lib rpath; ld.lld does not —
    # guest sets LD_LIBRARY_PATH=/opt/rust/lib which covers all three)
    for b in /opt/rust/bin/rustc /opt/rust/bin/cargo /opt/rust/bin/ld.lld; do
        ldd "$b" | awk "/=>/ {print \$3}"
    done | sort -u | while read -r so; do
        case "$so" in /usr/*) cp -L "$so" "/opt/rust/lib/$(basename "$so")";; esac
    done
    cp -a /usr/lib/rustlib /opt/rust/lib/rustlib
    # crt objects + static libc + libgcc archives -> rustlib lib dir, the
    # one -L rustc always passes (std wants -lc and -lgcc_eh at link time)
    RL=/opt/rust/lib/rustlib/x86_64-alpine-linux-musl/lib
    cp /usr/lib/crt1.o /usr/lib/rcrt1.o /usr/lib/crti.o /usr/lib/crtn.o \
       /usr/lib/Scrt1.o /usr/lib/libc.a "$RL/"
    GCCDIR=$(dirname "$(find /usr/lib/gcc -name libgcc_eh.a | head -1)")
    cp "$GCCDIR/libgcc.a" "$GCCDIR/libgcc_eh.a" "$RL/"
    cp -a /usr/libexec/rust-analyzer-proc-macro-srv /opt/rust/libexec/
    du -sh /opt/rust
    tar -C /opt -czf /tmp/rust.tgz rust
'
docker cp "$C":/tmp/rust.tgz docs/bin/rust.tar.gz
bundle_rm "$C"

echo "== clean-container verify (no rust apk, only the artifact) =="
V=$(bundle_container rust-verify)
docker cp docs/bin/rust.tar.gz "$V":/tmp/rust.tar.gz
docker exec "$V" sh -eu -c '
    mkdir -p /opt && tar -xzf /tmp/rust.tar.gz -C /opt
    export PATH=/opt/rust/bin:$PATH LD_LIBRARY_PATH=/opt/rust/lib
    rustc --version && cargo --version
    printf "fn main(){println!(\"rust-ok\")}" > /tmp/hello.rs
    cd /tmp
    rustc -C linker=/opt/rust/bin/ld.lld -C target-feature=+crt-static \
        -C link-arg=/opt/rust/lib/rustlib/x86_64-alpine-linux-musl/lib/rcrt1.o hello.rs
    out=$(./hello)
    [ "$out" = rust-ok ] || { echo "VERIFY FAILED: $out"; exit 1; }
    echo "verify: rust-ok (gcc-free static link)"
'
bundle_rm "$V"
emit_artifact docs/bin/rust.tar.gz
