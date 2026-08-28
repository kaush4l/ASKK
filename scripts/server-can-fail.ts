// REALM: host
/**
 * §8.4's control, shared by every browser check in this tree.
 *
 * "Every browser check's first assertion is a control: a known-missing path
 * must return 404. If the server cannot fail, no later status assertion in that
 * run means anything, and the check aborts saying so rather than passing."
 *
 * It lives in its own module rather than in either check because the rule is
 * about *every* browser check, and a control written twice is a control that
 * gets fixed once. `verify-worker.ts` had it; `verify-export.ts` — the one that
 * gates the deploy — did not, and was reproduced passing on an export whose
 * worker chunk had been deleted, served by a catch-all-200 fixture, printing
 * `200` for the missing file. That is the whole failure this function exists to
 * make impossible, and it had already been written down one increment earlier.
 *
 * `cache: 'reload'` because a request answered out of the HTTP cache reports a
 * status nothing on the network ever sent, which this repo has been fooled by
 * before.
 */

/** Null when the server can report a missing file; otherwise the sentence saying it cannot. */
export async function serverCanFail(url: string): Promise<string | null> {
  const missing = new URL(`askk-control-${Date.now()}.woff2`, url).href;
  const res = await fetch(missing, { cache: 'reload' }).catch(() => null);
  if (!res) return `the control request to ${missing} got no response — the server is not up`;
  if (res.status !== 404) {
    return `control: ${missing} returned ${res.status}, not 404 — this server cannot report a missing file, so nothing below it means anything`;
  }
  return null;
}

/** Runs the control and ends the process if it fails. Every check calls this before it navigates. */
export async function requireServerCanFail(target: string): Promise<void> {
  const control = await serverCanFail(target);
  if (control) {
    console.log(`\nABORT ${target}`);
    console.log(`  - ${control}`);
    process.exit(1);
  }
  console.log('  control: a known-missing path returns 404 — this server can report failure');
}
