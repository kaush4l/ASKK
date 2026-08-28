// REALM: host
/**
 * A turn, in a real browser, against the built export served at a subpath —
 * PLAN 3.3's acceptance, and the sentence 3.1 could not prove.
 *
 *   bun scripts/serve-subpath.ts out &
 *   bun scripts/smoke.ts http://localhost:4599/ASKK/
 *
 * It takes a URL and not a directory, and §8.4 rule 1 is executed rather than
 * assumed: it **runs `verify-export.ts` against the same URL as its first step
 * and stops if it fails**, so there is no path to a behavioural pass that
 * skipped the artifact check, and no second copy of the artifact assertions
 * here. §8.4's 404 control comes with it.
 *
 * **The streaming assertion is causal, and that is the whole design of this
 * file.** This project has measured that a chunk-count assertion stays green
 * when streaming collapses into buffer-then-chop: the count is identical either
 * way. So the model server below **holds its second frame back until the page's
 * own DOM has shown the first one**. If any layer between the socket and the
 * `<pre>` — the transport, the resident, `postMessage`, the store, React —
 * batches, that first frame never renders, the second is never sent, and this
 * check fails on its deadline. Nothing here can pass by counting.
 *
 * **It also measures the sentence PLAN 3.1 deferred**: the main thread stays
 * responsive during a turn. A counter is installed in the page and ticked from
 * a timer before the turn starts, and it must have advanced while the model was
 * holding the stream open. Its limit, stated because a measurement whose reach
 * is not stated gets read as more than it is: it can see a **blocked** main
 * thread — a synchronous wait, an engine that fell back onto this thread — and
 * it cannot see a main thread that is merely busy. The strong version needs a
 * turn that costs CPU, and nothing in this build spends any.
 *
 * **The model is local, and only local.** It is an OpenAI-compatible endpoint
 * this script serves itself, on its own port, cross-origin to the page. The
 * deployed site has no such endpoint and never will, so unlike
 * `verify-export.ts` and `verify-worker.ts` this check runs against the local
 * server alone. §8.4's rule is that a failure-status assertion is authoritative
 * only on the deployed host; nothing asserted here is a failure status.
 */

import {
  ENGINE_ATTRIBUTE,
  FAILURE_ATTRIBUTE,
  MODEL_INPUT_ID,
  PROBE_INPUT_ID,
  STOP_BUTTON_ID,
  TURN_ATTRIBUTE,
  TURN_BUTTON_ID,
  TURN_INPUT_ID,
} from '../src/app/page';
import { requireServerCanFail } from './server-can-fail';

const target = process.argv[2];
if (!target) {
  console.error('usage: bun scripts/smoke.ts <url>');
  process.exit(2);
}

/** How long the document and the engine get. */
const READY_BUDGET_MS = 60_000;
/** How long one step of a turn gets: a click, a socket, a frame, a render. */
const STEP_BUDGET_MS = 20_000;
/** How long the model holds frame two after the page has shown frame one. */
const HOLD_MS = 1_500;

const CHUNKS = ['The answer ', 'is streaming.'] as const;
const consoleErrors: string[] = [];

/** Frame one goes at once; frame two waits for `release`, which the page's own DOM decides. */
const gate = Promise.withResolvers<void>();
let promptBody = '';

const model = Bun.serve({
  port: 0,
  fetch: async (request) => {
    // The page is on another port, so this is a real cross-origin call and the
    // browser preflights it. A model server that refused would look exactly
    // like an engine that never sent anything.
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type', 'Access-Control-Allow-Methods': 'POST,OPTIONS' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    promptBody = await request.text();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(frame(CHUNKS[0] ?? '')));
        await gate.promise;
        controller.enqueue(encoder.encode(frame(CHUNKS[1] ?? '')));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return new Response(stream, { headers: { ...cors, 'Content-Type': 'text/event-stream' } });
  },
});
const modelUrl = `http://127.0.0.1:${model.port}/v1`;

