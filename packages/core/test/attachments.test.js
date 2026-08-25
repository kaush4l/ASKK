/**
 * A DROPPED FILE REACHES THE TURN, AND A TEXT-ONLY CARD IS TOLD BEFOREHAND.
 *
 * The claim worth executing is not that a part was recorded — it is that the
 * part the paper will read is the same bytes the person dropped, that the
 * refusal happens BEFORE anything is recorded, and that a build with nowhere to
 * keep it says so instead of losing it quietly.
 */
import { describe, expect, test } from 'bun:test'
import { CAPABILITIES, get, post } from '@harness/kernel'
import { newAgentState } from '@harness/agent'
import { fakeClock, testPorts } from '@harness/adapters-test'
import { ATTACHED, bootFresh, handle, partOf } from '@harness/core'

import { memorySegments } from './doubles.js'

/** One pixel, as a browser hands it over. */
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const DROP = JSON.stringify([{ name: 'pixel.png', mediaType: 'image/png', dataBase64: PIXEL }])

/** @param {{acceptsImages?: boolean, workspace?: boolean}} [world] */
function build(world = {}) {
  const clock = fakeClock({ start: 1_000, step: 1 })
  const ports = testPorts({ clock, script: [] })
  const card = {
    name: 'sonnet', model: 'claude', kind: 'anthropic', contextTokens: 200_000,
    maxOutputTokens: null, acceptsImages: world.acceptsImages ?? true, reasons: false,
  }
  const available = world.workspace === false
    ? CAPABILITIES.filter((c) => c !== 'workspace')
    : [...CAPABILITIES]
  return bootFresh({
    ports,
    available,
    segments: memorySegments(),
    agent: { ...newAgentState(), card },
  })
}

describe('an image dropped on the composer', () => {
  test('becomes a Part the paper can read, byte-for-byte what was dropped', () => {
    const app = build()
    const sent = handle(app, post('/chat', { message: 'what is this?', attachments: DROP }))
    expect(sent.status).toBe(200)

    const attached = app.pending.map((p) => p.fact).find((f) => f.type === 'custom' && f.kind === ATTACHED)
    expect(attached).toBeDefined()
    const part = attached ? partOf(attached) : null
    expect(part).toEqual({ type: 'image', mediaType: 'image/png', dataBase64: PIXEL })
  })

  test('is written to the workspace by the same tool the agent uses, not a second door', () => {
    const app = build()
    handle(app, post('/chat', { message: 'keep this', attachments: DROP }))
    expect(app.chores).toHaveLength(1)
    expect(app.chores[0]).toMatchObject({ type: 'InvokeTool', tool: 'write_file' })
    expect(String(/** @type {{args: string}} */ (app.chores[0]).args)).toContain('attachments/pixel.png')
  })

  test('what lands on disk is the base64, and the note a person reads says so', () => {
    const app = build()
    const sent = handle(app, post('/chat', { message: 'keep this', attachments: DROP }))
    // The read-back path is not built yet, so this is the fact the next
    // increment gets to write against: the chore carries the ENCODING, not the
    // decoded bytes, and the sentence names the difference.
    const wrote = JSON.parse(String(/** @type {{args: string}} */ (app.chores[0]).args))
    expect(wrote.path).toBe('attachments/pixel.png')
    expect(wrote.contents).toBe(PIXEL)
    expect(String(sent.data.attachedLabel)).toContain('kept base64-encoded at attachments/pixel.png')
  })

  test('an agent with no card at all attaches the image rather than refusing it', () => {
    // The production case until the host resolves one: `refusedBy` answers ''
    // for a null card on purpose, because the turn is already about to end
    // saying the model key resolved to nothing and a second sentence about
    // images would bury it.
    const app = bootFresh({
      ports: testPorts({ clock: fakeClock({ start: 1_000, step: 1 }), script: [] }),
      available: [...CAPABILITIES],
      segments: memorySegments(),
      agent: { ...newAgentState(), card: null },
    })
    expect(handle(app, post('/chat', { message: 'what is this?', attachments: DROP })).status).toBe(200)
  })

  test('the attachment is recorded BEFORE the message, so the turn it starts can see it', () => {
    const app = build()
    handle(app, post('/chat', { message: 'what is this?', attachments: DROP }))
    const types = app.pending.map((p) => (p.fact.type === 'custom' ? p.fact.kind : p.fact.type))
    expect(types).toEqual([ATTACHED, 'user_message'])
  })

  test('a card that cannot read an image refuses it by name, and records nothing at all', () => {
    const app = build({ acceptsImages: false })
    const before = app.log.length
    const refused = handle(app, post('/chat', { message: 'what is this?', attachments: DROP }))

    expect(refused.status).toBe(400)
    expect(String(refused.data.message)).toContain('sonnet cannot read one')
    // The only fact appended is the one `handle` writes for a failed request;
    // no attachment and no message reached the log.
    expect(app.pending).toHaveLength(0)
    expect(app.log.length).toBe(before + 1)
  })

  test('a build with nowhere to keep it attaches it anyway and says a refresh loses it', () => {
    const app = build({ workspace: false })
    const sent = handle(app, post('/chat', { message: 'what is this?', attachments: DROP }))
    expect(app.chores).toHaveLength(0)
    expect(String(sent.data.attachedLabel)).toContain('a refresh loses it')
  })

  test('a text file is a file part and is never described as an image', () => {
    const app = build({ acceptsImages: false })
    const drop = JSON.stringify([{ name: 'notes.txt', mediaType: 'text/plain', dataBase64: 'aGVsbG8=' }])
    handle(app, post('/chat', { message: 'read this', attachments: drop }))
    const attached = app.pending.map((p) => p.fact).find((f) => f.type === 'custom' && f.kind === ATTACHED)
    expect(attached ? partOf(attached) : null).toEqual({ type: 'file', name: 'notes.txt', mediaType: 'text/plain', dataBase64: 'aGVsbG8=' })
  })

  test('attachments that will not parse are refused, never silently dropped', () => {
    const app = build()
    const refused = handle(app, post('/chat', { message: 'hi', attachments: '{not json' }))
    expect(refused.status).toBe(400)
    expect(String(refused.data.message)).toContain('not JSON')
    expect(/** @type {unknown[]} */ (handle(app, get('/chat')).data.messages)).toHaveLength(0)
  })
})
