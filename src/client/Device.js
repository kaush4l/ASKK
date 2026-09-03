/**
 * The browser's own facilities, asked for safely.
 *
 * Everything here is a capability the page can use and cannot rely on. Wake
 * Lock is absent on iOS below 16.4; `navigator.share` exists on Safari and
 * Android and not on desktop Firefox; `navigator.clipboard` does not exist at
 * all outside a secure context, which includes a colleague opening this build
 * over plain http on a LAN address.
 *
 * So the six functions that DO something answer the same shape — `{ok, note}`
 * — and a browser that cannot do the thing produces a sentence rather than an
 * exception. A reply that failed to copy must not take the transcript down with
 * it. The two that SUBSCRIBE — `watchOnline` and `keyboardInset` — answer an
 * unsubscribe function instead, and where the API is missing they report the
 * harmless state once (online, no keyboard) and hand back a no-op: there is
 * nothing a person could do about either, so there is nothing to say.
 *
 * `scope` is the realm, injected. It defaults to `globalThis` and is a
 * parameter so these can be tested under `bun`, where half of them genuinely do
 * not exist — patching the real global would leave every later test looking at
 * a browser that is not there.
 */

/** Whatever this realm calls its navigator, or an empty stand-in. */
const nav = (scope) => scope?.navigator ?? {}

/**
 * Keep the screen on for as long as the returned handle is held.
 *
 * A turn here can be minutes — a 50 MB guest arriving, a model downloading into
 * the tab, a sub-agent reading pages — and a phone that sleeps mid-run suspends
 * the timers the run is made of. The lock is re-taken when the tab comes back
 * to the foreground, because the browser drops it whenever the document is
 * hidden and never tells the page it did.
 *
 * @returns {Promise<{ok: boolean, note: string, release: () => Promise<void>}>}
 */
export async function keepAwake(scope = globalThis) {
  const wakeLock = nav(scope).wakeLock
  if (!wakeLock?.request)
    return {
      ok: false,
      note: 'this browser cannot hold the screen awake, so a long run may be suspended when the screen turns off',
      release: async () => {},
    }

  let sentinel = null
  let done = false

  const take = async () => {
    if (done) return null
    try {
      return await wakeLock.request('screen')
    } catch (err) {
      return { problem: err?.message ?? String(err) }
    }
  }

  const first = await take()
  if (first?.problem)
    return {
      ok: false,
      note: `the screen lock was refused: ${first.problem}`,
      release: async () => {},
    }
  sentinel = first

  // Re-taken on return to the foreground. Without this the lock is held for
  // exactly as long as nobody switches app, which is the case it is for.
  const onVisible = async () => {
    if (done || scope.document?.visibilityState !== 'visible') return
    const again = await take()
    if (again && !again.problem) sentinel = again
  }
  scope.document?.addEventListener?.('visibilitychange', onVisible)

  return {
    ok: true,
    note: '',
    release: async () => {
      if (done) return
      done = true
      scope.document?.removeEventListener?.('visibilitychange', onVisible)
      try {
        await sentinel?.release?.()
      } catch {
        // A sentinel the browser already dropped throws on release. There is
        // nothing to do about it and nobody to tell.
      }
    },
  }
}

/**
 * Say something in the operating system, and only when it is worth saying.
 *
 * Two conditions, both deliberate. The tab must be HIDDEN — a notification for
 * something visible on screen is noise — and permission must ALREADY be
 * granted. This never prompts: a permission dialog that appears because a
 * background task finished is a dialog nobody asked for, and Chrome penalises
 * an origin that does it. Asking belongs to a control the person pressed.
 */
export async function announce({ title, body = '' }, scope = globalThis) {
  const Notify = scope?.Notification
  if (!Notify) return { ok: false, note: 'this browser has no notification permission to ask for' }
  if (scope.document?.visibilityState !== 'hidden') return { ok: false, note: '' }
  if (Notify.permission !== 'granted')
    return { ok: false, note: 'notifications are not turned on for this page' }
  try {
    new Notify(title, { body, tag: 'askk' })
    return { ok: true, note: '' }
  } catch (err) {
    return { ok: false, note: `the notification could not be shown: ${err?.message ?? err}` }
  }
}

/** Ask for permission to notify. Only ever called from something a person pressed. */
export async function askToAnnounce(scope = globalThis) {
  const Notify = scope?.Notification
  if (!Notify?.requestPermission)
    return { ok: false, note: 'this browser has no notification permission to ask for' }
  try {
    const answer = await Notify.requestPermission()
    return answer === 'granted'
      ? { ok: true, note: '' }
      : { ok: false, note: 'notifications stay off until this page is allowed to send them' }
  } catch (err) {
    return { ok: false, note: `the permission could not be asked for: ${err?.message ?? err}` }
  }
}

