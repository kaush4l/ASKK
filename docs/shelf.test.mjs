// docs/shelf.test.mjs — unit tests for AskkShelfCore in docs/askk-sw.js.
// Run: node --test docs/shelf.test.mjs   (this node build rejects dir args)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// askk-sw.js is a classic SW script; outside a SW global it only attaches
// the cores on globalThis. Load it with indirect eval (ingress.test.mjs pattern).
(0, eval)(readFileSync(new URL("./askk-sw.js", import.meta.url), "utf8"));
const shelf = globalThis.AskkShelfCore;

const SHA_PY = "a".repeat(64);
const SHA_CURL = "b".repeat(64);
const MANIFEST = {
  artifacts: {
    "python314.tar.gz": {
      bytes: 200000000,
      sha256: SHA_PY,
      parts: ["python314.tar.gz.part-aa", "python314.tar.gz.part-ab"],
    },
    curl: { bytes: 4000000, sha256: SHA_CURL },
  },
};

test("core is attached outside a SW global", () => {
  assert.ok(shelf, "AskkShelfCore missing");
});

test("isShelfAsset: everything under bin/ except BUNDLES.json", () => {
  for (const rel of [
    "bin/python314.tar.gz",
    "bin/python314.tar.gz.part-aa",
    "bin/python314.tar.gz.parts",
    "bin/curl",
    "bin/hello-askk",
    "bin/README.md",
  ]) assert.ok(shelf.isShelfAsset(rel), "should match: " + rel);
  for (const rel of [
    "bin/BUNDLES.json",
    "wasm/out.wasm.gz.part-aa",
    "binx/curl",
    "BUNDLES.json",
    "",
  ]) assert.ok(!shelf.isShelfAsset(rel), "should not match: " + rel);
});

test("resolveSha: direct basename match", () => {
  assert.equal(shelf.resolveSha(MANIFEST, "curl"), SHA_CURL);
  assert.equal(shelf.resolveSha(MANIFEST, "python314.tar.gz"), SHA_PY);
});

test("resolveSha: a part inherits the parent artifact's sha", () => {
  assert.equal(shelf.resolveSha(MANIFEST, "python314.tar.gz.part-aa"), SHA_PY);
  assert.equal(shelf.resolveSha(MANIFEST, "python314.tar.gz.part-ab"), SHA_PY);
});

test("resolveSha: the .parts index belongs to the parent artifact", () => {
  assert.equal(shelf.resolveSha(MANIFEST, "python314.tar.gz.parts"), SHA_PY);
});

test("resolveSha: uncovered asset or absent manifest -> null", () => {
  assert.equal(shelf.resolveSha(MANIFEST, "rust.tar.gz"), null);
  assert.equal(shelf.resolveSha(MANIFEST, ""), null);
  assert.equal(shelf.resolveSha(null, "curl"), null);
  assert.equal(shelf.resolveSha({}, "curl"), null);
  assert.equal(shelf.resolveSha({ artifacts: {} }, "curl"), null);
});

test("serveDecision: sha hit -> cache (zero network)", () => {
  assert.equal(shelf.serveDecision({ cachedSha: SHA_PY, manifestSha: SHA_PY }), "cache");
});

test("serveDecision: sha mismatch or no cached copy -> network", () => {
  // no cached copy + network failure: handleShelf has nothing to fall back
  // to and propagates the fetch error (plain passthrough failure).
  assert.equal(shelf.serveDecision({ cachedSha: "old", manifestSha: "new" }), "network");
  assert.equal(shelf.serveDecision({ cachedSha: null, manifestSha: SHA_PY }), "network");
  // pre-manifest cached copy (no synthetic sha header) is not trusted
  assert.equal(shelf.serveDecision({ cachedSha: undefined, manifestSha: SHA_PY }), "network");
});

test("serveDecision: no manifest coverage -> conditional revalidation", () => {
  assert.equal(shelf.serveDecision({ cachedSha: SHA_PY, manifestSha: null }), "revalidate");
  assert.equal(shelf.serveDecision({ cachedSha: null, manifestSha: null }), "revalidate");
});
