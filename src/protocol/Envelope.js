/**
 * The wire contract between the page and the backend worker.
 *
 * This module is the ONLY thing both realms import, so it must stay free of
 * dependencies and of any API that exists in one realm but not the other. It
 * touches no DOM, no IndexedDB, no React. Everything here must survive
 * structured-clone, because that is what postMessage does to it.
 */

/**
 * Every failure crosses the boundary as one of these.
 *
 * Deliberately the same strings as `core/Outcome.js`'s `Reason`, declared twice
 * so that `core/` and `protocol/` need not import each other. The Kernel can
 * therefore pass a code straight through with no translation table.
 */
export const ErrorCode = Object.freeze({
  BAD_REQUEST: 'BAD_REQUEST',
  NOT_FOUND: 'NOT_FOUND',
  UNAVAILABLE: 'UNAVAILABLE',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  NO_HANDLER: 'NO_HANDLER',
  INTERNAL: 'INTERNAL',
})

/**
 * A call from the page to the backend.
 *
 * `id` correlates the reply. It exists because postMessage is a broadcast with
 * no notion of a call: without it a second request in flight would resolve the
 * first request's promise.
 */
export class Request {
  constructor(id, method, params = {}) {
    this.id = id
    this.method = method
    this.params = params
  }

  /** Rebuild from the plain object that came through structured-clone. */
  static from(raw) {
    if (!raw || typeof raw.method !== 'string' || typeof raw.id !== 'string') {
      return null
    }
    return new Request(raw.id, raw.method, raw.params ?? {})
  }

  toJSON() {
    return { id: this.id, method: this.method, params: this.params }
  }
}

/**
 * The backend's reply.
 *
 * `notes` carries anything that was corrected or degraded on the way — a
 * substituted setting, a write that did not land, an attachment that was
 * ignored. A reply can be successful and still have something to say, which is
 * why notes are not an error channel.
 */
export class Response {
  constructor(id, ok, value = null, error = null, notes = []) {
    this.id = id
    this.ok = ok
    this.value = value
    this.error = error
    this.notes = notes
  }

  static ok(id, value, notes = []) {
    return new Response(id, true, value, null, notes)
  }

  static fail(id, code, message, { hint = '', notes = [] } = {}) {
    return new Response(id, false, null, { code, message, hint }, notes)
  }

  /** Build directly from a core Outcome — the Kernel's only job at the edge. */
  static from(id, outcome) {
    return outcome.ok
      ? Response.ok(id, outcome.value, outcome.notes)
      : new Response(id, false, outcome.value, outcome.failure.toJSON(), outcome.notes)
  }

  toJSON() {
    return { id: this.id, ok: this.ok, value: this.value, error: this.error, notes: this.notes }
  }
}

/**
 * Something a call has to say before it has an answer.
 *
 * A request/response pair can only speak once, at the end — which is no use
 * while a model is producing text token by token, or for showing the prompt
 * that was assembled *before* it was sent. An Event carries the id of the call
 * it belongs to, so the page can attribute it without a second channel and
 * without a subscription to unwind when the call finishes.
 *
 * Events are advisory: a caller that ignores them still gets the same Response.
 * Nothing in the flow depends on one arriving.
 */
export class Event {
  constructor(id, name, data = null) {
    this.type = 'event'
    this.id = id
    this.name = name
    this.data = data
  }

  toJSON() {
    return { type: 'event', id: this.id, name: this.name, data: this.data }
  }
}

/**
 * The one method name the protocol owns.
 *
 * Nothing here is a route registry and no route is discovered at runtime: both
 * realms spell every name out. The backend spells them by existing — `register`
 * in `backend/Kernel.js` walks a service's own methods, so `files.read` is on
 * the wire because `FilesService` has a `read` — and a component spells the
 * same string back as a literal. This one name has no service to take it from.
 * Cancelling is the front door's own business, registered out of this constant,
 * so without it the two realms would be agreeing on a string that nothing owns.
 *
 * It is also the only call whose parameter is another call: the page has to
 * name a request that is still running.
 *
 * It is a second Request rather than a field on the first because an
 * AbortSignal does not survive structured-clone: a signal cannot cross, so what
 * crosses is an id, and the backend holds the signal on its own side. That is
 * the same trick `Event` uses to say which call it belongs to, run backwards.
 */
export const CANCEL = 'calls.cancel'

/** The event names both realms agree on. */
export const EventName = Object.freeze({
  // The complete prompt, exactly as it was handed to the model.
  PROMPT: 'prompt',
  // One chunk of the model's reply, as it arrives.
  DELTA: 'delta',
  // A finished pass of the loop, with its parsed response.
  STEP: 'step',
  // What the call actually cost, counted by the provider. The only number in
  // this app that is measured rather than estimated.
  USAGE: 'usage',
  // Bytes of a model arriving. A first load is minutes, not seconds, and a
  // progress bar is the difference between a slow download and a dead app.
  PROGRESS: 'progress',
  // The transcript of what has been said so far, revised. Live speech is the
  // same problem as a streaming reply — something to say before there is an
  // answer — so it is the same message, not a second mechanism.
  PARTIAL: 'partial',
  // A sub-agent, part-way through the question it was handed. It rides the
  // PARENT call's id, because that is the call the user is waiting on: a
  // delegated run has no request of its own on this wire, and inventing one
  // would make the page correlate two ids for one thing it is watching.
  DELEGATE: 'delegate',
})

// There is no error class here any more. Failures are values: a handler
// returns an Outcome and the Kernel turns it into a Response. Nothing in this
// application signals a failure by throwing.
