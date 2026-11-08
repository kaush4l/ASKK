// Backend + Vite together, output prefixed; Ctrl-C stops both. Usage: bun run dev:all
// Env: PORT (backend, 4600), DATA (data folder, data), UI_PORT (Vite, 1420).
const port = process.env.PORT ?? "4600";
const data = process.env.DATA ?? "data";
const procs = [
  ["server", ["cargo", "run", "-p", "askk-server", "--", "--data", data, "--port", port]],
  ["ui", ["bun", "x", "vite", "dev", ...(process.env.UI_PORT ? ["--port", process.env.UI_PORT] : [])]],
];
const kids = [];
async function pipe(name, stream) {
  const dec = new TextDecoder(); let rest = "";
  for await (const chunk of stream) {
    rest += dec.decode(chunk, { stream: true });
    const lines = rest.split("\n"); rest = lines.pop();
    for (const l of lines) console.log(`[${name}] ${l}`);
  }
  if (rest) console.log(`[${name}] ${rest}`);
}
for (const [name, cmd] of procs) {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", env: { ...process.env, VITE_API_BASE: `http://localhost:${port}` } });
  pipe(name, p.stdout); pipe(name, p.stderr);
  kids.push(p);
  p.exited.then((code) => { console.log(`[${name}] exited ${code}`); stop(); });
}
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  for (const p of kids) try { p.kill("SIGINT"); } catch {}
  await Promise.all(kids.map((p) => p.exited));
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
