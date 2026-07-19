// Unit tests for the askkRemapURL sentinel remap in docs/stack.js.
// stack.js is a classic (non-module) browser script, so load it via Function.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./stack.js", import.meta.url), "utf8");
const askkRemapURL = new Function(`${src}; return askkRemapURL;`)();

const BACKEND = "http://localhost:8873/v1";
const PAGE = "https://kaush4l.github.io/ASKK/index.html";

test("llm sentinel maps to the backend with path and query preserved", () => {
    assert.equal(
        askkRemapURL("http://llm.askk.internal/v1/chat/completions?stream=true", BACKEND, PAGE),
        "http://localhost:8873/v1/chat/completions?stream=true");
    assert.equal(
        askkRemapURL("http://llm.askk.internal/v1/models", BACKEND, PAGE),
        "http://localhost:8873/v1/models");
});

test("object backend ({url, model} from the page getBackend) is unwrapped", () => {
    assert.equal(
        askkRemapURL("http://llm.askk.internal/v1/models",
                     { url: BACKEND, model: "gemma-4-12B-it-qat-mxfp8" }, PAGE),
        "http://localhost:8873/v1/models");
});

test("bare llm sentinel maps to the backend base; trailing slashes trimmed", () => {
    assert.equal(askkRemapURL("http://llm.askk.internal/v1", BACKEND, PAGE), BACKEND);
    assert.equal(
        askkRemapURL("http://llm.askk.internal/v1/models", "http://localhost:8873/v1/", PAGE),
        "http://localhost:8873/v1/models");
});

test("persist sentinel maps to a same-origin path under the page directory", () => {
    assert.equal(
        askkRemapURL("http://persist.askk.internal/__persist/drive.img", BACKEND, PAGE),
        "https://kaush4l.github.io/ASKK/__persist/drive.img");
    // root-hosted page too
    assert.equal(
        askkRemapURL("http://persist.askk.internal/__persist/x", BACKEND, "http://localhost:8000/"),
        "http://localhost:8000/__persist/x");
});

test("ingress sentinel maps to a same-origin path with query preserved", () => {
    assert.equal(
        askkRemapURL("http://ingress.askk.internal/__ingress/poll?t=30", BACKEND, PAGE),
        "https://kaush4l.github.io/ASKK/__ingress/poll?t=30");
});

test("bin sentinel maps to the same-origin ./bin/ shelf", () => {
    assert.equal(
        askkRemapURL("http://bin.askk.internal/hello-askk", BACKEND, PAGE),
        "https://kaush4l.github.io/ASKK/bin/hello-askk");
    assert.equal(
        askkRemapURL("http://bin.askk.internal/tools/rg.tar.gz?v=1", BACKEND, "http://localhost:8000/"),
        "http://localhost:8000/bin/tools/rg.tar.gz?v=1");
    // boundary: bin.askk.internal.evil.com and binx must not remap
    assert.equal(
        askkRemapURL("http://bin.askk.internal.evil.com/x", BACKEND, PAGE),
        "http://bin.askk.internal.evil.com/x");
});

test("non-sentinel URLs pass through untouched", () => {
    for (const u of [
        "https://example.com/x?y=1",
        "http://llm.askk.internal.evil.com/v1/x", // host boundary
        "http://llm.askk.internal/v1x",           // path boundary
        "https://llm.askk.internal/v1/x",         // sentinel is http only
        "http://127.0.0.1:9119/api",
    ]) {
        assert.equal(askkRemapURL(u, BACKEND, PAGE), u);
    }
});

test("backend changes take effect per call (live getBackend read)", () => {
    let backend = "http://a.example/v1";
    const getBackend = () => backend;
    const guest = "http://llm.askk.internal/v1/chat/completions";
    assert.equal(askkRemapURL(guest, getBackend(), PAGE), "http://a.example/v1/chat/completions");
    backend = "http://b.example/v1";
    assert.equal(askkRemapURL(guest, getBackend(), PAGE), "http://b.example/v1/chat/completions");
});

test("stack.js exposes window.AskkNet = { attach, askkRemapURL }", () => {
    const fakeWindow = {};
    new Function("window", src)(fakeWindow);
    assert.equal(typeof fakeWindow.AskkNet.attach, "function");
    assert.equal(typeof fakeWindow.AskkNet.askkRemapURL, "function");
});
