'use client';

import { useEffect, useState } from 'react';
import { startEngine } from '@/client/worker-client';

/**
 * Wave-1 scaffold, still. The only thing this page owes anyone is one string a
 * check can read out of the DOM of the built, subpath-served export — which is
 * how every later increment proves the page is a page and not a blank document
 * that happened to return 200. `ui/shell/Shell.tsx` replaces it at 6.2.
 */
export const PAGE_MARK = 'ASKK_PAGE_ALIVE';

/** The attribute `scripts/verify-worker.ts` reads the engine's boot outcome out of. */
export const ENGINE_ATTRIBUTE = 'data-engine';

/**
 * The page starts the engine on mount and publishes how boot ended, including
 * every way it can end badly. A failure that stays out of the DOM is a failure
 * a check can only distinguish from "still waiting" by timing out, and a check
 * like that gets given a longer timeout instead of a fix.
 */
export default function Page() {
  const [engine, setEngine] = useState<string>('');

  useEffect(() => {
    const handle = startEngine();
    let live = true;
    void handle.state.then((state) => {
      if (live) setEngine(JSON.stringify(state));
    });
    return () => {
      live = false;
      handle.stop();
    };
  }, []);

  return (
    <main data-page-mark={PAGE_MARK}>
      <h1>ASKK</h1>
      <p>{PAGE_MARK}</p>
      <pre {...{ [ENGINE_ATTRIBUTE]: engine }}>{engine}</pre>
    </main>
  );
}
