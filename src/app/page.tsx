'use client';

import { useEffect, useState } from 'react';
import { runWorkerProbe } from '@/client/worker-probe';

/**
 * Wave-1 scaffold. The only thing this page owes anyone is one string a check
 * can read out of the DOM of the built, subpath-served export — which is how
 * every later increment proves the page is a page and not a blank document
 * that happened to return 200.
 */
export const PAGE_MARK = 'ASKK_PAGE_ALIVE';

/** The attribute `scripts/verify-worker.ts` reads the probe's findings out of. */
export const PROBE_ATTRIBUTE = 'data-worker-probe';

/**
 * The page runs the probe on mount and publishes its result, including its
 * failures. A probe that throws must still land in the DOM: a check that can
 * only distinguish "wrong" from "still waiting" by timing out is a check that
 * gets given a longer timeout instead of a fix.
 */
export default function Page() {
  const [probe, setProbe] = useState<string>('');

  useEffect(() => {
    let live = true;
    runWorkerProbe()
      .then((result) => live && setProbe(JSON.stringify(result)))
      .catch((error: unknown) => live && setProbe(JSON.stringify({ error: String(error) })));
    return () => {
      live = false;
    };
  }, []);

  return (
    <main data-page-mark={PAGE_MARK}>
      <h1>ASKK</h1>
      <p>{PAGE_MARK}</p>
      <pre {...{ [PROBE_ATTRIBUTE]: probe }}>{probe}</pre>
    </main>
  );
}
