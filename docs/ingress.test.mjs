// docs/ingress.test.mjs — unit tests for the pure core in docs/askk-sw.js.
// Run: node --test docs/ingress.test.mjs   (this node build rejects dir args)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// askk-sw.js is a classic SW script; outside a SW global it only attaches
// AskkIngressCore on globalThis. Load it with indirect eval.
(0, eval)(readFileSync(new URL("./askk-sw.js", import.meta.url), "utf8"));
const core = globalThis.AskkIngressCore;
const SCOPE = "/ASKK/";

test("core is attached outside a SW global", () => {
  assert.ok(core, "AskkIngressCore missing");
});

test("b64 roundtrip: empty, text, all byte values, 1MB", () => {
  for (const bytes of [
    new Uint8Array(0),
    new TextEncoder().encode("hello ingress"),
    Uint8Array.from({ length: 256 }, (_, i) => i),
    Uint8Array.from({ length: 1 << 20 }, (_, i) => (i * 31) & 0xff),
  ]) {
    assert.deepEqual(core.b64ToBytes(core.bytesToB64(bytes)), bytes);
  }
  assert.equal(core.b64ToStr(core.strToB64("naïve ✓")), "naïve ✓");
});

test("encodeReqJson matches the CONTRACTS schema", () => {
  const wire = JSON.parse(core.encodeReqJson({
    id: "abc", method: "GET", path: "/x?y=1",
    headers: { accept: "text/html" },
  }));
  assert.deepEqual(wire, {
    id: "abc", method: "GET", path: "/x?y=1",
    headers: { accept: "text/html" }, body_b64: "",
  });
});

test("encodeReqRaw golden framing", () => {
  const raw = core.encodeReqRaw({
    id: "id-1", method: "POST", path: "/api/chat?v=2",
    headers: { "content-type": "application/json" },
    body_b64: "eyJhIjoxfQ==",
  });
  assert.equal(raw, [
    "id-1",
    "POST",
    "/api/chat?v=2",
    "h " + core.strToB64("content-type") + " " + core.strToB64("application/json"),
    "b eyJhIjoxfQ==",
    "",
  ].join("\n"));
});

test("parseRespRaw parses what the shell side emits", () => {
  const wire = [
    "200",
    "h " + core.strToB64("Content-Type") + " " + core.strToB64("text/html; charset=utf-8"),
    "h " + core.strToB64("X-Weird") + " " + core.strToB64('comma, "quote": done'),
    "b " + core.bytesToB64(new TextEncoder().encode("<html></html>")),
    "",
  ].join("\n");
  const resp = core.parseRespRaw(wire);
  assert.equal(resp.status, 200);
  assert.equal(resp.headers["Content-Type"], "text/html; charset=utf-8");
  assert.equal(resp.headers["X-Weird"], 'comma, "quote": done');
  assert.equal(new TextDecoder().decode(core.b64ToBytes(resp.body_b64)), "<html></html>");
});

test("parseRespRaw: empty body line, garbage rejected", () => {
  assert.deepEqual(core.parseRespRaw("204\nb \n"), { status: 204, headers: {}, body_b64: "" });
  assert.throws(() => core.parseRespRaw("not-a-status\nb \n"));
  assert.throws(() => core.parseRespRaw("200\nh missing-second-field\n"));
  assert.throws(() => core.parseRespRaw("200\nrogue line\n"));
});

test("parseRespJson: valid and invalid", () => {
  const r = core.parseRespJson('{"status":404,"headers":{"a":"b"},"body_b64":""}');
  assert.deepEqual(r, { status: 404, headers: { a: "b" }, body_b64: "" });
  assert.deepEqual(core.parseRespJson('{"status":200}'),
    { status: 200, headers: {}, body_b64: "" });
  assert.throws(() => core.parseRespJson("null"));
  assert.throws(() => core.parseRespJson('{"headers":{}}'));
  assert.throws(() => core.parseRespJson("{nope"));
});

test("hermesPath: strip, root, query, non-hermes", () => {
  assert.equal(core.hermesPath("__hermes/", ""), "/");
  assert.equal(core.hermesPath("__hermes", ""), "/");
  assert.equal(core.hermesPath("__hermes/assets/app.js", ""), "/assets/app.js");
  assert.equal(core.hermesPath("__hermes/api/list", "?page=2&q=a%20b"), "/api/list?page=2&q=a%20b");
  assert.equal(core.hermesPath("__hermes/", "?x=1"), "/?x=1");
  assert.equal(core.hermesPath("__ingress/poll", ""), null);
  assert.equal(core.hermesPath("__hermesish", ""), null);
  assert.equal(core.hermesPath("index.html", ""), null);
});

