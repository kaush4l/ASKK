#!/usr/bin/env python3
"""ASKK local dev server (stdlib only).

- Serves docs/ on :8901 with COOP/COEP so the page is cross-origin isolated
  (SharedArrayBuffer for the c2w VM). GitHub Pages can't send these headers;
  there askk-sw.js does the same job.
- Reverse-proxies /v1/* to the local OpenAI-compatible LLM so the page never
  hits CORS on model calls. Responses stream through as they arrive (SSE).
- /__persist/<name>: GET/PUT blob store under out/persist/ (Eliza parity).
"""
import argparse
import http.server
import os
import pathlib
import re
import sys
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
DOCS = HERE / "docs"
PERSIST_DIR = HERE / "out" / "persist"
UPSTREAM = os.environ.get("ASKK_MODEL_UPSTREAM", "http://127.0.0.1:8873")
MAX_PERSIST_BYTES = 512 * 1024 * 1024
SAFE_NAME = re.compile(r"^[A-Za-z0-9._-]{1,128}$")

# credentialless keeps cross-origin fetches (model CDNs etc.) working without
# CORP headers on every remote; --require-corp switches to the strict mode for
# parity testing with browsers that lack credentialless.
COEP = "credentialless"


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(DOCS), **kw)

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", COEP)
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type, authorization")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    # ---- routing -----------------------------------------------------------
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/v1/"):
            return self.proxy_model()
        if self.path.startswith("/__persist/"):
            return self.persist_get()
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/v1/"):
            return self.proxy_model()
        self.send_error(404)

    def do_PUT(self):
        if self.path.startswith("/__persist/"):
            return self.persist_put()
        self.send_error(404)

    # ---- LLM reverse proxy -------------------------------------------------
    def proxy_model(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        req = urllib.request.Request(UPSTREAM + self.path, data=body, method=self.command)
        for h in ("Content-Type", "Authorization", "Accept"):
            if self.headers.get(h):
                req.add_header(h, self.headers[h])
        try:
            resp = urllib.request.urlopen(req, timeout=600)
        except urllib.error.HTTPError as e:
            resp = e
        except OSError as e:
            self.send_error(502, f"model upstream unreachable: {e}")
            return
        self.send_response(getattr(resp, "status", None) or resp.code)
        self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
        # No Content-Length: stream until upstream EOF, then close. This is
        # what lets chat-completion SSE flow token by token.
        self.send_header("Connection", "close")
        self.close_connection = True
        self.end_headers()
        read = getattr(resp, "read1", resp.read)  # read1 = return as soon as data arrives
        try:
            while chunk := read(65536):
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass  # client hung up mid-stream (normal for cancelled SSE)
        finally:
            resp.close()

    # ---- persistence blobs -------------------------------------------------
    def _persist_path(self):
        name = self.path[len("/__persist/"):]
        if not SAFE_NAME.match(name) or name in (".", ".."):
            self.send_error(400, "bad blob name")
            return None
        PERSIST_DIR.mkdir(parents=True, exist_ok=True)
        return PERSIST_DIR / name

    def persist_get(self):
        p = self._persist_path()
        if p is None:
            return
        if not p.is_file():
            self.send_error(404)
            return
        size = p.stat().st_size
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(size))
        self.end_headers()
        with p.open("rb") as f:
            while chunk := f.read(1 << 20):
                self.wfile.write(chunk)

    def persist_put(self):
        p = self._persist_path()
        if p is None:
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_PERSIST_BYTES:
            self.send_error(413)
            return
        if length <= 0:
            self.send_error(411)
            return
        tmp = p.with_name(p.name + ".part")  # write-then-rename: no torn blobs
        remaining = length
        with tmp.open("wb") as f:
            while remaining > 0:
                chunk = self.rfile.read(min(remaining, 1 << 20))
                if not chunk:
                    break
                f.write(chunk)
                remaining -= len(chunk)
        if remaining > 0:
            tmp.unlink(missing_ok=True)
            self.send_error(400, "short body")
            return
        os.replace(tmp, p)
        body = b'{"ok":true}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        sys.stderr.write("[serve] %s\n" % (fmt % args))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--port", type=int, default=8901)
    ap.add_argument("--require-corp", action="store_true",
                    help="send COEP: require-corp instead of credentialless")
    args = ap.parse_args()
    global COEP
    if args.require_corp:
        COEP = "require-corp"
    srv = http.server.ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    print(f"ASKK dev server: http://127.0.0.1:{args.port}/  "
          f"(COEP: {COEP}, model upstream: {UPSTREAM})")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()
