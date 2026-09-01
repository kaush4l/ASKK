import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { RigTransport } from '../../bench/transport.js'
import { OpenAICompatible, Reply } from '../../src/core/inference/OpenAICompatible.js'

/**
 * The rig's HTTP call, held to one claim: THAT IT IS THE TREE'S.
 *
 * A blind panel found `grep -rn OpenAICompatible bench/` returning three hits,
 * all prose in comments, while `bench/driver.js` carried its own fetch and its
 * own `message.content ?? ''`. So the arm labelled "ours" was compared without
 * the one component of ours that decides whether a reply is an answer at all,
 * and a suite of 484 tests could not see it because nothing here asserted the
 * import. These do.
 *
 * The four state tests are driven by the FOUR REAL CAPTURES this repository
 * already keeps for `OpenAICompatible` itself — `test/support/fixtures/*.json`,
 * whole reply bodies off the testbed endpoint. Using them rather than
 * hand-written shapes is the point: a hand-written shape is a second opinion
 * about what the endpoint does, and this rig has already been wrong once by
 * having a second opinion about the transport.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, '..', 'support', 'fixtures')
const VENDOR = resolve(HERE, '..', '..', 'bench', 'vendor', 'agent-zero')
const capture = (name) => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'))

let sent = []
let realFetch

/** Serve one recorded body, and remember what was asked for. */
function serve(body, status = 200) {
  globalThis.fetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) })
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
}

const settings = () => ({
  model: 'Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp',
  baseUrl: 'http://127.0.0.1:8873/v1',
  temperature: 0,
  maxTokens: 1200,
  timeout: 1000,
  seed: 7,
})

beforeEach(() => {
  sent = []
  realFetch = globalThis.fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
})

describe('it is the shipped transport, not a copy of it', () => {
  test('the rig transport IS an OpenAICompatible', () => {
    // The assertion the rig did not have. A reimplementation passes every other
    // test in this file and fails this one.
    expect(new RigTransport(settings())).toBeInstanceOf(OpenAICompatible)
  })

  test('the classifier the rig uses is the class’s own static', () => {
    // Not "a classifier that agrees with it" — the same function object.
    expect(RigTransport._state).toBe(OpenAICompatible._state)
  })

  test('thinking defaults to on, which is what the app runs', () => {
    // `agents/main/agent.md` declares no `thinking:` line and
    // `DEFAULT_SETTINGS.thinking` is true, so an arm measured with it off would
    // be measuring a configuration nobody ships.
    expect(new RigTransport(settings()).thinking).toBe(true)
  })
})

describe('the one override, and the line it rests on', () => {
  test('the cited lines of the vendored agent.py say what the override claims', () => {
    // `_body` is overridden for exactly one reason: the reference arm sends a
    // system message and a history, and ours sends one assembled user message.
    // That claim used to cite `agent.py:583` — a file this repository did not
    // contain, so the single divergence between the rig and the shipped
    // transport rested on a line nobody here could open, which is what
    // `CAPABILITIES.md` refuses to call evidence. The file is vendored now, and
    // 583 turned out to be the `remove_code_fences` join that BUILDS the system
    // text rather than the message array.
    const agent = readFileSync(join(VENDOR, 'agent.py'), 'utf8')
    const lines = agent.split('\n')
    expect(lines.slice(605, 610).join('\n')).toContain('SystemMessage(content=system_text)')
    expect(lines.slice(605, 610).join('\n')).toContain('*history_langchain')
    expect(lines[582]).not.toContain('SystemMessage')
  })
})

describe('the body on the wire', () => {
  test('the scaffold’s message array survives, and every sampling field is the class’s', async () => {
    serve(capture('complete'))
    const transport = new RigTransport(settings())
    const messages = [
      { role: 'system', content: 'a system message' },
      { role: 'user', content: 'a user message' },
    ]
    await transport.call(messages)

    const body = sent[0].body
    // agent-zero builds `[SystemMessage(system_text), *history]` —
    // `bench/vendor/agent-zero/agent.py:606-610`, vendored, so this comment
    // cites a file in this repository rather than a clone on one machine. The
    // shipped `_body` sends one message; collapsing them would falsify the
    // reference arm.
    expect(body.messages).toEqual(messages)
    expect(body.model).toBe('Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp')
    expect(body.temperature).toBe(0)
    expect(body.max_tokens).toBe(1200)
    expect(body.seed).toBe(7)
    expect(sent[0].url).toBe('http://127.0.0.1:8873/v1/chat/completions')
  })

  test('the thinking switch is the class’s, spelled once, there', async () => {
    // `chat_template_kwargs` is not written anywhere in bench/. If this passes,
    // `super._body` produced it, which is the whole argument for the override.
    serve(capture('complete'))
    await new RigTransport({ ...settings(), thinking: false }).call([
      { role: 'user', content: 'x' },
    ])
    expect(sent[0].body.chat_template_kwargs).toEqual({ enable_thinking: false })

    sent = []
    serve(capture('complete'))
    await new RigTransport(settings()).call([{ role: 'user', content: 'x' }])
    expect(sent[0].body.chat_template_kwargs).toBeUndefined()
  })

  test('no seed is sent when none was set', async () => {
    serve(capture('complete'))
    await new RigTransport({ ...settings(), seed: null }).call([{ role: 'user', content: 'x' }])
    expect('seed' in sent[0].body).toBe(false)
  })
})

