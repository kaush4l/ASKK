# lib.sh — shared helpers for shelf bundle scripts (sourced by bundles.sh
# before each image/bundles.d/<name>.sh runs; cwd = repo root).
#
# A bundle script's contract: produce its docs/bin/ artifact(s), then call
# emit_artifact on each. Artifacts are gitignored (gh-pages only); the
# script itself is the committed, reproducible recipe.

# fetch_cached URL [OUTNAME] — download to out/cache once, echo the path.
fetch_cached() {
    _url="$1"
    _name="${2:-$(basename "$_url" | sed 's/%2B/+/g')}"
    _out="out/cache/$_name"
    if [ ! -s "$_out" ]; then
        echo "== fetch $_name ==" >&2
        curl -fL "$_url" -o "$_out.part" && mv "$_out.part" "$_out"
    fi
    echo "$_out"
}

# bundle_container NAME — start a throwaway amd64 alpine container
# askk-bundle-NAME (replacing any stale one), echo its name.
# Callers docker exec/cp against it and MUST bundle_rm when done.
bundle_container() {
    _c="askk-bundle-$1"
    docker rm -f "$_c" >/dev/null 2>&1 || true
    docker run -d --platform linux/amd64 --name "$_c" \
        --add-host host.docker.internal:host-gateway \
        alpine:latest sleep 3600 >/dev/null
    echo "$_c"
}

bundle_rm() {
    docker rm -f "$1" >/dev/null 2>&1 || true
}

# emit_artifact FILE — enforce the 99MB gh-pages gate: files over the 90MiB
# chunk limit are split into FILE.part-* plus a FILE.parts index (one part
# basename per line — busybox wget can't list directories, askk-get reads
# the index and streams the concatenation). Records "<basename> <bytes>" in
# docs/bin/SIZES.txt and the entry (bytes + sha256 of the logical JOINED
# artifact, parts list if split) in docs/bin/BUNDLES.json either way.
emit_artifact() {
    _f="$1"
    _base=$(basename "$_f")
    _size=$(wc -c < "$_f" | tr -d '[:space:]')
    # sha256 of the logical artifact — computed BEFORE any split, streamed
    # via python3 (the one hash tool guaranteed on both mac + linux hosts).
    _sha=$(python3 - "$_f" <<'EOF'
import hashlib, sys
h = hashlib.sha256()
with open(sys.argv[1], "rb") as f:
    for b in iter(lambda: f.read(1 << 20), b""):
        h.update(b)
print(h.hexdigest())
EOF
)
    _limit=94371840
    _parts=""
    if [ "$_size" -gt "$_limit" ]; then
        rm -f "$_f".part-* "$_f.parts"
        split -b "$_limit" "$_f" "$_f.part-"
        for _p in "$_f".part-*; do basename "$_p"; done > "$_f.parts"
        rm "$_f"
        _parts="$_f.parts"
        echo "$_base: $_size bytes -> $(wc -l < "$_f.parts" | tr -d ' ') parts + $_base.parts index"
    else
        echo "$_base: $_size bytes"
    fi
    record_artifact "$_base" "$_size" "$_sha" "$_parts"
}

# record_artifact BASE BYTES SHA256 [PARTS_INDEX] — upsert the shelf
# manifests: the "<BASE> <BYTES>" row in docs/bin/SIZES.txt and the BASE
# entry in docs/bin/BUNDLES.json (SW shelf-cache versioning; schema:
# {"artifacts":{BASE:{"bytes":N,"sha256":hex64,"parts":[...]}}} — "parts"
# only for split artifacts). Split into its own helper so skip paths that
# never re-run a build (rust.sh style) can record without re-emitting.
# A consumer finding no BUNDLES entry falls back to revalidation, so a
# skip path that can't hash the (deleted) joined artifact just stays out.
record_artifact() {
    _rb="$1"
    _rs="$2"
    _rh="$3"
    _rp="${4:-}"
    touch docs/bin/SIZES.txt
    grep -v "^$_rb " docs/bin/SIZES.txt > docs/bin/SIZES.txt.new || true
    echo "$_rb $_rs" >> docs/bin/SIZES.txt.new
    mv docs/bin/SIZES.txt.new docs/bin/SIZES.txt
    python3 - "$_rb" "$_rs" "$_rh" "$_rp" <<'EOF'
import json, os, sys
base, size, sha, parts_idx = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
path = "docs/bin/BUNDLES.json"
try:
    with open(path) as f:
        m = json.load(f)
    if not isinstance(m.get("artifacts"), dict):
        raise ValueError("bad shape")
except Exception:  # missing or corrupt -> rebuild from scratch
    m = {"artifacts": {}}
m["_note"] = ("bytes/sha256 are of the logical joined artifact; "
              "an absent entry means the client falls back to revalidation")
entry = {"bytes": size, "sha256": sha}
if parts_idx:
    with open(parts_idx) as f:
        entry["parts"] = [ln.strip() for ln in f if ln.strip()]
m["artifacts"][base] = entry
with open(path + ".new", "w") as f:
    json.dump(m, f, sort_keys=True)
os.replace(path + ".new", path)
EOF
}
