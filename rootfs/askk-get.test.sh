#!/bin/sh
# rootfs/askk-get.test.sh — host-side test for rootfs/askk-get (docker).
# The guest never runs this. One amd64 busybox container (full applet set —
# alpine's busybox lacks httpd) builds a /shelf, serves it with busybox
# httpd, and exercises askk-get end to end:
#   tool          plain file                          -> binary mode
#   mini.tar.gz   one-file tarball                    -> tarball mode
#   big.tar.gz    2-way split + big.tar.gz.parts index -> multi-part mode
#   missing*      absent from the shelf               -> failure/retry paths
# Prints PASS/FAIL per case; exits non-zero on any FAIL.

set -u
here=$(cd "$(dirname "$0")" && pwd)

command -v docker >/dev/null 2>&1 || {
    echo "FAIL: docker not available" >&2
    exit 1
}

exec docker run --rm -i --platform linux/amd64 \
    -v "$here/askk-get:/mnt/askk-get:ro" \
    busybox sh -s <<'INNER'
rc=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; rc=1; }

mkdir -p /usr/local/bin
install -m 755 /mnt/askk-get /usr/local/bin/askk-get

# --- shelf fixtures ------------------------------------------------------
mkdir -p /shelf /src/mini /src/big
echo "tool-payload" > /shelf/tool

echo hello > /src/mini/hello.txt
tar -czf /shelf/mini.tar.gz -C /src/mini hello.txt

dd if=/dev/urandom of=/src/big/blob bs=1024 count=64 2>/dev/null
echo marker > /src/big/marker.txt
tar -czf /tmp/big.tar.gz -C /src/big blob marker.txt
half=$(( ($(wc -c < /tmp/big.tar.gz) + 1) / 2 ))
split -b "$half" /tmp/big.tar.gz /shelf/big.tar.gz.part-
ls /shelf | grep '^big\.tar\.gz\.part-' | sort > /shelf/big.tar.gz.parts
[ "$(wc -l < /shelf/big.tar.gz.parts)" -eq 2 ] || fail "fixture: expected 2 parts"

busybox httpd -p 8080 -h /shelf
i=0
until wget -q -O /dev/null http://127.0.0.1:8080/tool 2>/dev/null; do
    i=$((i + 1))
    [ "$i" -gt 20 ] && { echo "FAIL: httpd never came up"; exit 1; }
    sleep 1
done

export ASKK_BIN_URL=http://127.0.0.1:8080

# --- 1: binary mode ------------------------------------------------------
if askk-get tool && [ -x /usr/local/bin/tool ] \
    && cmp -s /usr/local/bin/tool /shelf/tool; then
    pass "binary lands executable at default dest"
else
    fail "binary mode"
fi

# --- 2: tarball mode + watched message -----------------------------------
out=$(askk-get mini.tar.gz /opt/mini)
if [ $? -eq 0 ] && [ "$(cat /opt/mini/hello.txt 2>/dev/null)" = hello ] \
    && [ "$out" = "askk-get: extracted mini.tar.gz into /opt/mini" ]; then
    pass "tarball extracts, watched message intact"
else
    fail "tarball mode (out: $out)"
fi

# --- 3: multi-part tarball == unsplit ------------------------------------
mkdir -p /opt/ref && tar -xzf /tmp/big.tar.gz -C /opt/ref
if askk-get big.tar.gz /opt/big \
    && cmp -s /opt/big/blob /opt/ref/blob \
    && cmp -s /opt/big/marker.txt /opt/ref/marker.txt; then
    pass "multi-part artifact extracts identically to unsplit"
else
    fail "multi-part mode"
fi

# --- 4: missing binary -> non-zero, no droppings -------------------------
if askk-get missing 2>/dev/null; then
    fail "missing binary: expected non-zero exit"
elif [ -e /usr/local/bin/missing ] || [ -e /usr/local/bin/missing.part ]; then
    fail "missing binary left droppings"
else
    pass "missing binary fails clean (retries exhausted)"
fi

# --- 5: missing tarball -> non-zero --------------------------------------
if askk-get missing.tar.gz /opt/none 2>/dev/null; then
    fail "missing tarball: expected non-zero exit"
else
    pass "missing tarball fails"
fi

exit $rc
INNER
