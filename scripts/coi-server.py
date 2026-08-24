#!/usr/bin/env python3
"""The two headers coi-sw.js exists to inject, sent by the server instead.

`scripts/measure-app.sh` drives the REAL Wasm build, and this build needs
cross-origin isolation. In a browser that comes from `web/coi-sw.js`, which has
to install and then have the page reload itself before isolation is in effect —
neither of which is reliable inside a `--virtual-time-budget`. Sending the
headers directly removes the worker from the measurement path entirely.

`no-store` because a measuring rig that can answer from a cache is not a rig.
"""
import functools, http.server, socketserver, sys


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


def main() -> int:
    root, port = sys.argv[1], int(sys.argv[2])
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", port),
                                functools.partial(Handler, directory=root)) as srv:
        srv.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
