#!/usr/bin/env python3
"""HARNESS local dev server (stdlib only).

- Serves a static directory (--dir, default web/) on --port (default 8901).
- Reverse-proxies /v1/* to a local OpenAI-compatible LLM so the page never
  hits CORS on model calls. Responses stream through as they arrive (SSE).
- --coi turns on COOP/COEP/CORP headers for cross-origin-isolation
  experiments; off by default (HARNESS uses no SharedArrayBuffer).
"""
import argparse
import http.server
import os
import sys
import urllib.error
import urllib.request

UPSTREAM = os.environ.get("HARNESS_MODEL_UPSTREAM", "http://127.0.0.1:8873")
COI = False


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def end_headers(self):
        if COI:
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "credentialless")
            self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type, authorization")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/v1/"):
            return self.proxy_model()
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/v1/"):
            return self.proxy_model()
        self.send_error(404)

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

    def log_message(self, fmt, *args):
        sys.stderr.write("[serve] %s\n" % (fmt % args))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dir", default="web", help="directory to serve (default web)")
    ap.add_argument("--port", type=int, default=8901)
    ap.add_argument("--coi", action="store_true",
                    help="send COOP/COEP/CORP headers (cross-origin isolation)")
    args = ap.parse_args()
    global COI
    COI = args.coi

    def handler(*a, **kw):
        return Handler(*a, directory=args.dir, **kw)

    srv = http.server.ThreadingHTTPServer(("0.0.0.0", args.port), handler)
    print(f"HARNESS dev server: http://127.0.0.1:{args.port}/  "
          f"(dir: {args.dir}, coi: {COI}, model upstream: {UPSTREAM})")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()
