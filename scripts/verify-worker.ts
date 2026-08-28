// REALM: host
/**
 * Drives the built export in a real browser and makes SEVEN assertions about
 * the engine, across three claims: §3.2 (a worker built from `new URL(...)`
 * still loads and runs under basePath), §7.3 (the single-writer election) and,
 * from 3.2, §6 (the message protocol crosses a real realm boundary). It does
 * NOT reach §3.2's classic-worker fact or §8.1's bundle partition; no check in
 * this tree asserts either, which is why MEASURED.md keeps M2 and M3 in full.
 *
 * **Why the protocol is asserted here and not only in `tests/protocol.test.ts`.**
 * That suite drives the real switch and the real store, but the messages cross
 * a function call: structured clone never runs, the worker chunk is never
 * loaded, and a payload that cannot survive `postMessage` passes every one of
 * its cases. Green tests are not a working page. Here a person's click goes
 * through `actions.ts`, `worker-client.ts`, a real `postMessage`, the worker's
 * switch and back into the store, and the assertion is on what the DOM shows.
 *
 *   bun scripts/verify-worker.ts http://localhost:4599/ASKK/
 *   bun scripts/verify-worker.ts https://kaush4l.github.io/ASKK/
 *
 * `docs/scratch/MEASURED.md` established these once, in a scratch probe,
 * outside this repository. That is a measurement, not a check: a toolchain
 * upgrade expires them all at the same moment and the tree would carry on
 * citing a file. This is the standing assertion the measurement became.
 *
 * **Its subject changed at 3.1 and the assertions got stronger, not weaker.**
 * It used to drive `engine/probe.worker.ts`, 179 lines of scaffold that ran on
 * every production page load and asked itself two questions about a lock name
 * it made up. It now drives the product: `client/worker-client.ts` starts the
 * real `engine/entry.worker.ts`, which elects the real `askk.writer` lock, and
 * the second writer is a **second instance of the whole page** in a same-origin
 * iframe rather than a second synthetic lock request.
 *
 * That is what makes the election assertion real. MEASURED M5's probe callback
 * **returned**, which released the lock — which is exactly why its follow-up
 * `{ifAvailable:true}` was granted, and why citing M5 as proof of the election
 * was wrong (`ARCHITECTURE.md` §7.3 corrects it in writing). Here the first
 * page's worker is still running, still inside `lease.ts`'s never-settling
 * callback, when the second page boots. If that promise ever settles — the one
 * mistake §7.3 spells out — the second instance is granted the lock and reports
 * `ready`, and this check goes red naming it.
 *
 * Two assertions the probe made are gone, and here is where they went, because
 * a check quietly asserting less is how a gate rots. `hasLS:false` and
 * `hasIDB:true` were platform facts the probe reported for no other reader:
 * `checks/realm.ts` now refuses the identifier `localStorage` under
 * `src/engine/**` statically, and the absence of `indexedDB` stops being a
 * report and becomes a `fatal { reason:'storage-blocked' }` the moment
 * `engine/db.ts` opens the database at 3.4. Neither is asserted by this file in
 * the meantime, and MEASURED M1 still records both.
 *
 * Like `verify-export.ts` it takes a URL and not a directory, so the local
 * export and the deployed site are proved by the same probe (§8.4).
 */
import { WORKER_MARK } from '../src/engine/host';
import {
  ENGINE_ATTRIBUTE,
  FAILURE_ATTRIBUTE,
  PROBE_ATTRIBUTE,
  PROBE_BUTTON_ID,
  PROBE_INPUT_ID,
} from '../src/app/page';
import { requireServerCanFail } from './server-can-fail';

const target = process.argv[2];
if (!target) {
  console.error('usage: bun scripts/verify-worker.ts <url>');
  process.exit(2);
}

/** How long the engine gets to start and the document to load. */
const READY_BUDGET_MS = 60_000;
/** How long the worker, the election and a render get. */
const BOOT_BUDGET_MS = 30_000;
/** How long the second instance gets to load its own document, start its own worker and lose. */
const SECOND_BUDGET_MS = 60_000;

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

/** JavaScript that reads the boot outcome out of a document — this page's, or the iframe's. */
function readEngine(document: string): string {
  const selector = JSON.stringify(`[${ENGINE_ATTRIBUTE}]`);
  const attribute = JSON.stringify(ENGINE_ATTRIBUTE);
  return `((${document}) && (${document}).querySelector(${selector}) ? (${document}).querySelector(${selector}).getAttribute(${attribute}) : '')`;
}

/** Reads any attribute this page publishes a piece of the store into. */
function readAttribute(attribute: string): string {
  const selector = JSON.stringify(`[${attribute}]`);
  return `(document.querySelector(${selector}) ? document.querySelector(${selector}).getAttribute(${JSON.stringify(attribute)}) : '')`;
}

/**
 * Types a URL into the probe field and clicks. The native value setter plus a
 * bubbling `input` event is what React's synthetic layer reads; assigning
 * `.value` alone updates the DOM node and leaves React's state on the old
 * value, so the click would probe the empty string and this check would assert
 * against a message it never sent.
 */
function clickProbe(url: string): string {
  return `(() => {
    const input = document.getElementById(${JSON.stringify(PROBE_INPUT_ID)});
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(url)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById(${JSON.stringify(PROBE_BUTTON_ID)}).click();
    return true;
  })()`;
}

/** How long one probe round trip gets: click, worker, fetch, reply, render. */
const PROBE_BUDGET_MS = 20_000;

const THIS_DOCUMENT = 'document';
/** The second instance's document. Same origin, so its DOM is readable from here. */
const IFRAME_DOCUMENT = "(document.getElementById('askk-second-tab')||{}).contentDocument";

