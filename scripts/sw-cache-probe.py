#!/usr/bin/env python3
"""THE SERVICE WORKER'S NETWORK-FIRST BRANCH, EXECUTED (I17).

Run by `scripts/check-browser.sh`, which is gate check 5, because a claim that
no command could execute shipped a bricked page on 2026-08-23. `web/sw.js`
routed `/snippets/` to a branch its own comment called "network-first", and the
branch called a plain `fetch(request)` — which the BROWSER HTTP CACHE answers
without a round trip. GitHub Pages sends `cache-control: max-age=600` on those
files (measured against the live origin), so every returning visitor with a
warm cache got the PREVIOUS deploy's wasm-bindgen snippet behind the NEW
`index.html`, whose `integrity` attribute names the new file's SHA-384.
Subresource Integrity blocked the module and the boot fallback stayed forever.

No existing check could fail on that. `cargo check` does not run JavaScript;
the Rust browser suite cannot reach a service worker at all, because
`wasm-bindgen-test-runner` serves its tests from its own temp directory and a
worker may only be registered from the page's own origin; and
`publish.sh --dry-run` inspects the artifact, which was correct. So this drives
the REAL `web/sw.js` in a real Chrome against a server that changes a file's
bytes at a URL that does not change — the exact shape of a wasm-bindgen
snippet, whose path is keyed by the crate hash and not by content.

POSITIVE CONTROL (T59), RUN AND NOT IMPLIED: revert the one argument in
`web/sw.js` — `fetch(request, { cache: "reload" })` back to `fetch(request)` —
and this exits 1 with "SNIPPET: got v1". Measured 2026-08-23.

AND THE HALF THAT DOES NOT DISCRIMINATE, SAID OUT LOUD. Under that same revert
the NAVIGATION assertion still read v2: this Chrome did not serve the iframe
navigation from the HTTP cache even with the bug in place. That assertion is
therefore a REGRESSION GUARD, not a proof, and it did not contribute to the
green. "Navigations reach the network" rests on the shared call site, not on a
check that has been seen to fail. Written down rather than left to look covered.

SCENARIO B: THE UPGRADE PATH, added because it was the last link in this story
that was reasoned rather than measured. Scenario A installs the fixed worker
from scratch; a visitor who is broken RIGHT NOW is controlled by the previous
deploy's worker, and no assertion covered what happens when that one is
replaced. B starts on the reverted worker (the harness applies the same
one-line revert, so the two workers differ by exactly the change under test),
changes the data, then changes the worker, and reads what each navigation gets.
It came out as reasoned, and now it is on the record instead of in an argument:

    under_old v1   ->   during v1   ->   after v2

The middle reading is the finding. The navigation that INSTALLS the replacement
is still served by the outgoing worker, so the fix lands on the NEXT one. Two
navigations, measured, not deduced from `skipWaiting()`.

POSITIVE CONTROL for that assertion, also run: under the same revert, `after`
reads v1 and the probe exits 1 — while "the swap happened" stays green
(`askk-new` is present), so the failure is isolated to the fix and is not a
worker that failed to install.

Not asserted in B, and deliberately: `during`. It is a race between the
outgoing worker's fetch and the incoming worker's activation, and it read v1 on
every run here — but a machine that lost that race would fail a test that
demanded v1, and the claim does not need it. It is printed, not gated.

No dependency: stdlib http.server plus a WebDriver client that is four calls.
Usage: sw-cache-probe.py --driver <chromedriver> --browser <chrome>
"""
import argparse, json, os, re, shutil, socket, subprocess, sys, tempfile, threading, time
import pathlib
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The page plays a RETURNING VISITOR: it warms the HTTP cache BEFORE the worker
# exists (which is what a second visit is), then installs the worker, then the
# server changes the bytes behind two unchanged URLs.
#
# `control` is the load-bearing half of a green run. It reads the same file from
# `localhost` instead of `127.0.0.1` — a different ORIGIN, which sw.js ignores by
# design (`url.origin !== location.origin`), so the browser answers it directly.
# If that read comes back v2, this Chrome is not caching at all, every other
# assertion here is vacuous, and the probe says so instead of passing.
PAGE = """<!doctype html><meta charset=utf-8><title>sw cache probe</title>
<body><iframe id=f></iframe><script>
const other = location.origin.replace("127.0.0.1", "localhost") + "/";
const nav = () => new Promise((res, rej) => {
  const f = document.createElement("iframe");
  f.onload = () => { try { res(f.contentDocument.body.textContent.trim()); } catch (e) { rej(e); } };
  f.src = "page.html";
  document.getElementById("f").replaceWith(f);
  f.id = "f";
});
(async () => {
  try {
    await (await fetch("snippets/probe.js")).text();   // 1. the previous visit
    await fetch(other + "snippets/control.js");
    const warmed = await nav();
    const reg = await navigator.serviceWorker.register("sw.js");  // 2. the worker
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(r => navigator.serviceWorker
        .addEventListener("controllerchange", r, {once: true}));
    }
    await fetch("flip", {cache: "no-store"});          // 3. the deploy
    const snippet = (await (await fetch("snippets/probe.js")).text()).trim();
    const navigation = await nav();                    // 4. what it now serves
    const control = (await (await fetch(other + "snippets/control.js")).text()).trim();
    window.__result = {warmed, snippet, navigation, control, scope: reg.scope};
  } catch (e) { window.__result = {error: String(e)}; }
})();
</script>
"""

