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
 * It takes a URL rather than a directory so the deployed site and the local
 * export are proved by the same probe. A check that runs against localhost and
 * a different check that runs against production is two checks, and the one
 * that matters is the one nobody wrote.
 *
 * The three assertions are the whole of wave 1's page contract: the mark is in
 * the DOM, React attached to it, and every request the page made came back
 * under 400. The last one is the failure that bricked this project — a chunk
 * URL resolving to the origin root, 404ing at the subpath and nowhere else,
 * white page, no console error.
 */
import { PAGE_MARK } from '../src/app/page';

const target = process.argv[2];
if (!target) {
  console.error('usage: bun scripts/verify-export.ts <url>');
  process.exit(2);
}

/** Console errors, captured from the engine itself — the page cannot hide one by loading late. */
const consoleErrors: string[] = [];

/** Wait for `expression` to be truthy in the page, or give up. */
async function until(view: Bun.WebView, expression: string, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await view.evaluate(`!!(${expression})`)) return true;
    await Bun.sleep(100);
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
try {
  await view.navigate(target);
  const loaded = await until(view, 'document.readyState === "complete"', 30_000);
  if (!loaded) failures.push('the document never reached readyState complete');

  const markSeen = await until(
    view,
    `document.body.innerText.includes(${JSON.stringify(PAGE_MARK)})`,
    30_000,
  );
  if (!markSeen) failures.push(`the identifying string ${PAGE_MARK} is not in the DOM`);

  // React hydration leaves its own keys on the host node. Reading them is the
  // only proof available that the client runtime ran at all — the same markup
  // is in the exported HTML whether React woke up or not.
  const hydrated = await until(
    view,
    `(() => { const el = document.querySelector("[data-page-mark]");
      return el && Object.keys(el).some((k) => k.startsWith("__react")); })()`,
    30_000,
  );
  if (!hydrated) failures.push('React never hydrated: no __react key on [data-page-mark]');

  // Statuses come from a second fetch by this process rather than from the
  // page, because a resource served from the HTTP cache reports nothing useful
  // and a masked 404 is exactly what this exists to expose.
  requests = await Promise.all(
    (await requestedUrls(view)).map(async (url) => {
      const res = await fetch(url, { cache: 'reload' }).catch(() => null);
      return { url, status: res ? res.status : 0 };
    }),
  );
  for (const { url, status } of requests) {
    if (status >= 400 || status === 0) failures.push(`${status || 'no response'} for ${url}`);
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