function frame(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

const view = new Bun.WebView({
  headless: true,
  width: 1440,
  height: 900,
  console: (type, ...args) => {
    if (type === 'error') consoleErrors.push(args.map(String).join(' '));
  },
});

async function until(expression: string, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  let interval = 25;
  while (Date.now() < deadline) {
    try {
      if (await view.evaluate(`!!(${expression})`)) return true;
    } catch {
      // the page is not answering yet
    }
    await Bun.sleep(interval);
    interval = Math.min(interval * 2, 500);
  }
  return false;
}

/** Reads an attribute this page publishes a piece of the store into. */
function read(attribute: string): string {
  const selector = JSON.stringify(`[${attribute}]`);
  return `(document.querySelector(${selector}) ? document.querySelector(${selector}).getAttribute(${JSON.stringify(attribute)}) : '')`;
}

/**
 * Types into a React-controlled input. The native value setter plus a bubbling
 * `input` event is what React's synthetic layer reads; assigning `.value` alone
 * leaves React's state on the old value and the click sends the empty string.
 */
function type(id: string, value: string): string {
  return `(() => {
    const input = document.getElementById(${JSON.stringify(id)});
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`;
}

const click = (id: string): string => `(document.getElementById(${JSON.stringify(id)}).click(), true)`;

/** A counter the main thread ticks from a timer. If it stops, the main thread stopped. */
const INSTALL_TICKER = '(() => { window.__ticks = 0; setInterval(() => { window.__ticks += 1; }, 20); return true; })()';
/** The timer's own period. */
const TICK_MS = 20;
/**
 * Half the ideal rate. A margin, not a measurement: a headless browser
 * throttles and coalesces timers, and a threshold at the ideal rate is a check
 * that goes red on a loaded machine and then gets loosened until it means
 * nothing.
 */
const TICK_TOLERANCE = 2;

/**
 * PLAN 3.1's deferred sentence, measured over the **whole** turn.
 *
 * The window matters and the first version of this got it wrong: it sampled a
 * window that began after the DOM had already been read, so a main thread
 * blocked *inside a render* had always finished blocking before the sampling
 * started, and a planted three-second block passed. That version was deleted
 * rather than patched. This one counts from the click to the terminal, which
 * is the only window that contains everything the turn does.
 *
 * **What it can and cannot see.** It sees a *blocked* main thread — a
 * synchronous wait, a render that spins, an engine that ended up on this
 * thread. It cannot see one that is merely busy, and this build spends no CPU
 * on a turn at all: the strong version of the claim needs work worth measuring,
 * and it arrives with the first tool that does any.
 */
function responsiveness(ticksNow: number, ticksAtStart: number, elapsedMs: number): string[] {
  const ticked = ticksNow - ticksAtStart;
  const floor = Math.floor(elapsedMs / (TICK_MS * TICK_TOLERANCE));
  console.log(`  main thread ticked ${ticked} time(s) across ${elapsedMs}ms of turn — a free thread ticks about ${Math.floor(elapsedMs / TICK_MS)}`);
  if (ticked >= floor) return [];
  return [`the main thread ticked ${ticked} times across ${elapsedMs}ms of an open turn, and ${floor} is the floor — it was blocked while the engine was working, and PLAN 3.1's "the main thread stays responsive during a long turn" is false in this build`];
}

async function turnAssertions(): Promise<string[]> {
  const found: string[] = [];
  await view.evaluate(INSTALL_TICKER);
  await view.evaluate(type(PROBE_INPUT_ID, modelUrl));
  await view.evaluate(type(MODEL_INPUT_ID, 'smoke-model'));
  await view.evaluate(type(TURN_INPUT_ID, 'stream me a sentence'));
  await view.evaluate(click(TURN_BUTTON_ID));
  const openedAt = Date.now();
  const ticksAtStart = (await view.evaluate('window.__ticks')) as number;

  const first = JSON.stringify(CHUNKS[0]);
  if (!(await until(`JSON.parse(${read(TURN_ATTRIBUTE)} || '{}').text === ${first}`, STEP_BUDGET_MS))) {
    found.push(`the page never rendered the first token alone in ${STEP_BUDGET_MS / 1000}s, while the model held the second one back. Either nothing reached the model, or the engine is buffering the stream and rendering it whole — which is the defect this check exists for`);
    gate.resolve();
    return found;
  }
  console.log(`  first token rendered alone: ${(await view.evaluate(read(TURN_ATTRIBUTE))) as string}`);
  await Bun.sleep(HOLD_MS);
  gate.resolve();

  const whole = JSON.stringify(CHUNKS.join(''));
  if (!(await until(`JSON.parse(${read(TURN_ATTRIBUTE)} || '{}').status === 'done'`, STEP_BUDGET_MS))) {
    found.push(`the turn never reached a terminal in ${STEP_BUDGET_MS / 1000}s after the model finished — turn/done did not cross, or the store did not write it`);
    return found;
  }
  const turn = JSON.parse((await view.evaluate(read(TURN_ATTRIBUTE))) as string) as { text?: string; deltas?: number; ms?: number };
  console.log(`  turn/done: ${JSON.stringify(turn)}`);
  found.push(...responsiveness((await view.evaluate('window.__ticks')) as number, ticksAtStart, Date.now() - openedAt));
  if (JSON.stringify(turn.text) !== whole) found.push(`the page shows ${JSON.stringify(turn.text)} and the model sent ${whole} — the deltas did not concatenate to the reply`);
  if (turn.deltas !== CHUNKS.length) found.push(`the page counted ${turn.deltas} delta(s) and the model sent ${CHUNKS.length} — a delta was lost or merged crossing the boundary`);
  if (typeof turn.ms !== 'number') found.push('turn/done carried no numeric ms — the payload did not survive the realm crossing intact (§6.4)');
  return found;
}

/** What left the tab: the assembled prompt, built in the worker, carrying the person's words. */
function promptAssertions(): string[] {
  if (promptBody === '') return ['the model was never called — nothing left the tab at all'];
  const body = JSON.parse(promptBody) as { messages?: { content?: string }[] };
  const prompt = body.messages?.[0]?.content ?? '';
  console.log(`  the model was sent ${prompt.length} byte(s) of assembled prompt`);
  const missing = ['You are a helpful assistant.', '[USER]: stream me a sentence', '[ASSISTANT]:'].filter((part) => !prompt.includes(part));
  return missing.map((part) => `the prompt the model received does not contain ${JSON.stringify(part)} — the worker did not assemble it from the agent and the transcript`);
}

/** A stop for a turn that is over is refused by name (§6.6), and the refusal reaches the page. */
async function staleAbortAssertions(): Promise<string[]> {
  await view.evaluate(click(STOP_BUTTON_ID));
  if (!(await until(`${read(FAILURE_ATTRIBUTE)}.indexOf('is running') !== -1`, STEP_BUDGET_MS))) {
    return [`stopping a turn that had already finished published no refusal in ${STEP_BUDGET_MS / 1000}s — §6.6 answers a stale turn id by name, never with silence`];
  }
  console.log(`  stale turn/abort: ${(await view.evaluate(read(FAILURE_ATTRIBUTE))) as string}`);
  return [];
}

// §8.4 rule 1, as a process and not a promise: the artifact check, on this URL,
// before anything below it runs. It carries the 404 control with it.
if ((await Bun.spawn(['bun', 'scripts/verify-export.ts', target], { stdout: 'inherit', stderr: 'inherit' }).exited) !== 0) {
  console.log(`\nABORT ${target}`);
  console.log('  - verify-export.ts failed on this URL. There is no behavioural pass over an artifact that does not load (§8.4 rule 1)');
  model.stop(true);
  process.exit(1);
}
await requireServerCanFail(target);
console.log(`  model endpoint: ${modelUrl}, holding token 2 until the page renders token 1`);

const failures: string[] = [];
try {
  await view.navigate(target);
  if (!(await until('document.readyState === "complete"', READY_BUDGET_MS))) {
    failures.push(`the document never loaded in ${READY_BUDGET_MS / 1000}s — this is the browser, not the page`);
  } else if (!(await until(`JSON.parse(${read(ENGINE_ATTRIBUTE)} || '{}').kind === 'ready'`, READY_BUDGET_MS))) {
    failures.push(`the engine never reported ready in ${READY_BUDGET_MS / 1000}s — there is no resident to send a turn to`);
  } else {
    failures.push(...(await turnAssertions()));
    failures.push(...promptAssertions());
    failures.push(...(await staleAbortAssertions()));
  }
} finally {
  gate.resolve();
  view.close();
  model.stop(true);
}

for (const message of consoleErrors) console.log(`  console error: ${message}`);
const all = [...failures, ...consoleErrors.map((m) => `console error: ${m}`)];
if (all.length) {
  console.log(`\nFAIL ${target}`);
  for (const line of all) console.log(`  - ${line}`);
  process.exit(1);
}
// Explicit, because a WebView that has run a worker keeps the loop alive after
// close() and the process hangs on a PASS — a check that never returns.
console.log(`\nPASS ${target} — a person's sentence crossed into the worker, was assembled into a prompt, went to a model, and came back token by token: the first one rendered in the DOM while the second was still being withheld, and the main thread kept ticking throughout`);
process.exit(0);
