/**
 * The speech worker — a second backend realm, for the work that is loud.
 *
 * It speaks the same envelope as `worker.js` and routes through the same
 * `Kernel`, so the page drives it with the same client and the same event
 * mechanism. What it does not share is the thread, and that is the entire
 * reason it exists: a transcription pass is a few hundred milliseconds of wasm
 * that yields to nothing, and a worker has one message loop. Behind the agent's
 * calls it would make dictation lag the speaker; in front of them it would make
 * the agent wait on the microphone.
 *
 * It has no repositories and no database. Speech settings belong to
 * `SettingsService` on the other side, are read there, and arrive here as call
 * parameters — so there is one place a setting is stored and this thread has no
 * opinion about which.
 */

import { ErrorCode, Event, Request, Response } from '../protocol/Envelope.js'
import { Kernel } from './Kernel.js'
import { SpeechService } from './services/SpeechService.js'

const kernel = new Kernel().register('speech', new SpeechService())

self.addEventListener('message', async (event) => {
  const request = Request.from(event.data)
  if (!request) {
    // No id means no way to correlate a reply, so this cannot be answered as a
    // failed call — only reported.
    self.postMessage(Response.fail('unknown', ErrorCode.BAD_REQUEST, 'malformed request').toJSON())
    return
  }
  const emit = (name, data) => {
    try {
      self.postMessage(new Event(request.id, name, data).toJSON())
    } catch {}
  }
  // This listener is async, so a call that stays open does not hold the message
  // loop: `speech.dictate` is still pending for the whole dictation while the
  // `speech.push` calls that feed it are dispatched beside it. A synchronous
  // handler here would deadlock the session against its own audio.
  const response = await kernel.handle(request, emit)
  self.postMessage(response.toJSON())
})

// Announced so the page can prove this thread booted, rather than inferring it
// from the first dictation happening to work.
self.postMessage({ type: 'ready', notes: [], persistent: true })
