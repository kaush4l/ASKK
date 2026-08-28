'use client';

import { useEffect, useState } from 'react';
import { probeEndpoint } from '@/client/actions';
import { connect } from '@/client/store';
import { useEngine } from '@/client/use-store';

/**
 * Wave-1 scaffold, still, and now the protocol's only surface. The page owes
 * two things: one string a check can read out of the DOM of the built,
 * subpath-served export, and — from 3.2 — **a way to send a message and see
 * what came back**. `ui/shell/Shell.tsx` replaces it at 6.2 and DESIGN §4.1's
 * Door replaces this probe control at 6.5.
 *
 * The control is here rather than in a test harness because the protocol is not
 * proved by a host test: a fake scope proves the switch, and only a real click
 * driving a real `postMessage` into a real worker proves the wire. Green tests
 * are not a working page.
 *
 * It names no message type and touches no `Worker` (§5.8 rules 1 and 2) — it
 * calls `probeEndpoint` and renders what the store mirrored.
 */
export const PAGE_MARK = 'ASKK_PAGE_ALIVE';

/** The attribute `scripts/verify-worker.ts` reads the engine's boot outcome out of. */
export const ENGINE_ATTRIBUTE = 'data-engine';
/** The probe reply, as the store mirrored it. */
export const PROBE_ATTRIBUTE = 'data-probe';
/** The engine's `failed`, as the store mirrored it. */
export const FAILURE_ATTRIBUTE = 'data-failure';
/** What the browser check types into and clicks. */
export const PROBE_INPUT_ID = 'probe-url';
export const PROBE_BUTTON_ID = 'probe-go';

/**
 * The page starts the engine on mount and publishes how boot ended, including
 * every way it can end badly. A failure that stays out of the DOM is a failure
 * a check can only distinguish from "still waiting" by timing out, and a check
 * like that gets given a longer timeout instead of a fix.
 */
export default function Page() {
  const [url, setUrl] = useState<string>('');
  const engine = useEngine();

  useEffect(() => {
    connect();
  }, []);

  // The rejection is already in the view: `failed` reached the store through
  // the subscription before this promise settled. Swallowing it here is not
  // losing it — it is refusing to report the same fact twice.
  const probe = () => {
    void probeEndpoint(url).catch(() => undefined);
  };

  return (
    <main data-page-mark={PAGE_MARK}>
      <h1>ASKK</h1>
      <p>{PAGE_MARK}</p>
      <pre {...{ [ENGINE_ATTRIBUTE]: engine.boot.kind === 'starting' ? '' : JSON.stringify(engine.boot) }}>
        {JSON.stringify(engine.boot)}
      </pre>
      <label htmlFor={PROBE_INPUT_ID}>endpoint</label>
      <input id={PROBE_INPUT_ID} value={url} onChange={(event) => setUrl(event.target.value)} />
      <button id={PROBE_BUTTON_ID} type="button" onClick={probe}>
        Probe
      </button>
      <pre {...{ [PROBE_ATTRIBUTE]: engine.probe === null ? '' : JSON.stringify(engine.probe) }}>
        {engine.probe === null ? '' : JSON.stringify(engine.probe)}
      </pre>
      <pre {...{ [FAILURE_ATTRIBUTE]: engine.failure ?? '' }}>{engine.failure ?? ''}</pre>
    </main>
  );
}
