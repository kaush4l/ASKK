// capture.mjs — drive headless Chrome over CDP to boot the spike and screenshot
// the real terminal output (virtual-time fast-forward skips the wasm boot, so we
// must wait in real time). Node 22 has fetch + WebSocket built in; no deps.
//
//   node capture.mjs <devtools-ws-or-http> <pageUrl> <outPng>
// Typically invoked by capture.sh which launches Chrome with --remote-debugging-port.

const [, , httpBase, pageUrl, outPng] = process.argv;

async function main() {
  // Discover an existing target page via the CDP HTTP endpoint. Newer Chrome
  // restricts /json/new, so reuse the about:blank tab and navigate it ourselves.
  const targets = await (await fetch(httpBase + "/json/list")).json();
  const page = targets.find((t) => t.type === "page") || targets[0];
  const wsUrl = page.webSocketDebuggerUrl;
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => (ws.onopen = r));

  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res) => {
      const myId = ++id;
      pending.set(myId, res);
      ws.send(JSON.stringify({ id: myId, method, params }));
    });

  await send("Page.enable");
  await send("Runtime.enable");

  // Navigate to the page and wait for load.
  await send("Page.navigate", { url: pageUrl });
  await new Promise((r) => setTimeout(r, 2500)); // allow coi-serviceworker reload

  const evalJs = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  // Poll until the page reports the command finished (window.__c2wDone).
  const deadline = Date.now() + 90000;
  let done = false;
  while (Date.now() < deadline) {
    const status = await evalJs("(window.__c2wDone||false) + '|' + (document.getElementById('status')?document.getElementById('status').textContent:'')");
    if (status && status.startsWith("true")) { done = true; break; }
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (!done) console.error("WARN: timed out waiting for __c2wDone; capturing current state");

  // Give the terminal a moment to paint the final rows.
  await new Promise((r) => setTimeout(r, 800));

  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  const buf = Buffer.from(shot.result.data, "base64");
  const fs = await import("node:fs");
  fs.writeFileSync(outPng, buf);
  console.log("wrote " + outPng + " (" + buf.length + " bytes), done=" + done);
  ws.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