# SCENARIO B: THE WORKER UPGRADE, which scenario A cannot see because it installs
# the fixed worker from scratch. A visitor who is ALREADY BROKEN is controlled by
# the PREVIOUS deploy's worker, and that worker keeps serving stale bytes for the
# whole navigation during which its replacement installs. The claim under test is
# that the fix therefore lands on the NEXT navigation, not the one that ships it.
#
# The "old" worker is not a mock: the server hands out `web/sw.js` with the one
# argument removed — the same one-line revert the positive control uses — so the
# two workers in this scenario differ by exactly the change being verified.
UPGRADE = """<!doctype html><meta charset=utf-8><title>sw upgrade probe</title>
<body><script>
// Each navigation reports what the CONTROLLING WORKER served for the snippet.
const read = () => new Promise((res, rej) => {
  const f = document.createElement("iframe");
  f.onload = () => {
    let n = 0;
    const t = setInterval(() => {
      const s = (f.contentDocument.body.textContent || "").trim();
      if (s) { clearInterval(t); f.remove(); res(s); }
      else if (++n > 100) { clearInterval(t); rej(new Error("boot.html never reported")); }
    }, 50);
  };
  f.src = "boot.html";
  document.body.appendChild(f);
});
(async () => {
  try {
    await (await fetch("snippets/probe.js")).text();   // the previous visit
    const reg = await navigator.serviceWorker.register("sw.js");   // the OLD worker
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(r => navigator.serviceWorker
        .addEventListener("controllerchange", r, {once: true}));
    }
    const before = await caches.keys();
    await fetch("flip", {cache: "no-store"});          // the deploy's DATA changes
    const under_old = await read();                    // still the old worker
    await fetch("flip-sw", {cache: "no-store"});       // ...and now its WORKER
    const during = await read();                       // navigation 1: the swap
    let keys = await caches.keys(), n = 0;
    while (!keys.includes("askk-new") && n++ < 100) {
      await new Promise(r => setTimeout(r, 50));
      await reg.update();
      keys = await caches.keys();
    }
    const after = await read();                        // navigation 2
    window.__result = {before, under_old, during, after, keys};
  } catch (e) { window.__result = {error: String(e)}; }
})();
</script>
"""

GEN = ["v1"]
# Which `web/sw.js` the server is handing out. Scenario A wants the real one;
# scenario B starts on the reverted one and swaps mid-run.
SW_MODE = ["new"]
# `max-age=600` is not a guess: it is what GitHub Pages answers with for these
# files, measured against the live origin on 2026-08-23.
FRESH = "max-age=600"
# `sw.js` is served by worker_source() instead: scenario B needs two of it.
VERBATIM = {"coi-sw.js": "application/javascript", "icon.svg": "image/svg+xml",
            "manifest.webmanifest": "application/manifest+json"}


