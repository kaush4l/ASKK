// Drive a headless Chrome over its debugging door with what node already has (as
// scripts/landmark/tab.mjs does), take screenshots, and collect what the console said.
//
//   node shots.mjs <chrome> <profile dir> <out dir> <plan.json> [chrome flags...]
//
// plan.json: [{ name, url, width, height, dark?, media?: [{name, value}], wait?: ms,
//               run?: "js to evaluate before the shot (may be async)", keys?: [...] }]
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const [chrome, profile, out, planFile, ...flags] = process.argv.slice(2);
const plan = JSON.parse(readFileSync(planFile, "utf8"));
mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = spawn(chrome, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--hide-scrollbars",
  `--user-data-dir=${profile}`, "--remote-debugging-port=0", ...flags, "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
const door = await new Promise((resolve, reject) => {
  let said = "";
  const late = setTimeout(() => reject(new Error("Chrome did not say where to reach it: " + said.slice(-300))), 20000);
  browser.stderr.on("data", d => {
    said += d;
    const m = said.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) { clearTimeout(late); resolve(m[1]); }
  });
});
const port = new URL(door).port;
const report = [];
try {
  for (const shot of plan) {
    const page = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error("no page")); });
    let next = 0;
    const waiting = new Map();
    const said = [];
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
      if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) said.push(m.params.type + ": " + m.params.args.map(a => a.value ?? a.description ?? "").join(" ").slice(0, 300));
      if (m.method === "Runtime.exceptionThrown") said.push("exception: " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300));
      if (m.method === "Log.entryAdded" && ["error", "warning"].includes(m.params.entry.level)) said.push("log " + m.params.entry.level + ": " + m.params.entry.text.slice(0, 300));
    };
    const send = (method, params = {}) => new Promise(resolve => { const id = ++next; waiting.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
    const evaluate = async expression => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
    await send("Runtime.enable");
    await send("Log.enable");
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: shot.width, height: shot.height, deviceScaleFactor: 1, mobile: shot.width < 500 });
    const features = [{ name: "prefers-color-scheme", value: shot.dark === false ? "light" : "dark" }, ...(shot.media ?? [])];
    await send("Emulation.setEmulatedMedia", { features });
    await send("Page.navigate", { url: shot.url });
    await sleep(shot.wait ?? 2500);
    let got;
    if (shot.run) got = await evaluate(`(async () => { ${shot.run} })()`);
    for (const k of shot.keys ?? []) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", ...k });
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...k });
      await sleep(k.pause ?? 250);
    }
    if (shot.after) { await sleep(shot.settle ?? 700); got = await evaluate(`(async () => { ${shot.after} })()`); }
    await sleep(shot.settle ?? 700);
    const png = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${out}/${shot.name}.png`, Buffer.from(png.result.data, "base64"));
    report.push({ name: shot.name, got, console: said });
    ws.close();
    await fetch(`http://127.0.0.1:${port}/json/close/${page.id}`);
  }
} catch (e) {
  report.push({ error: String(e.message || e) });
}
browser.kill();
console.log(JSON.stringify(report, null, 1));