describe('the four states, over the four real captures', () => {
  test('a whole reply is passed on', async () => {
    serve(capture('complete'))
    const reply = await new RigTransport(settings()).call([{ role: 'user', content: 'x' }])
    expect(reply.state).toBe(Reply.WHOLE)
    expect(reply.ok).toBe(true)
    expect(reply.content.length).toBeGreaterThan(0)
    expect(reply.content).toBe(capture('complete').choices[0].message.content)
  })

  test('a cut reply is passed on WITH the note that says it was cut', async () => {
    serve(capture('truncated-past-think'))
    const reply = await new RigTransport(settings()).call([{ role: 'user', content: 'x' }])
    expect(reply.state).toBe(Reply.CUT)
    expect(reply.ok).toBe(true)
    expect(reply.notes.join(' ')).toContain('cut off')
  })

  test('the dump is REFUSED, and its text does not reach the caller', async () => {
    // This is the state our arm hit twelve times in `bench/transcripts/` and
    // parsed as an answer, because the rig had no classifier. `content` here is
    // 220 completion tokens of the model rehearsing its own response format.
    const raw = capture('truncated-in-think')
    serve(raw)
    const reply = await new RigTransport(settings()).call([{ role: 'user', content: 'x' }])
    expect(reply.state).toBe(Reply.THINKING)
    expect(reply.ok).toBe(false)
    expect(reply.answered).toBe(true)
    expect(reply.content).toBe('')
    expect(reply.failure.message).toContain('still thinking')
    // The exact text the refusal exists to withhold.
    expect(reply.content).not.toContain(raw.choices[0].message.content.slice(0, 40))
  })

  test('a reply whose answer never began is REFUSED', async () => {
    serve(capture('spent-in-think'))
    const reply = await new RigTransport(settings()).call([{ role: 'user', content: 'x' }])
    expect(reply.state).toBe(Reply.SPENT)
    expect(reply.ok).toBe(false)
    expect(reply.failure.message).toContain('before the model wrote any answer')
  })
})

describe('what answered, which the rig used to throw away', () => {
  test('the model in the reply is recorded, not the model that was asked for', async () => {
    // A real capture in which the endpoint answered from a DIFFERENT model than
    // this rig requests. `curl /v1/models` on the testbed lists four; the rig
    // sent one and recorded nothing, so "the same model for both arms" was an
    // assumption about a server made by code that discarded the server's answer.
    serve(capture('spent-in-think'))
    const transport = new RigTransport(settings())
    const reply = await transport.call([{ role: 'user', content: 'x' }])
    expect(sent[0].body.model).toBe('Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp')
    expect(reply.model).toBe('gemma-4-12B-it-qat-mxfp8')
  })

  test('the endpoint’s own token counts come back in its own spelling', async () => {
    serve(capture('complete'))
    const reply = await new RigTransport(settings()).call([{ role: 'user', content: 'x' }])
    expect(reply.usage.completion_tokens).toBe(302)
    // And normalised by `Inference._usage`, which is what `Budget.measure` eats.
    expect(reply.measured).toMatchObject({ prompt: 84, completion: 302, cached: 0 })
  })
})

describe('a broken endpoint is not a refused reply', () => {
  test('an HTTP error is `answered: false`, and the message is the tree’s', async () => {
    serve('upstream is down', 503)
    const reply = await new RigTransport(settings()).call([{ role: 'user', content: 'x' }])
    expect(reply.answered).toBe(false)
    expect(reply.ok).toBe(false)
    expect(reply.failure.message).toContain('HTTP 503')
  })

  test('a 200 the transport refused is still `answered: true`', async () => {
    // The distinction the driver scores on, derived from whether a body was
    // parsed and never from reading English out of a failure message.
    serve(capture('truncated-in-think'))
    const reply = await new RigTransport(settings()).call([{ role: 'user', content: 'x' }])
    expect(reply.answered).toBe(true)
    expect(reply.ok).toBe(false)
  })
})
