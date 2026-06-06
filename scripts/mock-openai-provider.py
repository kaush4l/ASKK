#!/usr/bin/env python3
"""Deterministic OpenAI-compatible mock provider for ASKK browser demos.

Usage:
    python3 scripts/mock-openai-provider.py

Then configure ASKK Provider:
    Base URL: http://127.0.0.1:9989/v1
    Auth: No auth
    Model: mock-worker-model

GET http://127.0.0.1:9989/stats returns concurrency counters for worker-pool demos.
"""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
import time

lock = threading.Lock()
active_requests = 0
max_active_requests = 0
completed_requests = 0
seen_goals = []


def extract_goal(body: bytes) -> str:
    try:
        payload = json.loads(body.decode() or "{}")
    except Exception:
        return "unknown goal"
    messages = payload.get("messages") or []
    for message in reversed(messages):
        content = message.get("content") or ""
        if content.startswith("Goal: "):
            return content.removeprefix("Goal: ").strip()
        if message.get("role") == "user" and content.strip():
            return content.strip()
    return "unknown goal"


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type, authorization")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.rstrip("/") != "/stats":
            self.send_response(404)
            self._cors()
            self.end_headers()
            return
        with lock:
            body = json.dumps(
                {
                    "active_requests": active_requests,
                    "max_active_requests": max_active_requests,
                    "completed_requests": completed_requests,
                    "seen_goals": seen_goals,
                }
            ).encode()
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        global active_requests, max_active_requests, completed_requests
        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length) if length else b""
        if self.path.rstrip("/") != "/v1/chat/completions":
            self.send_response(404)
            self._cors()
            self.end_headers()
            self.wfile.write(b"not found")
            return
        goal = extract_goal(body)
        with lock:
            active_requests += 1
            max_active_requests = max(max_active_requests, active_requests)
            seen_goals.append(goal)
        try:
            time.sleep(1.0)
            content = f"""observation: Mock evidence collected for {goal}.
thinking: The browser worker used the deterministic provider and can finish.
plan:
- Return child result
action: answer
response: Mock child result for {goal}.
"""
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            payload = {"choices": [{"delta": {"content": content}}]}
            self.wfile.write(f"data: {json.dumps(payload)}\n\n".encode())
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        finally:
            with lock:
                active_requests -= 1
                completed_requests += 1

    def log_message(self, format, *args):
        print(format % args, flush=True)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 9989), Handler)
    print("ASKK mock OpenAI provider listening on http://127.0.0.1:9989/v1", flush=True)
    server.serve_forever()
