import { describe, expect, test } from 'bun:test'
import { ScriptedInference } from './ScriptedInference.js'

/**
 * The instrument, checked before anything is measured with it.
 *
 * Every claim this repository makes about what the model receives is read off
 * this class, so a defect in it is a defect in all of them at once — and it is
 * the kind nothing else would catch, because a broken instrument reports
 * confidently. It was written once with `constructor({ replies })` and no
 * default, which made `new ScriptedInference()` throw in a tree whose one rule
 * is that nothing throws; that is the first test here.
 */

describe('ScriptedInference', () => {
  test('constructed with nothing, it fails on use rather than throwing on birth', async () => {
    const inference = new ScriptedInference()

    const outcome = await inference.invoke('hello')

    expect(outcome.ok).toBe(false)
    expect(outcome.failure.message).toContain('the script ran out after 1 call(s)')
  })

  test('it keeps the arguments at the boundary, not a second copy of them', async () => {
    const inference = new ScriptedInference({ replies: ['first', 'second'] })

    await inference.invoke('prompt one', [{ kind: 'image' }], { cacheAt: 42 })
    const second = await inference.invoke('prompt two')

    expect(second.value).toBe('second')
    expect(inference.prompts).toEqual(['prompt one', 'prompt two'])
    expect(inference.calls[0].multimodal).toEqual([{ kind: 'image' }])
    expect(inference.calls[0].options).toEqual({ cacheAt: 42 })
  })

  test('the caller keeps its replies: running the script does not drain the array', async () => {
    // `scripts/dryrun.js` prints each reply back beside the prompt it answered,
    // reading the same array it passed in. A `shift()` on the caller's array
    // would empty it and take those panels out of the artifact.
    const replies = ['only']
    const inference = new ScriptedInference({ replies })

    await inference.invoke('go')

    expect(replies).toEqual(['only'])
  })

  test('through stream() the whole reply arrives as one delta, and it says whose', async () => {
    // The path a live turn takes: `ChatService` always attaches a delta
    // listener, so `Engine.step` calls `stream()` and never `invoke()`. A
    // transport that cannot stream must still answer through it — one chunk,
    // same value, and a note naming the transport rather than the base class.
    const inference = new ScriptedInference({ replies: ['the whole answer'] })
    const chunks = []

    const outcome = await inference.stream('prompt', [], {
      onDelta: (chunk, kind) => chunks.push([chunk, kind]),
      cacheAt: 7,
    })

    expect(outcome.value).toBe('the whole answer')
    expect(chunks).toEqual([['the whole answer', 'text']])
    expect(outcome.notes).toEqual(['scripted does not stream; the reply arrived at once'])
    // `onDelta` is the streaming layer's business and is not passed on.
    expect(inference.calls[0].options).toEqual({ cacheAt: 7 })
  })
})