def worker_source(mode):
    """`web/sw.js`, stamped, and for "old" with the fix taken back out.

    The stamp is what `publish.sh` does to make a deploy's worker bytes differ so
    the browser installs it, and it is also how the page SEES the swap: `activate`
    deletes every cache but its own, so `askk-new` appearing in `caches.keys()` is
    the new worker having taken over, observed rather than assumed.
    """
    text = pathlib.Path(ROOT, "web", "sw.js").read_text()
    stamped = re.sub(r'const VERSION = "[^"]*";', 'const VERSION = "%s";' % mode, text, count=1)
    if stamped == text:
        raise SystemExit("sw-cache-probe: could not stamp VERSION into web/sw.js")
    if mode == "old":
        # THE ONE-LINE REVERT, applied by the harness, so the two workers in
        # scenario B differ by exactly the change under test and nothing else.
        stamped = stamped.replace('fetch(request, { cache: "reload" })', "fetch(request)")
    return stamped


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, body, ctype, cache, extra=()):
        body = body.encode()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        for k, v in extra:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0].lstrip("/") or "index.html"
        if path == "flip":
            GEN[0] = "v2"
            return self._send("ok", "text/plain", "no-store")
        if path == "flip-sw":
            SW_MODE[0] = "new"
            return self._send("ok", "text/plain", "no-store")
        if path == "upgrade.html":
            return self._send(UPGRADE, "text/html", "no-store")
        if path == "boot.html":
            # A document that is never itself cached, so the only thing that can
            # vary between two navigations is what the worker serves it.
            return self._send('<!doctype html><body><script>fetch("snippets/probe.js")'
                              '.then(r=>r.text()).then(t=>{document.body.textContent='
                              't.trim()});</script>', "text/html", "no-store")
        if path == "sw.js":
            return self._send(worker_source(SW_MODE[0]), "application/javascript", "no-store")
        if path == "snippets/probe.js":
            return self._send("// %s\n" % GEN[0], "application/javascript", FRESH)
        if path == "snippets/control.js":
            return self._send("// %s\n" % GEN[0], "application/javascript", FRESH,
                              [("Access-Control-Allow-Origin", "*")])
        if path == "page.html":
            return self._send("<!doctype html><body>%s" % GEN[0], "text/html", FRESH)
        if path == "index.html":
            return self._send(PAGE, "text/html", "no-store")
        if path in VERBATIM:  # the real worker and its header half, from web/
            with open(os.path.join(ROOT, "web", path)) as fh:
                return self._send(fh.read(), VERBATIM[path], "no-store")
        self.send_error(404)


