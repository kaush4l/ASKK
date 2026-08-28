'use client';

import { useEffect, useState } from 'react';
import { abortTurn, probeEndpoint, submitTurn } from '@/client/actions';
import { connect } from '@/client/store';
import type { TurnView } from '@/client/store';
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
/** The live turn, as the store mirrored it: every delta so far, and how it ended. */
export const TURN_ATTRIBUTE = 'data-turn';
/** What the browser check types into and clicks. */
export const PROBE_INPUT_ID = 'probe-url';
export const PROBE_BUTTON_ID = 'probe-go';
export const MODEL_INPUT_ID = 'turn-model';
export const TURN_INPUT_ID = 'turn-text';
export const TURN_BUTTON_ID = 'turn-go';
export const STOP_BUTTON_ID = 'turn-stop';

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
      <Published attribute={ENGINE_ATTRIBUTE} value={engine.boot.kind === 'starting' ? '' : JSON.stringify(engine.boot)} />
      <Field id={PROBE_INPUT_ID} label="endpoint" value={url} onChange={setUrl} />
      <button id={PROBE_BUTTON_ID} type="button" onClick={probe}>
        Probe
      </button>
      <Published attribute={PROBE_ATTRIBUTE} value={engine.probe === null ? '' : JSON.stringify(engine.probe)} />
      <Published attribute={FAILURE_ATTRIBUTE} value={engine.failure ?? ''} />
      <Composer baseUrl={url} turn={engine.turn} />
    </main>
  );
}

/**
 * Say something, and watch it come back.
 *
 * Nothing here awaits an answer, and nothing renders what an action resolved
 * with. The turn's whole visible life arrives through the store, message by
 * message — which is what makes the tokens appear as they land instead of all
 * at once at the end.
 */
function Composer({ baseUrl, turn }: { baseUrl: string; turn: TurnView | null }) {
  const [model, setModel] = useState<string>('');
  const [text, setText] = useState<string>('');
  const send = () => {
    void submitTurn(text, { baseUrl, model }).catch(() => undefined);
  };
  const stop = () => {
    void abortTurn(turn?.turnId ?? '').catch(() => undefined);
  };
  return (
    <>
      <Field id={MODEL_INPUT_ID} label="model" value={model} onChange={setModel} />
      <Field id={TURN_INPUT_ID} label="say" value={text} onChange={setText} />
      <button id={TURN_BUTTON_ID} type="button" onClick={send}>
        Send
      </button>
      <button id={STOP_BUTTON_ID} type="button" onClick={stop}>
        Stop
      </button>
      {/* The deltas, concatenated, as they land — never the answer from
          turn/done. A page that rendered the answer would look the same
          whether the engine streamed or buffered, which is the whole
          increment. */}
      <Published attribute={TURN_ATTRIBUTE} value={turn === null ? '' : JSON.stringify(turn)} text={turn?.text ?? ''} />
    </>
  );
}

/**
 * One piece of the store, in the DOM twice: as an attribute a browser check
 * reads, and as text a person reads. The attribute is empty rather than
 * `"null"` when there is nothing yet, so "not arrived" and "arrived empty" stay
 * different states to anything polling it.
 */
function Published({ attribute, value, text }: { attribute: string; value: string; text?: string }) {
  return <pre {...{ [attribute]: value }}>{text ?? value}</pre>;
}

/** A labelled input. Three of them, which is why it is a component and not three copies. */
function Field({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
    </>
  );
}
