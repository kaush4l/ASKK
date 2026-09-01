/**
 * A real browser, driven over the DevTools protocol, for the two checks that
 * cannot be run any other way.
 *
 * It exists because there are now two of them. `scripts/smoke.js` boots the
 * export and makes three realms answer; `scripts/deploy-check.js` opens the
 * deploy directory over a header-free host and drives the agent loop through
 * it. Both need the same hundred and forty lines — find a Chromium, launch it
 * headless into a throwaway profile, win the race for the port file, dial the
 * socket, number the requests, attach to a tab — and none of that hundred and
 * forty lines is about either check. A second copy of it would be a second
 * place for the profile leak and the port-file race to be fixed.
 *
 * What it deliberately does NOT own: the server, the assertions, the teardown
 * order, and the signal handlers. Each caller has its own host to stop and its
 * own idea of what a failure is, so this hands back a `close` and takes a
 * `whenLost` to call when it runs out of patience of its own.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Where a Chromium usually is, when nobody has said. */
const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]

/**
 * The browser this run should use, or a sentence saying why there is none.
 *
 * An explicit `CHROME` that is not there is an error, not a hint to look
 * elsewhere. Falling back would run the check against a browser other than the
 * one that was asked for and say nothing about it, which is how a green result
 * stops meaning what its reader thinks.
 */
export function findChrome() {
  const named = process.env.CHROME
  if (named)
    return existsSync(named)
      ? { path: named }
      : { problem: `CHROME is set to ${named}, and there is nothing there` }

  const found = CHROME_CANDIDATES.find((path) => existsSync(path))
  return found
    ? { path: found }
    : {
        problem: 'no browser found',
        details: [
          'This step boots a page in a real browser, because that is the only way',
          'to see a worker that cannot start. Install Chrome, or set CHROME to a',
          'Chromium binary.',
        ],
      }
}

/**
 * Launch a browser, attach to a blank tab, and hand back the two calls a check
 * actually makes.
 *
 * @param {{chromePath: string, whenLost: (message: string, details?: string[]) => Promise<void>,
 *   onEvent?: (message: object, send: Function) => void}} options
 *   `whenLost` is called when the browser stops answering — it is the caller's
 *   failure path, because only the caller knows what else has to be torn down.
 *   `onEvent` sees every protocol event this module does not consume, which is
 *   how a caller adds `Network` or `Target` handling without this file knowing
 *   either domain exists.
 */