class Driver:
    """A WebDriver client that is four calls. A dependency would cost more."""

    def __init__(self, driver_bin, browser_bin):
        port = free_port()
        self.base = "http://127.0.0.1:%d" % port
        self.proc = subprocess.Popen([driver_bin, "--port=%d" % port],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.profile = tempfile.mkdtemp(prefix="sw-probe-")
        for _ in range(100):
            try:
                self.call("GET", "/status")
                break
            except Exception:
                time.sleep(0.1)
        caps = {"capabilities": {"alwaysMatch": {"browserName": "chrome", "goog:chromeOptions": {
            "binary": browser_bin,
            "args": ["--headless=new", "--disable-gpu", "--no-sandbox",
                     "--disable-dev-shm-usage", "--user-data-dir=" + self.profile]}}}}
        self.session = self.call("POST", "/session", caps)["value"]["sessionId"]

    def call(self, method, path, body=None):
        req = urllib.request.Request(
            self.base + path, method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())

    def result(self, url):
        self.call("POST", "/session/%s/url" % self.session, {"url": url})
        for _ in range(300):
            got = self.call("POST", "/session/%s/execute/sync" % self.session,
                            {"script": "return window.__result || null;", "args": []})["value"]
            if got:
                return got
            time.sleep(0.1)
        return None

    def close(self):
        try:
            self.call("DELETE", "/session/" + self.session)
        except Exception:
            pass
        self.proc.terminate()
        shutil.rmtree(self.profile, ignore_errors=True)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def verdict_cache(r):
    """The four readings, each with the failure it names. Empty list is a pass."""
    bad = []
    if r["warmed"] != "v1":
        bad.append("the warm-up read %r, not v1 — this server is wrong, not sw.js" % r["warmed"])
    if r["control"] != "v1":
        bad.append("CONTROL: the cross-origin read the worker never sees returned %r, so "
                   "this Chrome is not using its HTTP cache and nothing below proves "
                   "anything" % r["control"])
    if r["snippet"] != "v2":
        bad.append("SNIPPET: got %s, expected v2 — sw.js's network-first branch was answered "
                   "by the HTTP CACHE. This is the bricked page: the new index.html's "
                   "`integrity` names the new bytes and the worker hands the module the "
                   "old ones." % r["snippet"])
    if r["navigation"] != "v2":
        bad.append("NAVIGATION: got %s, expected v2 — a document served stale would pair an "
                   "OLD index.html with the NEW snippet and be blocked by SRI from the other "
                   "side." % r["navigation"])
    return bad


def verdict_upgrade(r):
    """Scenario B. `during` is REPORTED, not asserted — see the module docstring."""
    bad = []
    if r["under_old"] != "v1":
        bad.append("UNDER THE OLD WORKER: got %s, expected v1. The harness failed to build "
                   "the previous deploy's worker, so the swap measured below started from "
                   "the wrong place and means nothing." % r["under_old"])
    if "askk-new" not in r["keys"]:
        bad.append("NO SWAP HAPPENED: the caches present are %r. The replacement worker "
                   "never activated, so this scenario measured nothing about the upgrade "
                   "path." % r["keys"])
    if r["after"] != "v2":
        bad.append("AFTER THE SWAP: got %s, expected v2. The new worker is in control and is "
                   "STILL handing over the previous deploy's bytes — a visitor who is broken "
                   "today would stay broken after the fix ships, and the deploy record must "
                   "not tell them to reload." % r["after"])
    return bad


def run(args, port, page, keys):
    """One browser, one scenario, from a clean profile. Returns the page's report."""
    d = Driver(args.driver, args.browser)
    try:
        result = d.result("http://127.0.0.1:%d/%s" % (port, page))
    finally:
        d.close()
    if result and "error" not in result:
        # The .js bodies are served as `// v1` so they are still JavaScript;
        # the html bodies are the bare marker. Normalise both to the marker.
        for k in keys:
            result[k] = result[k].replace("//", "").strip()
    return result


def report(label, result, check):
    if not result:
        print("%s: the page never reported in 30s. The worker probably failed to install; "
              "drop --headless=new from the args and watch it." % label, file=sys.stderr)
        return 1
    print("%s: %s" % (label.lower(), json.dumps(result)))
    if "error" in result:
        print("%s: the page threw: %s" % (label, result["error"]), file=sys.stderr)
        return 1
    bad = check(result)
    if not bad:
        return 0
    print("%s FAILED" % label, file=sys.stderr)
    for b in bad:
        print("  " + b, file=sys.stderr)
    return 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--driver", required=True)
    ap.add_argument("--browser", required=True)
    args = ap.parse_args()

    port = free_port()
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        a = run(args, port, "index.html", ("warmed", "snippet", "navigation", "control"))
        rc = report("SW CACHE PROBE", a, verdict_cache)
        if rc == 0:
            print("SW CACHE PROBE OK: network-first reached the network for the snippet and "
                  "the navigation, and the HTTP cache was demonstrably warm (control read v1).")
        # Scenario B runs in its own browser from a clean profile, so it starts
        # where a broken visitor actually is: on the PREVIOUS deploy's worker.
        GEN[0], SW_MODE[0] = "v1", "old"
        b = run(args, port, "upgrade.html", ("under_old", "during", "after"))
        rc |= report("SW UPGRADE PROBE", b, verdict_upgrade)
        if b and "error" not in b and rc == 0:
            print("SW UPGRADE PROBE OK: the old worker served %s, the navigation that "
                  "installed the replacement served %s, and the navigation after it served "
                  "%s. THE FIX LANDS ON THE NEXT NAVIGATION, NOT THE ONE THAT SHIPS IT."
                  % (b["under_old"], b["during"], b["after"]))
    finally:
        server.shutdown()
    return rc


if __name__ == "__main__":
    sys.exit(main())