/** Put text on the clipboard. */
export async function copy(text, scope = globalThis) {
  const clipboard = nav(scope).clipboard
  if (!clipboard?.writeText)
    return {
      ok: false,
      note: 'this page cannot reach the clipboard — that needs https, or localhost',
    }
  try {
    await clipboard.writeText(text)
    return { ok: true, note: '' }
  } catch (err) {
    // The browser's own message is a DOM exception —
    // "Failed to execute 'writeText' on 'Clipboard': Write permission denied."
    // — and a reviewer met that string verbatim in a toast. It names a method
    // signature at somebody who pressed a button called copy. The two causes a
    // person can act on are told apart; anything else says what happened
    // without quoting the platform at them.
    const denied = err?.name === 'NotAllowedError' || /permission/i.test(err?.message ?? '')
    return {
      ok: false,
      note: denied
        ? 'the browser would not let this page write to the clipboard — copy it by hand, or allow clipboard access for this page'
        : 'the text could not be copied',
    }
  }
}

/**
 * Hand something to whatever the device shares with.
 *
 * A share the person cancelled comes back as `AbortError`, and it is reported
 * with an EMPTY note on purpose: they closed the sheet, which is not a fault
 * and putting "the share failed" on screen for it would be the app arguing with
 * a decision they just made.
 */
export async function share(payload, scope = globalThis) {
  const sheet = nav(scope).share
  if (!sheet) return { ok: false, note: 'this browser has nothing to share with' }
  try {
    await sheet.call(nav(scope), payload)
    return { ok: true, note: '' }
  } catch (err) {
    if (err?.name === 'AbortError') return { ok: false, note: '' }
    return { ok: false, note: `the share failed: ${err?.message ?? err}` }
  }
}

/**
 * How much of this origin's storage is used, and how much it may use.
 *
 * The numbers matter here more than in most apps: a conversation, a workspace
 * and a downloaded model all live in this origin, and a 50 MB guest plus a
 * quantised model is the difference between an app that works offline and one
 * the browser starts evicting. Absent is `null` and never `0` — a zero would
 * read as "nothing stored", which is a different claim from "not measurable".
 */
export async function room(scope = globalThis) {
  const estimate = nav(scope).storage?.estimate
  if (!estimate)
    return {
      ok: false,
      usage: null,
      quota: null,
      note: 'this browser will not say how much room it has',
    }
  try {
    const measured = await estimate.call(nav(scope).storage)
    return {
      ok: true,
      usage: measured?.usage ?? null,
      quota: measured?.quota ?? null,
      note: '',
    }
  } catch (err) {
    return {
      ok: false,
      usage: null,
      quota: null,
      note: `the estimate failed: ${err?.message ?? err}`,
    }
  }
}

/**
 * Watch the network, reporting the CURRENT state immediately.
 *
 * Immediately, because a subscriber that only hears about changes starts out
 * believing whatever it guessed — and a page opened on a train starts offline,
 * which is the state worth knowing about.
 */
export function watchOnline(onChange, scope = globalThis) {
  const tell = () => onChange(nav(scope).onLine !== false)
  tell()
  if (!scope?.addEventListener) return () => {}
  scope.addEventListener('online', tell)
  scope.addEventListener('offline', tell)
  return () => {
    scope.removeEventListener?.('online', tell)
    scope.removeEventListener?.('offline', tell)
  }
}

/**
 * How many pixels of the window the on-screen keyboard is covering.
 *
 * The composer sits against the bottom edge. On a phone the keyboard covers it
 * and the layout viewport does not move, so without this the thing being typed
 * into is underneath the keyboard — the single most common way a chat interface
 * is broken on a phone. `visualViewport` is the only API that reports it, and
 * `offsetTop` is included because a page scrolled by the browser's own
 * keyboard-avoidance reports the shortfall there instead.
 */
export function keyboardInset(onChange, scope = globalThis) {
  const viewport = scope?.visualViewport
  if (!viewport) {
    onChange(0)
    return () => {}
  }
  const measure = () =>
    onChange(Math.max(0, (scope.innerHeight ?? 0) - viewport.height - (viewport.offsetTop ?? 0)))
  measure()
  viewport.addEventListener('resize', measure)
  viewport.addEventListener('scroll', measure)
  return () => {
    viewport.removeEventListener('resize', measure)
    viewport.removeEventListener('scroll', measure)
  }
}