export async function attachBrowser({ chromePath, whenLost, onEvent = null }) {
  const profile = mkdtempSync(join(tmpdir(), 'askk-browser-'))
  const chrome = Bun.spawn(
    [
      chromePath,
      '--headless=new',
      // Port 0 means the OS picks one, so two agents checking at once do not
      // collide. Chrome writes the port it took into the profile directory.
      '--remote-debugging-port=0',
      // Fresh and discarded, so nothing needs suppressing. Do not add
      // `--disable-gpu` here: measured, it cost 0.93 s of a 1.8 s step.
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdout: 'ignore', stderr: 'ignore' },
  )

  /**
   * Everything the browser reported that a user would call broken.
   *
   * Collected rather than thrown on, so a failing run names every problem at
   * once instead of the first one. A worker that fails to parse shows up here
   * as a `worker:` entry — that is the channel this whole mechanism exists for.
   */
  const problems = []

  let socket = null
  const close = async () => {
    socket?.close()
    // SIGKILL and then WAIT. Measured: on SIGTERM Chrome writes its profile out
    // while shutting down, so an immediate `rmSync` deletes a directory the
    // browser then recreates — 14 runs left 14 profiles behind, and this machine
    // had 167 of them by the time anyone counted.
    chrome.kill('SIGKILL')
    await chrome.exited
    rmSync(profile, { recursive: true, force: true })
  }

  /**
   * The message that ended this browser, or null while it is still answering.
   *
   * Everything after a loss is a measurement of nothing, so the module stops
   * pretending it has a browser. It CLOSES FIRST and calls `whenLost` after,
   * because `whenLost` is the caller's failure path and the contract explicitly
   * permits it to return — measured: with a `whenLost` that returns, this file
   * announced four losses and then handed back a live session, leaving the
   * browser tree and its profile behind. That leak is the one thing this file
   * says it exists to own.
   */
  let lost = null
  const lose = async (message) => {
    if (lost) return
    lost = message
    await close()
    await whenLost(message)
  }

  // Polled until the file PARSES, not until it exists. Chrome creates this file
  // and then writes it, so a read that wins that race returns an empty string,
  // `port` is `undefined`, and `new WebSocket('ws://127.0.0.1:undefined…')`
  // throws — at the top level of a module, above every catch, so the teardown
  // never runs and the browser tree and its profile are orphaned. Observed once
  // in roughly ten runs: seven Chrome processes still holding their profile 70 s
  // later.
  const portFile = join(profile, 'DevToolsActivePort')
  const launched = Date.now()
  let port = null
  let endpoint = null
  while (Date.now() - launched < 20000) {
    const [p, e] = existsSync(portFile) ? readFileSync(portFile, 'utf8').trim().split('\n') : []
    if (p && e) {
      port = p
      endpoint = e
      break
    }
    await Bun.sleep(20)
  }
  // Each of these THROWS after losing, rather than falling through. A caller
  // whose `whenLost` exits never reaches the throw; a caller whose `whenLost`
  // returns gets a rejected `attachBrowser` instead of a half-built browser it
  // would go on to drive.
  if (!port) {
    await lose('the browser did not report a debugger port within 20s')
    throw new Error(lost)
  }

  try {
    socket = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`)
  } catch (cause) {
    await lose(`the browser wrote a debugger endpoint this cannot dial: ${cause.message}`)
    throw new Error(lost)
  }
  await new Promise((resolve) => {
    socket.addEventListener('open', resolve)
    // Not rejected: a rejection here reaches the top level of a module with
    // nothing above it to catch, so the process would die around the teardown.
    // `lose` tears the browser down before it says anything, so there is nothing
    // left to orphan.
    socket.addEventListener('error', () => lose('the browser refused a debugger connection'))
  })

  let seq = 0
  const pending = new Map()

  /**
   * One request, one reply, and a ceiling on the wait.
   *
   * The realm waits a caller puts above this have their own ceilings; the
   * protocol between them had none, so the single failure that could hang the
   * gate for ever was a browser that stopped answering. Ten seconds is far
   * longer than any call takes and far shorter than an agent's patience.
   */
  const send = (method, params, sessionId, ceilingMs = 10000) =>
    new Promise((resolve, reject) => {
      if (lost) return reject(new Error(`the browser was lost: ${lost}`))
      const id = ++seq
      const ceiling = setTimeout(() => {
        // NOT resolved, and that is the point. A timed-out call that resolved
        // later let the run carry on against a browser this file had already
        // announced was gone, with `undefined` reaching an assertion as if it
        // were an answer.
        pending.delete(id)
        lose(`the browser never answered ${method}`).then(() =>
          reject(new Error(`the browser never answered ${method}`)),
        )
      }, ceilingMs)
      pending.set(id, (message) => {
        clearTimeout(ceiling)
        resolve(message)
      })
      socket.send(JSON.stringify({ id, method, params, sessionId }))
    })

  // DEFINED ABOVE THE LISTENER, and that ordering is the fix for a real defect
  // rather than a style choice. A caller's `onEvent` needs `send` — it is how a
  // worker target gets attached — and when `send` was declared after this
  // listener, the first event to arrive hit the temporal dead zone and threw
  // INSIDE a WebSocket handler, where nothing was waiting to catch it. The run
  // printed `Cannot access 'send' before initialization` to stderr and exited
  // zero. `send` is passed to `onEvent` for the same reason: so a caller never
  // has to reach a binding it cannot know is initialised yet.
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id) {
      pending.get(message.id)?.(message)
      pending.delete(message.id)
      return
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const { exception, text } = message.params.exceptionDetails
      problems.push(`page: ${exception?.description ?? text}`)
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      const { source, text, url } = message.params.entry
      problems.push(`${source}: ${text}${url ? ` <${url}>` : ''}`)
    }
    // Recorded, never lost. A throw in here has nowhere to go — no caller is
    // awaiting a WebSocket listener — so an instrument that broke would
    // otherwise print to stderr and let the check pass. It goes in the same
    // list the browser's own faults go in, which every caller already reads.
    try {
      onEvent?.(message, send)
    } catch (err) {
      problems.push(`driver: onEvent threw on ${message.method}: ${err?.message ?? err}`)
    }
  })

  /**
   * Evaluate an expression in a realm, and REPORT a throw rather than swallow it.
   *
   * There used to be two of these — this one, and a stricter copy in
   * `deploy-check.js` whose comment argued that a page which throws inside an
   * evaluation must stop the run instead of answering `undefined` and letting a
   * later assertion blame the wrong thing. That argument holds for every caller,
   * and the caller that did not have it is the gate: a throw inside `smoke.js`'s
   * sandbox expression reported `available=undefined`, which names the wrong
   * thing entirely. A shared helper one of two callers must not use is a trap
   * with a comment on it, so there is one, and it puts the throw in the list
   * every caller already reads.
   */
  const evaluate = async (expression, sessionId, awaitPromise = false, ceilingMs) => {
    const reply = await send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise },
      sessionId,
      ceilingMs,
    )
    if (reply.result?.exceptionDetails)
      problems.push(`page: ${reply.result.exceptionDetails.exception?.description}`)
    return reply.result?.result?.value
  }

  const { result: target } = await send('Target.createTarget', { url: 'about:blank' })
  const { result: attached } = await send('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true,
  })
  const session = attached.sessionId
  await send('Runtime.enable', {}, session)
  await send('Log.enable', {}, session)

  return { session, send, evaluate, problems, close }
}
