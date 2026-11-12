// A client that follows a run while it happens (scripts/service.sh).
//
//   node follow.mjs <address of the service> <engine> <question>
//
// It asks the engine the question and, while the answer is still being worked out, follows
// the run the way any window may: it waits on `changes` (the service holds that question open
// until something changes, so nothing is asked on a timer) and, each time the engine is among
// what changed, asks `busy` what the engine is doing now.
//
// Prints one line of JSON: {"answer", "saw": ["thinking think", "calling act", …],
// "waits": how often `changes` came back, "looks": how often `busy` was asked}, or {"error"}.
const [address, engine, question] = process.argv.slice(2);

async function ask(name, args) {
  const res = await fetch(`${address}/ask/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args) });
  const said = await res.json();
  if (said.error) throw new Error(`${name}: ${said.error}`);
  return said.ok;
}

let out;
try {
  // A new reader is told where the feed stands now; from there on it only waits.
  let { epoch, seq } = await ask("changes", { epoch: 0, seen: 0 });
  let answer;
  const asked = ask("run_engine", { path: engine, input: question }).then(a => { answer = a; });
  const saw = [];
  let waits = 0, looks = 0;
  while (answer === undefined) {
    const changed = await Promise.race([ask("changes", { epoch, seen: seq }), asked.then(() => null)]);
    if (!changed) break;
    ({ epoch, seq } = changed);
    waits++;
    if (!changed.keys.some(([key]) => key === `engines/${engine}`)) continue;
    looks++;
    const now = (await ask("busy", {})).find(b => b.path === engine);
    if (!now) continue;
    const marks = now.run?.steps?.at(-1)?.marks ?? [];
    const state = `${now.activity} ${marks.at(-1)?.stage ?? "-"}`;
    if (saw.at(-1) !== state) saw.push(state);
  }
  await asked;
  out = { answer, saw, waits, looks };
} catch (e) {
  out = { error: String(e.message ?? e) };
}
console.log(JSON.stringify(out));
process.exit(out.error ? 1 : 0);