test("rewriteLocation: absolute path, guest origin, external, relative", () => {
  assert.equal(core.rewriteLocation("/login", SCOPE), "/ASKK/__hermes/login");
  assert.equal(core.rewriteLocation("/a/b?c=1", SCOPE), "/ASKK/__hermes/a/b?c=1");
  assert.equal(core.rewriteLocation("http://127.0.0.1:9119/dash?x=1#f", SCOPE),
    "/ASKK/__hermes/dash?x=1#f");
  assert.equal(core.rewriteLocation("http://localhost:9119/", SCOPE), "/ASKK/__hermes/");
  assert.equal(core.rewriteLocation("http://localhost:8080/", SCOPE), "http://localhost:8080/");
  assert.equal(core.rewriteLocation("https://example.com/x", SCOPE), "https://example.com/x");
  assert.equal(core.rewriteLocation("relative/page", SCOPE), "relative/page");
  assert.equal(core.rewriteLocation("", SCOPE), "");
});

test("respToResponse: status, headers, location rewrite, body", async () => {
  const body = new TextEncoder().encode("payload");
  const r = core.respToResponse({
    status: 302,
    headers: {
      Location: "/next",
      "Content-Length": "999",           // stripped
      "Transfer-Encoding": "chunked",    // stripped
      "X-Ok": "yes",
    },
    body_b64: core.bytesToB64(body),
  }, SCOPE);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("Location"), "/ASKK/__hermes/next");
  assert.equal(r.headers.get("X-Ok"), "yes");
  assert.equal(r.headers.get("Content-Length"), null);
  assert.equal(r.headers.get("Transfer-Encoding"), null);
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), body);
});

test("respToResponse: 204 has null body, bad status clamps to 502", async () => {
  const r204 = core.respToResponse({ status: 204, headers: {}, body_b64: "" }, SCOPE);
  assert.equal(r204.status, 204);
  assert.equal(r204.body, null);
  assert.equal(core.respToResponse({ status: 99, headers: {}, body_b64: "" }, SCOPE).status, 502);
  assert.equal(core.respToResponse({ status: "??", headers: {}, body_b64: "" }, SCOPE).status, 502);
});

test("queue: submit before poll hands off the queued request", async () => {
  const q = core.createQueue({ orphanMs: 1000 });
  const wire = { id: "q1", method: "GET", path: "/", headers: {}, body_b64: "" };
  const respP = q.submit(wire);
  assert.deepEqual(await q.poll(50), wire);
  assert.equal(q.resolve("q1", { status: 200, headers: {}, body_b64: "" }), true);
  assert.equal((await respP).status, 200);
});

test("queue: poll waits, then receives a later submit", async () => {
  const q = core.createQueue({ orphanMs: 1000 });
  const pollP = q.poll(500);
  const wire = { id: "q2", method: "GET", path: "/x", headers: {}, body_b64: "" };
  const respP = q.submit(wire);
  assert.deepEqual(await pollP, wire);
  q.resolve("q2", { status: 201, headers: {}, body_b64: "" });
  assert.equal((await respP).status, 201);
});

test("queue: poll times out with null (the SW's 204)", async () => {
  const q = core.createQueue({ orphanMs: 1000 });
  assert.equal(await q.poll(20), null);
});

test("queue: unknown id rejected, orphan times out with rejection", async () => {
  const q = core.createQueue({ orphanMs: 30 });
  assert.equal(q.resolve("ghost", { status: 200, headers: {}, body_b64: "" }), false);
  const p = q.submit({ id: "slow", method: "GET", path: "/", headers: {}, body_b64: "" });
  await assert.rejects(p, /orphaned/);
  // after orphaning, a late guest resp is a no-op
  assert.equal(q.resolve("slow", { status: 200, headers: {}, body_b64: "" }), false);
});

test("queue: two pollers, two requests, no cross-talk", async () => {
  const q = core.createQueue({ orphanMs: 1000 });
  const p1 = q.poll(500);
  const p2 = q.poll(500);
  const a = q.submit({ id: "a", method: "GET", path: "/a", headers: {}, body_b64: "" });
  const b = q.submit({ id: "b", method: "GET", path: "/b", headers: {}, body_b64: "" });
  const got = [(await p1).id, (await p2).id].sort();
  assert.deepEqual(got, ["a", "b"]);
  q.resolve("a", { status: 200, headers: {}, body_b64: "" });
  q.resolve("b", { status: 404, headers: {}, body_b64: "" });
  assert.equal((await a).status, 200);
  assert.equal((await b).status, 404);
});

test("wire roundtrip: encodeReqRaw is parseable the way the shell parses it", () => {
  // mimic the sed/grep pipeline: line1-3 fixed, `h ` lines, final `b ` line
  const req = {
    id: "rt", method: "PUT", path: "/f?q=1",
    headers: { "X-A": "one", "X-B": "two words" },
    body_b64: core.bytesToB64(Uint8Array.from([0, 255, 10, 13])),
  };
  const lines = core.encodeReqRaw(req).split("\n");
  assert.equal(lines[0], "rt");
  assert.equal(lines[1], "PUT");
  assert.equal(lines[2], "/f?q=1");
  const hdrs = {};
  for (const l of lines.filter((l) => l.startsWith("h "))) {
    const [, n, v] = l.split(" ");
    hdrs[core.b64ToStr(n)] = core.b64ToStr(v);
  }
  assert.deepEqual(hdrs, req.headers);
  const bodyLine = lines.find((l) => l.startsWith("b "));
  assert.equal(bodyLine.slice(2), req.body_b64);
});
