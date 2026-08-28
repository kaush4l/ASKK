// REALM: host
/**
 * Drives the built export in a real browser and asserts the four facts the
 * realm map, §3.2, §7.3 and §8.1 are all standing on.
 *
 *   bun scripts/verify-worker.ts http://localhost:4599/ASKK/
 *   bun scripts/verify-worker.ts https://kaush4l.github.io/ASKK/
 *
 * `docs/scratch/MEASURED.md` established these once, in a scratch probe,
 * outside this repository. That is a measurement, not a check: a toolchain
 * upgrade expires all four at the same moment and the tree would carry on
 * citing a file. This is the standing assertion the measurement became.
 *
 * The one that can genuinely ship broken is the last. MEASURED M5's probe
 * callback **returned**, which released the lock — which is exactly why its
 * follow-up `{ifAvailable:true}` was granted, and why citing M5 as proof of the
 * single-writer election was wrong (`ARCHITECTURE.md` §7.3 corrects it in
 * writing). The property the election actually rests on is that a second
 * `{ifAvailable:true}` request made **while the first callback is still
 * pending** receives `null`, and nothing has ever tested that. This does.
 *
 * Like `verify-export.ts` it takes a URL and not a directory, so the local
 * export and the deployed site are proved by the same probe (§8.4).
 */
import { PROBE_SENTINEL } from '../src/engine/probe.worker';
import { PROBE_ATTRIBUTE } from '../src/app/page';
import { requireServerCanFail } from './server-can-fail';

const target = process.argv[2];
if (!target) {
  console.error('usage: bun scripts/verify-worker.ts <url>');
  process.exit(2);
}

/** How long the engine gets to start and the document to load. */
const READY_BUDGET_MS = 60_000;
/** How long the worker, two lock requests and a render get. */
const PROBE_BUDGET_MS = 30_000;

const consoleErrors: string[] = [];

async function until(view: Bun.WebView, expression: string, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  let interval = 50;
  while (Date.now() < deadline) {
    try {
      if (await view.evaluate(`!!(${expression})`)) return true;
    } catch {
      // the engine is not answering yet
    }
    await Bun.sleep(interval);
    interval = Math.min(interval * 2, 1000);
  }
  return false;
}

/** The four commitments, each as one sentence naming what it protects. */
function assertions(probe: Record<string, unknown>): string[] {
  const failures: string[] = [];
  const expect = (ok: boolean, message: string): void => {
    if (!ok) failures.push(message);
  };
  expect(
    probe.sentinel === PROBE_SENTINEL,
    `the worker did not reply with ${PROBE_SENTINEL} (got ${JSON.stringify(probe.sentinel)}) — a worker built from new URL(..., import.meta.url) no longer loads and runs under basePath (§3.2)`,
  );
  expect(
    probe.hasLS === false,
    'localStorage is PRESENT in the worker — the realm map\'s one piece of physics is gone and main-realm state can now be duplicated into the worker (§3.4 mechanism 1)',
  );
  expect(
    probe.hasIDB === true,
    'indexedDB is ABSENT in the worker — the worker cannot own persistence and §3.3 no longer holds',
  );
  expect(
    probe.hasLocks === true,
    'navigator.locks is absent in the worker — §7.3 has no election and §11\'s worse fallback is back on the table',
  );
  expect(probe.freeGrant === true, '{ifAvailable:true} did NOT grant a lock nobody holds — the first tab can never become the writer (§7.3)');
  // The lock name comes from the probe because it is generated per run: a
  // message naming a fixed `askk.writer` sends a reader grepping for a string
  // that appears in no source file.
  expect(probe.heldByFirst === true, `the first worker was not granted ${String(probe.lockName)} with {ifAvailable:true} (§7.3)`);
  expect(
    probe.secondGrantedWhileHeld === false,
    'THE ELECTION IS BROKEN: a second {ifAvailable:true} request was GRANTED while the first callback was still pending. Two tabs are two writers on one database, and §7.3\'s never-settling hold is not being held',
  );
  return failures;
}

await requireServerCanFail(target);

const view = new Bun.WebView({
  headless: true,
  width: 1440,
  height: 900,
  console: (type, ...args) => {
    if (type === 'error') consoleErrors.push(args.map(String).join(' '));
  },
});

const failures: string[] = [];
try {
  await view.navigate(target);
  const loaded = await until(view, 'document.readyState === "complete"', READY_BUDGET_MS);
  if (!loaded) {
    failures.push(`the document never loaded in ${READY_BUDGET_MS / 1000}s — this is the browser, not the page`);
  } else {
    const selector = `[${PROBE_ATTRIBUTE}]`;
    const read = `(document.querySelector(${JSON.stringify(selector)}) || {}).getAttribute && document.querySelector(${JSON.stringify(selector)}).getAttribute(${JSON.stringify(PROBE_ATTRIBUTE)})`;
    const answered = await until(view, read, PROBE_BUDGET_MS);
    if (!answered) {
      failures.push(
        `${selector} is still empty after ${PROBE_BUDGET_MS / 1000}s — the worker never replied at all. Its chunk 404ing under basePath looks exactly like this`,
      );
    } else {
      const raw = (await view.evaluate(read)) as string;
      console.log(`  probe: ${raw}`);
      const probe = JSON.parse(raw) as Record<string, unknown>;
      // A probe that threw has no findings, and asserting on the absent fields
      // would print six sentences blaming the platform for one broken worker.
      if (typeof probe.error === 'string') failures.push(`the probe threw: ${probe.error}`);
      else failures.push(...assertions(probe));
    }
  }
} finally {
  view.close();
}

for (const message of consoleErrors) console.log(`  console error: ${message}`);

const all = [...failures, ...consoleErrors.map((m) => `console error: ${m}`)];
if (all.length) {
  console.log(`\nFAIL ${target}`);
  for (const line of all) console.log(`  - ${line}`);
  process.exit(1);
}
// An explicit exit, because this one does not end on its own: with a worker
// having run in it, the WebView keeps the loop alive after `close()` and the
// process hangs on a PASS — which in the deploy path is a check that never
// returns rather than a check that passed.
console.log(`\nPASS ${target} — worker runs at the subpath, no localStorage, indexedDB present, and the writer lock refuses a second holder while the first is pending`);
process.exit(0);