/** What the first instance must report: the engine started and this build's worker is what answered. */
function firstAssertions(engine: Record<string, unknown>): string[] {
const failures: string[] = [];
  if (engine.kind !== 'ready') {
    failures.push(
      `the first instance did not boot: it reports ${JSON.stringify(engine)}. A worker built from new URL(..., import.meta.url) no longer loads and runs under basePath (§3.2), or the election refused the only tab open (§7.3)`,
    );
    return failures;
  }
  if (engine.mark !== WORKER_MARK) {
    failures.push(
      `the engine replied ready with mark ${JSON.stringify(engine.mark)}, not ${WORKER_MARK} — whatever answered is not this build's engine/entry.worker.ts (§8.1)`,
    );
  }
  return failures;
}

/** What the second instance must report: refused, by name, rather than granted a second writer. */
function secondAssertions(engine: Record<string, unknown>): string[] {
  if (engine.kind === 'fatal' && engine.reason === 'another-tab') return [];
  if (engine.kind === 'ready') {
    return [
      'THE ELECTION IS BROKEN: a second instance of the page was granted askk.writer while the first still held it, and reported ready. Two tabs are two writers on one database, and §7.3\'s never-settling hold is not being held',
    ];
  }
  return [
    `the second instance ended as ${JSON.stringify(engine)} instead of fatal{reason:'another-tab'} — it neither became the writer nor was told why not, so §7.3's legible refusal is not what MAIN renders`,
  ];
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

/** Reads, parses and asserts one instance's boot outcome. */
async function instance(document: string, budgetMs: number, assertions: (engine: Record<string, unknown>) => string[], label: string): Promise<string[]> {
  const read = readEngine(document);
  if (!(await until(view, read, budgetMs))) {
    return [`the ${label} never published a boot outcome in ${budgetMs / 1000}s. Its worker chunk 404ing under basePath looks exactly like this`];
  }
  const raw = (await view.evaluate(read)) as string;
  console.log(`  ${label}: ${raw}`);
  return assertions(JSON.parse(raw) as Record<string, unknown>);
}

/**
 * The protocol, end to end, twice.
 *
 * A base URL that is not an address never reaches the network: `new URL(...)`
 * throws inside the handler, `engine/host.ts` catches it and replies `failed`
 * with the URL parser's own words (§6.5). That proves a request crossed, a
 * handler threw, the worker survived it, and the client wrote the answer down.
 *
 * Then a real one. The page's own origin has no `/models`, so the endpoint
 * answers and the outcome is `http` — which is the point: a reply carrying a
 * structured payload came back out of the worker and into the DOM.
 */
async function protocolAssertions(): Promise<string[]> {
  const found: string[] = [];
  await view.evaluate(clickProbe('not an address'));
  if (!(await until(view, readAttribute(FAILURE_ATTRIBUTE), PROBE_BUDGET_MS))) {
    found.push(`a probe of a base URL that is not an address published no ${FAILURE_ATTRIBUTE} in ${PROBE_BUDGET_MS / 1000}s — either the request never reached the worker, or \`failed\` never came back, or the store did not write it (§6.5, §6.7 rule 3)`);
  } else {
    console.log(`  failed: ${(await view.evaluate(readAttribute(FAILURE_ATTRIBUTE))) as string}`);
  }
  await view.evaluate(clickProbe(target as string));
  if (!(await until(view, readAttribute(PROBE_ATTRIBUTE), PROBE_BUDGET_MS))) {
    found.push(`a probe of ${target} published no ${PROBE_ATTRIBUTE} in ${PROBE_BUDGET_MS / 1000}s — config/probe went out and config/probed never arrived (§6.2)`);
    return found;
  }
  const raw = (await view.evaluate(readAttribute(PROBE_ATTRIBUTE))) as string;
  console.log(`  config/probed: ${raw}`);
  const result = JSON.parse(raw) as { outcome?: string; elapsedMs?: number };
  if (result.outcome !== 'http') {
    found.push(`the probe of ${target} reported ${JSON.stringify(result.outcome)}; this page's own origin has no /models, so the endpoint answers and the outcome is http. Any other value means the probe did not reach the network it says it reached`);
  }
  if (typeof result.elapsedMs !== 'number') {
    found.push(`the probe reply carried no numeric elapsedMs — the payload did not survive the realm crossing intact (§6.4)`);
  }
  return found;
}

const failures: string[] = [];
try {
  await view.navigate(target);
  const loaded = await until(view, 'document.readyState === "complete"', READY_BUDGET_MS);
  if (!loaded) {
    failures.push(`the document never loaded in ${READY_BUDGET_MS / 1000}s — this is the browser, not the page`);
  } else {
    failures.push(...(await instance(THIS_DOCUMENT, BOOT_BUDGET_MS, firstAssertions, 'first instance')));
    failures.push(...(await protocolAssertions()));
    // The first worker is still inside lease.ts's callback for every line
    // below: a second instance of the whole page, same origin, same lock
    // namespace. This is a second tab in everything but the window.
    await view.evaluate(
      `(() => { const f = document.createElement('iframe'); f.id = 'askk-second-tab'; f.src = ${JSON.stringify(target)}; document.body.appendChild(f); })()`,
    );
    failures.push(...(await instance(IFRAME_DOCUMENT, SECOND_BUDGET_MS, secondAssertions, 'second instance')));
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
console.log(`\nPASS ${target} — the engine boots in a worker at the subpath, the protocol round-trips a request, a reply and a failure across the realm boundary, and a second instance of the page is refused the writer lock while the first still holds it`);
process.exit(0);
