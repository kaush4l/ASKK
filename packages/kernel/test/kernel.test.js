import { expect, test, describe } from 'bun:test'
import {
  EventLog, EVENT_VERSION, isKnownFact, factAgent, effectiveGrant, grants,
  readManifest, matchesRoute, problem, isProblem, ok, get, post, withHeader,
  addressee, isLoopback, ModelError, statusSentence, isBusy,
} from '@harness/kernel'

describe('the log', () => {
  test('assigns seq, id and the envelope version at append', () => {
    const log = new EventLog()
    log.append({ type: 'user_message', text: 'a', agent: 'main', from: '' }, 10)
    const second = log.append({ type: 'model_replied', agent: 'main', text: 'b', reasoning: '' }, 11)
    expect(log.length).toBe(2)
    expect(second).toEqual({ id: 1, seq: 1, at: 11, v: EVENT_VERSION, fact: second.fact })
  })

  test('iterates in order and slices from a seq a projection already saw', () => {
    const log = new EventLog()
    for (const text of ['a', 'b', 'c']) log.append({ type: 'model_replied', agent: 'm', text, reasoning: '' }, 1)
    expect([...log].map((e) => e.fact.type)).toEqual(['model_replied', 'model_replied', 'model_replied'])
    expect(log.since(2)).toHaveLength(1)
  })

  test('refuses a fact this build cannot name, rather than dropping it', () => {
    expect(isKnownFact({ type: 'user_message' })).toBe(true)
    expect(isKnownFact({ type: 'invented_later' })).toBe(false)
    expect(isKnownFact(null)).toBe(false)
  })

  test('a fact without an agent belongs to the system, not to a guess', () => {
    expect(factAgent({ type: 'user_message', text: '', agent: 'main', from: '' })).toBe('main')
    expect(factAgent({ type: 'store_failed', key: 'k', message: 'm' })).toBe('')
  })
})

describe('the seam', () => {
  test('a request carries its addressee in a header, never in the path', () => {
    const req = withHeader(get('/chat'), 'x-agent', 'scout')
    expect(req.path).toBe('/chat')
    expect(addressee(req)).toBe('scout')
    expect(addressee(get('/chat'))).toBe('')
  })

  test('a post keeps its fields as data, so nothing needs escaping', () => {
    const req = post('/chat/send', { text: 'a=b&c=d' })
    expect(req.body.text).toBe('a=b&c=d')
  })

  test('every failure is the one problem projection', () => {
    const res = problem(404, 'no route', { kind: 'unrouted', repair: 'check the address' })
    expect(isProblem(res)).toBe(true)
    expect(res.data).toStrictEqual({
      id: '', kind: 'unrouted', message: 'no route', detail: '', repair: 'check the address',
    })
    expect(isProblem(ok('chat', {}))).toBe(false)
  })

  test('two failures of one kind are two rows, because id is what they are about', () => {
    // The case that forced the field: two agents missing from the manifest is
    // two 404s with identical prose, and a list keyed on either would collapse.
    const first = problem(404, 'That agent file did not load.', { id: 'scout', kind: 'no_file' })
    const second = problem(404, 'That agent file did not load.', { id: 'critic', kind: 'no_file' })
    expect(first.data.message).toBe(second.data.message)
    expect(first.data.kind).toBe(second.data.kind)
    expect(first.data.id).not.toBe(second.data.id)
  })
})

describe('capabilities', () => {
  test('a grant is the intersection of asked and available — never the ask', () => {
    const grant = effectiveGrant('chat', ['model', 'workspace'], ['model', 'clock'])
    expect(grant.granted).toEqual(['model'])
    expect(grants(grant, 'model')).toBe(true)
    expect(grants(grant, 'workspace')).toBe(false)
  })
})

describe('manifests', () => {
  const good = { id: 'chat', version: '1', title: 'Chat', view: 'chat', routes: [{ method: 'GET', path: '/chat' }] }

  test('reads a well-formed manifest and defaults what is optional', () => {
    const read = readManifest(good)
    expect('manifest' in read && read.manifest.capabilities).toEqual([])
    expect('manifest' in read && matchesRoute(read.manifest, 'GET', '/chat')).toBe(true)
  })

  test('says what is wrong instead of returning half an object', () => {
    expect(readManifest({ ...good, id: '' })).toEqual({ problem: 'manifest.id must be a non-empty string' })
    expect(readManifest({ ...good, routes: 'no' })).toEqual({ problem: 'manifest.routes must be an array' })
    expect(readManifest(7)).toEqual({ problem: 'manifest is not an object' })
  })
})

describe('errors and status', () => {
  test('a typed error survives a throw and serializes for the log', () => {
    const err = new ModelError('unauthorized', 'the key was refused', { status: 401 })
    expect(err instanceof Error).toBe(true)
    expect(err.kind).toBe('unauthorized')
    expect(err.toJSON()).toMatchObject({ name: 'ModelError', kind: 'unauthorized' })
  })

  test('tells a local endpoint being down from the internet being gone', () => {
    expect(isLoopback('http://localhost:8873/v1')).toBe(true)
    expect(isLoopback('https://openrouter.ai/api')).toBe(false)
  })

  test('every status has one sentence and one busy answer', () => {
    expect(statusSentence('waiting')).toBe('waiting on another agent')
    expect(isBusy('calling')).toBe(true)
    expect(isBusy('idle')).toBe(false)
  })
})
