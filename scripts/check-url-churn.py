#!/usr/bin/env python3
"""CHANGED BYTES AT AN UNCHANGED URL — the general form of the 2026-08-23 brick.

Called by `publish.sh` before it pushes. It compares the built `dist/` against
the deploy currently on `origin/gh-pages` and finds every path whose CONTENT
changed while its URL did not. Those are exactly the files a browser can pair
across two deploys, and every one of them must be served network-first by
`web/sw.js` or it is a stale-cache bug waiting for its release.

WHAT IT WOULD HAVE CAUGHT. `0a99e9f` edited `crates/adapters_web/src/c2w.js`.
Trunk fingerprints CSS, JS and Wasm by content, but a wasm-bindgen SNIPPET
lives under the CRATE hash: `snippets/adapters_web-c6ebf9abec03fbbe/src/c2w.js`
is identical as a PATH across deploys b01cead, 739e524 and 71022f8 while the
file's hash differs in all three. The new `index.html` named the new digest in
an `integrity` attribute, a warm HTTP cache handed the browser the old bytes,
Subresource Integrity blocked the module, and the page never booted.

THE RULES ARE READ OUT OF `web/sw.js`, NOT COPIED FROM IT. The predicate below
is parsed from that file's `const isData = …` block, so adding a rule there
teaches this check about it and the two cannot drift into disagreeing. A
hand-maintained second copy of the list is how a check like this rots.

Usage: check-url-churn.py <dist dir> <git ref of the live deploy>
"""
import re
import subprocess
import sys
import pathlib

# `sw.js`'s other network-first arm is `request.mode === "navigate"`, which
# resolves to these, so they are already covered.
NAVIGATION = {"index.html", ""}
# The worker script changes on every deploy ON PURPOSE — `publish.sh` stamps
# the commit into `VERSION` so its bytes differ and the browser installs it. It
# is also the one file no service worker can serve to itself: the browser
# fetches a worker script out of band and revalidates it, so it is not subject
# to the failure this check looks for.
EXEMPT = {"sw.js"}


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout


def is_data_rules(sw_path):
    """The `isData` predicate, read out of web/sw.js so it cannot drift."""
    text = pathlib.Path(sw_path).read_text()
    block = re.search(r"const isData\s*=(.*?);", text, re.S)
    if not block:
        raise SystemExit("check-url-churn: no `const isData =` block in %s — the rule "
                         "this check reads has been renamed or removed, and it will not "
                         "guess. Point it at the new predicate." % sw_path)
    includes = re.findall(r'path\.includes\("([^"]+)"\)', block.group(1))
    endswith = re.findall(r'path\.endsWith\("([^"]+)"\)', block.group(1))
    if not includes and not endswith:
        raise SystemExit("check-url-churn: the `isData` block in %s carries no "
                         "`path.includes`/`path.endsWith` rules." % sw_path)
    return includes, endswith


def network_first(rel, rules):
    includes, endswith = rules
    path = "/" + rel
    return (rel in NAVIGATION
            or any(frag in path for frag in includes)
            or any(path.endswith(suffix) for suffix in endswith))


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: check-url-churn.py <dist dir> <git ref of the live deploy>")
    dist, ref = pathlib.Path(sys.argv[1]), sys.argv[2]
    rules = is_data_rules("web/sw.js")

    live = {}
    for line in git("ls-tree", "-r", ref).splitlines():
        meta, path = line.split("\t", 1)
        live[path] = meta.split()[2]

    built = sorted(p for p in dist.rglob("*") if p.is_file())
    if not built:
        raise SystemExit("check-url-churn: %s is empty" % dist)
    # One `git hash-object` for the whole tree, which is the same SHA-1 git
    # already stored for the live side: both sides compared in the same units.
    hashes = git("hash-object", *[str(p) for p in built]).split()

    churned, unguarded = [], []
    for path, sha in zip(built, hashes):
        rel = str(path.relative_to(dist))
        if rel in EXEMPT or rel not in live or live[rel] == sha:
            continue
        churned.append(rel)
        if not network_first(rel, rules):
            unguarded.append(rel)

    for rel in churned:
        print("  changed bytes, unchanged URL: %s%s"
              % (rel, "" if rel in unguarded else "   [network-first, guarded]"))
    if not churned:
        print("URL CHURN OK: every path whose bytes changed also changed its name.")
        return 0
    if not unguarded:
        print("URL CHURN OK: %d path(s) changed under an unchanged URL, and web/sw.js "
              "serves every one of them network-first." % len(churned))
        return 0
    print("\nURL CHURN: %d path(s) change their CONTENT without changing their URL, and "
          "web/sw.js does NOT serve them network-first:" % len(unguarded), file=sys.stderr)
    for rel in unguarded:
        print("    " + rel, file=sys.stderr)
    print("A returning visitor holds the previous deploy's copy of each of these at the "
          "same address the new one uses, so the browser can pair a new page with an old "
          "file. Where that pair is checked — a wasm-bindgen snippet under an `integrity` "
          "attribute — the page does not boot at all. Either give the file a "
          "content-addressed name, or add it to the `isData` predicate in web/sw.js.",
          file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
