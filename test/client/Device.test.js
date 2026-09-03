import { describe, expect, test } from 'bun:test'
import {
  announce,
  copy,
  keepAwake,
  keyboardInset,
  room,
  share,
  watchOnline,
} from '../../src/client/Device.js'

/**
 * The browser's own facilities, and what happens when they are not there.
 *
 * Every function in `client/Device.js` is a capability this app had none of and
 * every one of them is optional in some browser that will open this page:
 * Safari has no Wake Lock on iOS below 16.4, Firefox has no `navigator.share`
 * outside Android, a page served over plain http has no `navigator.clipboard`
 * at all. So the contract under test is not "it works" — it is that a missing
 * API is a NOTE and never a thrown error, because the one thing that must not
 * happen is a transcript that stops rendering because a copy button reached for
 * something the browser does not have.
 *
 * The scope is injected rather than patched onto `globalThis`: these tests run
 * under `bun`, where several of these APIs are genuinely absent, and a test
 * that patched the real global would leave the next file in the run looking at
 * a browser that does not exist.
 */

/** A browser with none of it. */
const bare = () => ({})

describe('keepAwake', () => {
  test('holds a screen lock and releases it once', async () => {
    let released = 0
    const sentinel = {
      release: async () => {
        released += 1
      },
      addEventListener() {},
    }
    const asked = []
    const scope = {
      navigator: {
        wakeLock: {
          request: async (kind) => {
            asked.push(kind)
            return sentinel
          },
        },
      },
      document: { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' },
    }

    const held = await keepAwake(scope)
    expect(held.ok).toBe(true)
    expect(asked).toEqual(['screen'])

    await held.release()
    await held.release()
    expect(released).toBe(1)
  })

  test('a browser without wake lock says so and still hands back a release', async () => {
    const held = await keepAwake(bare())
    expect(held.ok).toBe(false)
    expect(held.note).toContain('screen')
    await held.release()
  })

  test('a refused lock is a note, not a throw', async () => {
    const scope = {
      navigator: {
        wakeLock: {
          request: async () => {
            throw new Error('denied by user agent')
          },
        },
      },
      document: { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' },
    }
    const held = await keepAwake(scope)
    expect(held.ok).toBe(false)
    expect(held.note).toContain('denied by user agent')
  })
})

describe('announce', () => {
  test('speaks only when the tab is hidden and permission is already granted', async () => {
    const made = []
    class FakeNotification {
      static permission = 'granted'
      static async requestPermission() {
        return 'granted'
      }
      constructor(title, options) {
        made.push([title, options])
      }
    }
    const scope = { Notification: FakeNotification, document: { visibilityState: 'hidden' } }

    expect((await announce({ title: 'researcher has an answer' }, scope)).ok).toBe(true)
    expect(made).toHaveLength(1)
    expect(made[0][0]).toBe('researcher has an answer')

    // Looking at the page already: a notification would be telling someone
    // something they can see.
    scope.document.visibilityState = 'visible'
    const skipped = await announce({ title: 'again' }, scope)
    expect(skipped.ok).toBe(false)
    expect(made).toHaveLength(1)
  })

  test('never asks for permission on its own', async () => {
    let asked = 0
    // A constructible stand-in rather than a static-only class: the code under
    // test reads `permission` off the constructor and would happily call this
    // one, and biome refuses a class with nothing but statics.
    function FakeNotification() {
      throw new Error('a notification was constructed without permission')
    }
    FakeNotification.permission = 'default'
    FakeNotification.requestPermission = async () => {
      asked += 1
      return 'granted'
    }
    const scope = { Notification: FakeNotification, document: { visibilityState: 'hidden' } }
    const result = await announce({ title: 'hello' }, scope)
    expect(result.ok).toBe(false)
    expect(asked).toBe(0)
  })

  test('a browser with no Notification is a note', async () => {
    const result = await announce({ title: 'hello' }, { document: { visibilityState: 'hidden' } })
    expect(result.ok).toBe(false)
    expect(result.note).toContain('notification')
  })
})

describe('copy', () => {
  test('writes to the clipboard', async () => {
    const written = []
    const scope = { navigator: { clipboard: { writeText: async (text) => written.push(text) } } }
    expect((await copy('hello', scope)).ok).toBe(true)
    expect(written).toEqual(['hello'])
  })

  test('a refused clipboard says what to do, and never quotes the platform', async () => {
    // The browser's own message here is a DOM exception naming a method
    // signature — "Failed to execute 'writeText' on 'Clipboard': Write
    // permission denied." — and a reviewer met that string verbatim in a
    // toast, in front of somebody who had pressed a button called copy.
    const refused = async () => {
      const err = new Error(
        "Failed to execute 'writeText' on 'Clipboard': Write permission denied.",
      )
      err.name = 'NotAllowedError'
      throw err
    }
    const denied = await copy('hello', { navigator: { clipboard: { writeText: refused } } })
    expect(denied.ok).toBe(false)
    expect(denied.note).toContain('clipboard')
    expect(denied.note).not.toContain('Failed to execute')
    expect(denied.note).not.toContain('writeText')

    // A cause nobody here recognises says what happened and invents no remedy.
    const other = await copy('hello', {
      navigator: {
        clipboard: {
          writeText: async () => {
            throw new Error('the disk is on fire')
          },
        },
      },
    })
    expect(other.ok).toBe(false)
    expect(other.note).toBe('the text could not be copied')
  })

  test('no clipboard at all is a note', async () => {
    expect((await copy('hello', bare())).ok).toBe(false)
  })
})

describe('share', () => {
  test('hands the payload to the browser', async () => {
    const sent = []
    const scope = { navigator: { share: async (payload) => sent.push(payload) } }
    expect((await share({ title: 'ASKK', text: 'a reply' }, scope)).ok).toBe(true)
    expect(sent).toEqual([{ title: 'ASKK', text: 'a reply' }])
  })

  test('a cancelled share is not a failure to report', async () => {
    const scope = {
      navigator: {
        share: async () => {
          const err = new Error('share canceled')
          err.name = 'AbortError'
          throw err
        },
      },
    }
    const result = await share({ text: 'a reply' }, scope)
    expect(result.ok).toBe(false)
    expect(result.note).toBe('')
  })
})

describe('room', () => {
  test('reports what the origin has used and may use', async () => {
    const scope = { navigator: { storage: { estimate: async () => ({ usage: 12, quota: 100 }) } } }
    expect(await room(scope)).toEqual({ ok: true, usage: 12, quota: 100, note: '' })
  })

  test('no estimate is not a number of zero', async () => {
    const measured = await room(bare())
    expect(measured.ok).toBe(false)
    expect(measured.usage).toBe(null)
  })
})

describe('watchOnline', () => {
  test('reports the current state at once and on every change', () => {
    const listeners = new Map()
    const scope = {
      navigator: { onLine: true },
      addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: (name) => listeners.delete(name),
    }
    const seen = []
    const stop = watchOnline((state) => seen.push(state), scope)
    expect(seen).toEqual([true])

    scope.navigator.onLine = false
    listeners.get('offline')()
    expect(seen).toEqual([true, false])

    stop()
    expect(listeners.size).toBe(0)
  })
})

describe('keyboardInset', () => {
  test('measures how much of the window the keyboard covers', () => {
    const listeners = new Map()
    const viewport = {
      height: 500,
      offsetTop: 0,
      addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: (name) => listeners.delete(name),
    }
    const scope = { visualViewport: viewport, innerHeight: 800 }
    const seen = []
    const stop = keyboardInset((px) => seen.push(px), scope)
    expect(seen).toEqual([300])

    viewport.height = 800
    listeners.get('resize')()
    expect(seen).toEqual([300, 0])

    stop()
    expect(listeners.size).toBe(0)
  })

  test('a browser with no visual viewport reports no inset and unsubscribes cleanly', () => {
    const seen = []
    const stop = keyboardInset((px) => seen.push(px), bare())
    expect(seen).toEqual([0])
    stop()
  })
})
