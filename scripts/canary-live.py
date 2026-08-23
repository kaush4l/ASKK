#!/usr/bin/env python3
"""THE LIVE PAGE, CHECKED AGAINST ITSELF — AND THIS IS NOT A GATE STEP.

A gate step may only be something that can fail BEFORE the world changes. This
runs after a deploy, against a real origin, over the network, and it is called
by hand. It is deliberately not in the six checks and `publish.sh` does not run
it, because a check that only exists after the push cannot stop the push, and
putting it in a numbered list headed "the gate" would teach the next agent to
run a post-deploy probe as if it were a pre-deploy one.

WHAT IT MEASURES. It fetches `index.html`, reads every `integrity="sha384-…"`
attribute out of it, fetches each referenced URL plainly, and checks the digest
the page demands against the digest the origin actually serves. That is exactly
the pairing a browser performs before it will run the module, so a mismatch
here is a page that will not boot for somebody.

WHY IT EXISTS — THE LAYER NO CLIENT-SIDE FIX CAN REACH. `web/sw.js` now fetches
its network-first files with `{cache: "reload"}`, which bypasses the BROWSER's
HTTP cache. It cannot bypass anyone else's. GitHub Pages fronts this site with
Fastly (`via: 1.1 varnish`, `x-cache`, `age`), and if an edge node holds a
previous deploy's object at an unchanged URL, every visitor through that node
gets the mismatch no matter what any page does. This script is the only
instrument that tells those two cases apart, and it says WHICH LAYER is at
fault in its own output:

  * digests all agree      -> the origin is self-consistent. Anyone still seeing
                              a broken page is holding it in their OWN cache.
  * a digest disagrees     -> the origin is serving a stale or wrong object, and
                              the `age`/`x-cache` headers reported beside it say
                              whether an edge node is the one holding it.

Usage: canary-live.py [origin]      (default: the deployed HARNESS page)
"""
import hashlib
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

DEFAULT = "https://kaush4l.github.io/ASKK/"
# Reported for every mismatch, because they are what separates "the edge is
# holding an old object" from "the origin really published this".
EDGE_HEADERS = ("age", "x-cache", "x-served-by", "x-proxy-cache", "cache-control", "etag")


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "harness-canary"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read(), dict((k.lower(), v) for k, v in r.headers.items())


def integrity_refs(html, base):
    """Every (url, expected-sha384) pair the page will not run without."""
    refs = []
    for tag in re.findall(r"<(?:link|script)\b[^>]*>", html, re.I):
        digest = re.search(r'integrity="sha384-([^"]+)"', tag)
        src = re.search(r'(?:href|src)="([^"]+)"', tag)
        if digest and src:
            refs.append((urllib.parse.urljoin(base, src.group(1)), digest.group(1)))
    return refs


def main():
    origin = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    if not origin.endswith("/"):
        origin += "/"
    try:
        body, headers = get(origin)
    except (urllib.error.URLError, OSError) as e:
        print("CANARY: could not fetch %s — %s" % (origin, e), file=sys.stderr)
        return 2
    html = body.decode("utf-8", "replace")
    refs = integrity_refs(html, origin)
    if not refs:
        print("CANARY: %s carries no `integrity` attributes at all. Either this is not "
              "the HARNESS page or the build stopped emitting them, and in both cases "
              "this script measured nothing." % origin, file=sys.stderr)
        return 2

    print("canary: %s  (%d checked resources, document %s)"
          % (origin, len(refs), headers.get("etag", "no etag")))
    bad = []
    for url, want in refs:
        try:
            data, h = get(url)
        except (urllib.error.URLError, OSError) as e:
            bad.append((url, want, "could not fetch: %s" % e, {}))
            continue
        import base64
        got = base64.b64encode(hashlib.sha384(data).digest()).decode()
        if got != want:
            bad.append((url, want, got, h))

    if not bad:
        print("CANARY OK: every resource the page requires hashes to what the page "
              "demands. THE ORIGIN IS SELF-CONSISTENT — anyone still seeing a broken "
              "page is holding a stale copy in their own browser, not getting one from "
              "here.")
        return 0

    print("\nCANARY FAILED: %d resource(s) do not hash to what index.html demands. This "
          "page will not boot for anyone served this combination." % len(bad), file=sys.stderr)
    for url, want, got, h in bad:
        print("\n  %s" % url, file=sys.stderr)
        print("    page demands sha384-%s" % want, file=sys.stderr)
        print("    origin served  %s" % got, file=sys.stderr)
        edge = ", ".join("%s=%s" % (k, h[k]) for k in EDGE_HEADERS if k in h)
        print("    %s" % (edge or "no cache headers reported"), file=sys.stderr)
    print("\nWHICH LAYER: a non-zero `age` with `x-cache: HIT` means an EDGE NODE is "
          "holding this object and no change to the page or its service worker can fix "
          "it — it expires or it is purged. `age=0` with a MISS means the origin itself "
          "is publishing these bytes, and the deploy is what is wrong.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
