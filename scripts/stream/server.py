"""A model server for tests: OpenAI's chat-completions, answered as a real stream.

It speaks what an `openai` model entry asks (POST <base>/chat/completions, GET <base>/models)
and, asked to stream, sends server-sent events, one word at a time with a pause between, so a
test can see the answer arrive before it ends (scripts/stream.sh). No network, no key.

  python3 server.py <port> [pause seconds]

What it says depends on the last message:
  - it asks for a file to be written: first a call to `run` whose program writes one (the
    workspace's Diff then shows a file no tool wrote); once the program's output is in the
    prompt, an answer that says so;
  - anything else: a slow answer, word by word.
"""
import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1])
PAUSE = float(sys.argv[2]) if len(sys.argv) > 2 else 0.3
# The words of the slow answer; a test looks for the last one to know it is whole.
WORDS = "Streams arrive piece by piece so the page can show each word as it comes and the last word is finished".split()


def prompt_of(body):
    msgs = body.get("messages") or [{}]
    c = msgs[-1].get("content", "")
    if isinstance(c, list):
        c = " ".join(p.get("text", "") for p in c if isinstance(p, dict))
    return c


def reply_for(prompt):
    if "write a file" in prompt.lower():
        # The program prints WROTE-IT; its own text spells it apart, so seeing it means it ran.
        if "WROTE-IT" in prompt:
            return ["summary: ", "Say ", "what ", "the ", "program ", "did\n", "answer: ", "A ", "program ", "wrote ", "made-by-program.txt."]
        return ['summary: Write the file with a program\nact: [run(command: "printf \'written by a program, not by write_file\\\\n\' > made-by-program.txt && printf WRO\'\'TE-IT")]\n']
    return ["summary: ", "Answer ", "slowly\n", "answer: "] + [w + " " for w in WORDS[:-1]] + [WORDS[-1] + "."]


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def log_message(self, *a):
        pass

    def send_json(self, value, status=200):
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.rstrip("/").endswith("/models"):
            return self.send_json({"data": [{"id": "sse", "context_length": 32768}]})
        self.send_json({"error": {"message": "not here"}}, 404)

    def do_POST(self):
        n = int(self.headers.get("content-length") or 0)
        body = json.loads(self.rfile.read(n) or b"{}")
        pieces = reply_for(prompt_of(body))
        if not body.get("stream"):
            return self.send_json({"choices": [{"message": {"role": "assistant", "content": "".join(pieces)}}]})
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.send_header("cache-control", "no-cache")
        self.end_headers()
        for p in pieces:
            event = {"choices": [{"index": 0, "delta": {"content": p}}]}
            self.wfile.write(f"data: {json.dumps(event)}\n\n".encode())
            self.wfile.flush()
            time.sleep(PAUSE)
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()


ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
