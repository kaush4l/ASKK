#!/usr/bin/env python3
"""Layering enforcement — ARCHITECTURE.md §4, implemented verbatim.

1. `cargo metadata`; keep only workspace members.
2. Build the member-to-member dependency edge set (normal + build deps;
   dev-deps exempt only for adapters_test consumers).
3. Encode the §4 table as an allowlist map; any edge not in the map fails
   with the offending `from -> to` pair printed.
4. Assert wasm-bindgen/web-sys/js-sys appear in the transitive
   normal-dependency closure of adapters_web ONLY (I3 as a mechanical check).

Exit 0 = layering holds. Any violation exits 1.
"""

import json
import subprocess
import sys
from collections import defaultdict

# ARCHITECTURE §4, row for row.
ALLOWED = {
    "kernel": set(),
    "context": {"kernel"},
    "script": {"kernel"},
    "module": {"kernel", "context", "script"},
    "agent": {"kernel", "context", "module"},
    "core": {"kernel", "context", "script", "module", "agent"},
    "adapters_web": {"kernel", "core"},
    "adapters_test": {"kernel"},
}

WASM_CRATES = {"wasm-bindgen", "web-sys", "js-sys"}
WASM_ALLOWED_IN = "adapters_web"


def host_triple():
    out = subprocess.run(["rustc", "-vV"], capture_output=True, text=True, check=True)
    for line in out.stdout.splitlines():
        if line.startswith("host:"):
            return line.split()[1]
    raise RuntimeError("rustc -vV reported no host triple")


def metadata():
    # Filtered to the HOST platform: that is I3's literal claim (pure crates
    # compile on the host with no wasm-bindgen). Unfiltered metadata would
    # count target-gated wasm32 deps (e.g. rhai's) that never build on the
    # host. wasm-bindgen is an unconditional dep of adapters_web, so the
    # only-in-adapters_web assertion still bites.
    out = subprocess.run(
        ["cargo", "metadata", "--format-version", "1",
         "--filter-platform", host_triple()],
        capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout)


def main():
    meta = metadata()
    members = {}  # package id -> name
    for pkg in meta["packages"]:
        if pkg["id"] in meta["workspace_members"]:
            members[pkg["id"]] = pkg["name"]

    missing = set(ALLOWED) - set(members.values())
    if missing:
        print(f"FAIL: workspace is missing expected crates: {sorted(missing)}")
        return 1

    pkg_by_id = {p["id"]: p for p in meta["packages"]}
    resolve = {n["id"]: n for n in meta["resolve"]["nodes"]}

    failures = []

    # --- Check 3: member-to-member edges vs the allowlist -------------------
    for pkg_id, name in members.items():
        for dep in pkg_by_id[pkg_id]["dependencies"]:
            dep_name = dep["name"]
            target_ids = [i for i, n in members.items() if n == dep_name]
            if not target_ids:
                continue  # external crate; check 4 handles the wasm ones
            kind = dep["kind"]  # None = normal, "dev", "build"
            if kind == "dev" and dep_name == "adapters_test":
                continue  # the one sanctioned dev-dep exemption
            if dep_name not in ALLOWED.get(name, set()):
                label = f" ({kind} dep)" if kind else ""
                failures.append(f"forbidden edge: {name} -> {dep_name}{label}")

    # --- Check 4: wasm crates only under adapters_web -----------------------
    # Transitive closure over NORMAL deps per member, from the resolve graph.
    def normal_closure(root_id):
        seen, stack = set(), [root_id]
        while stack:
            nid = stack.pop()
            if nid in seen:
                continue
            seen.add(nid)
            node = resolve.get(nid)
            if node is None:
                continue
            for dep in node["deps"]:
                kinds = {dk.get("kind") for dk in dep["dep_kinds"]}
                if None in kinds or "build" in kinds:
                    stack.append(dep["pkg"])
        return {pkg_by_id[i]["name"] for i in seen if i in pkg_by_id}

    for pkg_id, name in members.items():
        if name == WASM_ALLOWED_IN:
            continue
        hit = WASM_CRATES & normal_closure(pkg_id)
        if hit:
            failures.append(
                f"wasm leakage: {name} transitively depends on {sorted(hit)} "
                f"(allowed only in {WASM_ALLOWED_IN})"
            )

    if failures:
        print("LAYERING CHECK FAILED")
        for f in failures:
            print(f"  {f}")
        return 1

    edges = defaultdict(set)
    for pkg_id, name in members.items():
        for dep in pkg_by_id[pkg_id]["dependencies"]:
            if any(n == dep["name"] for n in members.values()):
                edges[name].add(dep["name"])
    print("layering OK:", ", ".join(f"{k} -> {sorted(v)}" for k, v in sorted(edges.items())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
