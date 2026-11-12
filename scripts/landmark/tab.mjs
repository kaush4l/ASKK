// Open a page in a headless Chrome and wait for the tab to answer (scripts/landmark.sh, 3).
//
//   node tab.mjs <chrome> <url> <folder for chrome's own files>
//
// Prints one line of JSON: {"answer", "steps", "history"} as the page shows them, or
// {"error"} when the page never answered. Nothing is installed: it speaks to Chrome's own
// debugging door with what node already has (fetch, WebSocket; node 22 or later).
import { spawn } from "node:child_process";

const [chrome, url, profile] = process.argv.slice(2);
const WAIT_MS = 90_000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = spawn(chrome, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
  `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

// Chrome says where its door is on its error stream.
const door = await new Promise((resolve, reject) => {
  let said = "";
  const late = setTimeout(() => reject(new Error("Chrome did not say where to reach it: " + said.slice(-300))), 20_000);
  browser.stderr.on("data", d => {
    said += d;
    const m = said.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) { clearTimeout(late); resolve(m[1]); }
  });
  browser.on("exit", code => reject(new Error("Chrome ended at once (" + code + "): " + said.slice(-300))));
});

let out;
try {
  const port = new URL(door).port;
  const page = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error("could not reach the page")); });
  let next = 0;
  const waiting = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  };
  const evaluate = expression => new Promise(resolve => {
    const id = ++next;
    waiting.set(id, m => resolve(m.result?.result?.value));
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
  });
  const read = `(() => { const t = id => document.getElementById(id)?.innerText ?? null;
    return JSON.stringify({ answer: t("answer"), steps: t("steps"), history: t("history"), boot: t("boot"), bootError: t("boot-error") }); })()`;
  const until = Date.now() + WAIT_MS;
  let seen = {};
  while (Date.now() < until) {
    seen = JSON.parse((await evaluate(read)) || "{}");
    if (seen.answer) break;
    await sleep(500);
  }
  out = seen.answer ? seen : { error: "the page did not answer within " + WAIT_MS / 1000 + " s", ...seen };
} catch (e) {
  out = { error: String(e.message || e) };
}
browser.kill();
console.log(JSON.stringify(out));
process.exit(out.error ? 1 : 0);
