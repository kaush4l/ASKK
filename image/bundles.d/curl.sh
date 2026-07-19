# Static curl for the guest (busybox-only image; askk-ingressd needs it —
# startup.sh pulls it off the shelf before the bundles).
CURL_URL="https://github.com/moparisthebest/static-curl/releases/download/v8.11.0/curl-amd64"
if [ ! -s docs/bin/curl ]; then
    echo "== fetch static curl (amd64) =="
    curl -fL "$CURL_URL" -o docs/bin/curl.part && mv docs/bin/curl.part docs/bin/curl
    chmod +x docs/bin/curl
fi
ls -l docs/bin/curl
emit_artifact docs/bin/curl
