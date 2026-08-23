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

No dependency: stdlib http.server plus a WebDriver client that is four calls.
Usage: sw-cache-probe.py --driver <chromedriver> --browser <chrome>
"""
import argparse, json, os, shutil, socket, subprocess, sys, tempfile, threading, time
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

GEN = ["v1"]
# `max-age=600` is not a guess: it is what GitHub Pages answers with for these
# files, measured against the live origin on 2026-08-23.
FRESH = "max-age=600"
VERBATIM = {"sw.js": "application/javascript", "coi-sw.js": "application/javascript",
            "icon.svg": "image/svg+xml", "manifest.webmanifest": "application/manifest+json"}


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


def verdict(r):
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--driver", required=True)
    ap.add_argument("--browser", required=True)
    args = ap.parse_args()

    port = free_port()
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    d = Driver(args.driver, args.browser)
    try:
        result = d.result("http://127.0.0.1:%d/index.html" % port)
    finally:
        d.close()
        server.shutdown()

    if not result:
        print("SW CACHE PROBE: the page never reported in 30s. sw.js probably failed to "
              "install; drop --headless=new from the args above and watch it.", file=sys.stderr)
        return 1
    print("sw cache probe:", json.dumps(result))
    if "error" in result:
        print("SW CACHE PROBE: the page threw: " + result["error"], file=sys.stderr)
        return 1
    # The .js bodies are served as `// v1` so they are still JavaScript;
    # page.html's body is the bare marker. Normalise both to the marker.
    for k in ("warmed", "snippet", "navigation", "control"):
        result[k] = result[k].replace("//", "").strip()
    bad = verdict(result)
    if bad:
        print("SW CACHE PROBE FAILED", file=sys.stderr)
        for b in bad:
            print("  " + b, file=sys.stderr)
        return 1
    print("SW CACHE PROBE OK: network-first reached the network for the snippet and the "
          "navigation, and the HTTP cache was demonstrably warm (control read v1).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
