// REALM: host
/**
 * Drives a served page in a real browser engine and reports what it found.
 *
 *   bun scripts/verify-export.ts http://localhost:4599/ASKK/
 *   bun scripts/verify-export.ts https://kaush4l.github.io/ASKK/
 *
 * A page that rendered and did nothing once passed 426 tests here, so the unit
 * suite is not allowed to be the last word on the export. This is the browser
 * that no test contains: `Bun.WebView`, headless, no dependency.
 *
 * It takes a URL, not a directory, so the deployed site and the local export
 * are proved by the same probe. A check that runs against localhost and a
 * different check that runs against production is two checks, and the one that
 * matters is the one nobody wrote.
 *
 * The three assertions are the whole of wave 1's page contract: the mark is in
 * the DOM, React attached to it, and every request the page made came back
 * under 400. The last one is the failure that bricked this project — a chunk
 * URL resolving to the origin root, 404ing at the subpath and nowhere else,
 * white page, no console error.
 *
 * The readiness wait is in two named stages because the first run of this file
 * went red on a page that was correct: a cold WebKit had not finished starting,
 * and every assertion read an empty document. A browser check that can fail a
 * good page is a check that gets weakened the first time it is inconvenient, so
 * "the browser never got there" and "the page is wrong" are now separate
 * outcomes with separate sentences, and neither is a fixed cadence race.
 */
import { PAGE_MARK } from '../src/app/page';

const target = process.argv[2];
if (!target) {
  console.error('usage: bun scripts/verify-export.ts <url>');
  process.exit(2);
}

/** How long the engine gets to start and the document to load, before either is called a failure. */
const READY_BUDGET_MS = 60_000;
/** How long an assertion about a loaded page gets. Hydration is the slow one. */
const ASSERT_BUDGET_MS = 20_000;

/** Console errors, captured from the engine itself — the page cannot hide one by loading late. */
const consoleErrors: string[] = [];

/**
 * Poll until `expression` is truthy, or the budget runs out.
 *
 * A throw is "not yet", never a result: a WebView that has not finished
 * starting rejects `evaluate` outright, and treating that as a false assertion
 * is exactly the false red this file produced once. The interval widens so a
 * slow start is waited on rather than hammered.
 */
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

/** Every URL the page actually fetched, plus the document itself. */
async function requestedUrls(view: Bun.WebView): Promise<string[]> {
  const resources = (await view.evaluate(
    `performance.getEntriesByType("resource").map((e) => e.name)`,
  )) as string[];
  const doc = (await view.evaluate('location.href')) as string;
  return [doc, ...resources];
}

const view = new Bun.WebView({
  headless: true,
  width: 1440,
  height: 900,
  console: (type, ...args) => {
    if (type === 'error') consoleErrors.push(args.map(String).join(' '));
  },
});

const failures: string[] = [];
let requests: { url: string; status: number }[] = [];
let reached = false;
try {
  await view.navigate(target);

  // Stage 1 — the engine is answering at all. Nothing below means anything
  // until this is true, and its failure is about this machine, not the page.
  const engineUp = await until(view, '1', READY_BUDGET_MS);
  // Stage 2 — the document finished loading, which is what makes the resource
  // list complete. The first run saw 1 of 6 requests by reading it too early.
  const loaded = engineUp && (await until(view, 'document.readyState === "complete"', READY_BUDGET_MS));
  reached = loaded;

  if (!engineUp) {
    failures.push(`the browser never answered in ${READY_BUDGET_MS / 1000}s — this is the engine, not the page`);
  } else if (!loaded) {
    const state = await view.evaluate('document.readyState').catch(() => 'unknown');
    failures.push(`the document never loaded in ${READY_BUDGET_MS / 1000}s (readyState ${state}) — nothing was asserted about the page`);
  }

  if (reached) {
    const markSeen = await until(
      view,
      `document.body.innerText.includes(${JSON.stringify(PAGE_MARK)})`,
      ASSERT_BUDGET_MS,
    );
    if (!markSeen) failures.push(`the identifying string ${PAGE_MARK} is not in the DOM`);

    // React hydration leaves its own keys on the host node. Reading them is the
    // only proof available that the client runtime ran at all — the same markup
    // is in the exported HTML whether React woke up or not.
    const hydrated = await until(
      view,
      `(() => { const el = document.querySelector("[data-page-mark]");
        return el && Object.keys(el).some((k) => k.startsWith("__react")); })()`,
      ASSERT_BUDGET_MS,
    );
    if (!hydrated) failures.push('React never hydrated: no __react key on [data-page-mark]');

    // Statuses come from a second fetch by this process rather than from the
    // page, because a resource served from the HTTP cache reports nothing
    // useful and a masked 404 is exactly what this exists to expose.
    requests = await Promise.all(
      (await requestedUrls(view)).map(async (url) => {
        const res = await fetch(url, { cache: 'reload' }).catch(() => null);
        return { url, status: res ? res.status : 0 };
      }),
    );
    for (const { url, status } of requests) {
      if (status >= 400 || status === 0) failures.push(`${status || 'no response'} for ${url}`);
    }
  }
} finally {
  view.close();
}

for (const { url, status } of requests) console.log(`  ${status}  ${url}`);
console.log(`  ${requests.length} request(s), ${consoleErrors.length} console error(s)`);
for (const message of consoleErrors) console.log(`  console error: ${message}`);

const all = [...failures, ...consoleErrors.map((m) => `console error: ${m}`)];
if (all.length) {
  console.log(`\nFAIL ${target}`);
  for (const line of all) console.log(`  - ${line}`);
  process.exit(1);
}
console.log(`\nPASS ${target} — mark in the DOM, React hydrated, no request over 400`);
