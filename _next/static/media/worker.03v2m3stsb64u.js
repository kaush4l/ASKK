/**
 * Worker entry point — the backend's only realm.
 *
 * Nothing in `src/backend/` is imported by the page: the boundary is enforced
 * by the realm, not by discipline. A direct import from a component would fail
 * at runtime rather than quietly bypassing the protocol.
 *
 * Realm capability is decided positionally, by this file's location, never by
 * interrogating the environment. `typeof window` is folded to a constant by the
 * bundler, so a runtime check for it is not a runtime check at all.
 */

import { ErrorCode, Event, Request, Response } from '../protocol/Envelope.js'
import { buildKernel } from './composition.js'

// Built before the first message is answered. Requests that arrive during
// boot are queued by the browser and delivered once this listener attaches.
const booted = buildKernel()

self.addEventListener('message', async (event) => {
  const { kernel } = await booted
  const request = Request.from(event.data)
  if (!request) {
    // No id means no way to correlate a reply, so this cannot be answered as a
    // failed call — only reported.
    self.postMessage(Response.fail('unknown', ErrorCode.BAD_REQUEST, 'malformed request').toJSON())
    return
  }
  // Events are addressed with the request's own id, so the page can attribute
  // them without a subscription to set up and tear down. Emitting is
  // best-effort: a value that cannot be cloned must not take down the call it
  // was only describing.
  const emit = (name, data) => {
    try {
      self.postMessage(new Event(request.id, name, data).toJSON())
    } catch {}
  }

  const response = await kernel.handle(request, emit)
  self.postMessage(response.toJSON())
})

// Announced once the routes exist, so the page can prove the backend booted
// rather than inferring it from the first request happening to succeed. The
// notes say whether persistence is real, which the user is entitled to know
// before they type anything worth keeping.
booted.then(({ kernel, notes, persistent }) => {
  self.postMessage({ type: 'ready', methods: kernel.methods, notes, persistent })
})
