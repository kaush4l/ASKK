import { describe, expect, test } from 'bun:test'
import { Outcome, Reason } from '../../../src/core/Outcome.js'
import { FetchTool } from '../../../src/core/tools/FetchTool.js'
import { Blocked } from '../../../src/core/tools/HttpPort.js'
import { Toolbox } from '../../../src/core/tools/Toolbox.js'

/**
 * Everything interesting about a fetch tool in a browser is a failure, which is
 * exactly why it takes a port: none of these cases can be produced on demand
 * against a real network, and the most important of them — an origin refusing
 * to be read — cannot be produced at all from a test runner that has no
 * same-origin policy.
 *
 * The observations are asserted for their MEANING and not their wording,
 * because the meaning is the contract: the agent has to be able to tell a site
 * that refused a browser from a site that is not there, and a tool that says
 * "failed" for both makes it retry the first one forever.
 */

/** A port that records what it was handed and answers with what the test set up. */
function fakePort(reply) {
  const calls = []
  const port = async (request) => {
    calls.push(request)
    const answer = typeof reply === 'function' ? reply(request) : reply
    if (answer instanceof Outcome) return answer
    return Outcome.ok({
      url: request.url,
      status: 200,
      contentType: 'text/plain',
      text: '',
      bytes: 0,
      truncated: false,
      stopped: '',
      blocked: Blocked.NONE,
      ...answer,
    })
  }
  port.calls = calls
  return port
}

describe('FetchTool', () => {
  test('HTML arrives as prose, and the observation says it was reduced', async () => {
    const http = fakePort({
      contentType: 'text/html; charset=utf-8',
      text: '<html><head><title>Zig</title><script>var a="noise"</script></head><body><p>0.15.2 is current.</p></body></html>',
    })

    const result = await new FetchTool({ http }).call({ url: 'https://ziglang.org/' })

    expect(result.ok).toBe(true)
    expect(result.value).toContain('0.15.2 is current.')
    expect(result.value).not.toContain('noise')
    expect(result.value).not.toContain('<p>')
    expect(result.value).toContain('reduced from HTML')
  })

  test('JSON is handed over untouched, markup and all', async () => {
    const body = '{"tag_name":"0.15.2","body":"see <b>the notes</b>"}'
    const http = fakePort({ contentType: 'application/json', text: body })

    const result = await new FetchTool({ http }).call({
      url: 'https://api.github.com/repos/ziglang/zig/releases/latest',
    })

    // Reducing JSON would strip `<b>` out of a string value and silently change
    // the data the agent is about to reason about.
    expect(result.value).toContain(body)
    expect(result.value).not.toContain('reduced from HTML')
  })

  test('a long body is cut, and the observation states both numbers truthfully', async () => {
    const long = 'word '.repeat(4000)
    const http = fakePort({ contentType: 'text/plain', text: long })

    const result = await new FetchTool({ http }).call({ url: 'https://example.com/big.txt' })

    const cut = /\[cut: ([\d,]+) of ([\d,]+) characters shown\]/.exec(result.value)
    expect(cut).not.toBeNull()
    const shown = Number(cut[1].replaceAll(',', ''))
    const total = Number(cut[2].replaceAll(',', ''))
    expect(total).toBe(long.trim().length)
    // The claimed number is the number actually present: a cut note that
    // overstates what the model was given is worse than no note at all.
    const [, printed] = result.value.split('\n\n')
    expect(printed.length).toBe(shown)
    expect(shown).toBeLessThan(total)
  })

  test('a capped download is reported separately from a capped observation', async () => {
    const http = fakePort({
      contentType: 'text/plain',
      text: 'short enough to print in full',
      bytes: 512 * 1024,
      truncated: true,
    })

    const result = await new FetchTool({ http }).call({ url: 'https://example.com/huge' })

    // Two different facts. The text was not cut here; the DOWNLOAD was, so what
    // is missing cannot be recovered by asking for more of what is shown.
    expect(result.value).not.toContain('[cut:')
    expect(result.value).toContain('the download stopped at 512 KB')
  })

  test('an origin that refuses a browser is not the same observation as a host that is not there', async () => {
    const refused = await new FetchTool({
      http: fakePort({ status: 0, blocked: Blocked.REFUSED }),
    }).call({ url: 'https://ziglang.org/' })
    const gone = await new FetchTool({
      http: fakePort({ status: 0, blocked: Blocked.UNREACHABLE }),
    }).call({ url: 'https://no-such-host.invalid/' })

    expect(refused.ok).toBe(true)
    expect(gone.ok).toBe(true)
    expect(refused.value).not.toBe(gone.value)

    // The constraint is NAMED, so the agent can reason about it rather than
    // treating a permanent rule of the web as a transient error.
    expect(refused.value).toContain('did not permit a browser to read it')
    expect(refused.value).toMatch(/CORS/)
    expect(refused.value).toMatch(/not change on a retry|search/)

    // And the other one says the opposite thing: nothing answered, so the
    // address itself is in question.
    expect(gone.value).toContain('nothing answered')
    expect(gone.value).toContain('no-such-host.invalid')
    expect(gone.value).not.toContain('CORS')
  })

  test('a timeout says how long it waited', async () => {
    const http = fakePort({ status: 0, blocked: Blocked.TIMEOUT })

    const result = await new FetchTool({ http }).call({ url: 'https://slow.example/' })

    expect(result.value).toMatch(/did not answer within \d+ seconds/)
  })

  test('an error status is reported with its number and its body', async () => {
    const http = fakePort({ status: 404, contentType: 'text/plain', text: '404: Not Found' })

    const result = await new FetchTool({ http }).call({ url: 'https://example.com/gone' })

    expect(result.value.startsWith('404')).toBe(true)
    expect(result.value).toContain('404: Not Found')
  })

  test('a malformed address is answered without spending a request', async () => {
    const http = fakePort({})
    const tool = new FetchTool({ http })

    const nonsense = await tool.call({ url: 'ziglang' })
    const wrongScheme = await tool.call({ url: 'file:///etc/passwd' })
    const nothing = await tool.call({})

    expect(http.calls).toHaveLength(0)
    expect(nonsense.ok).toBe(true)
    expect(nonsense.value).toContain('is not a URL')
    expect(wrongScheme.value).toContain('only http and https')
    expect(nothing.value).toContain('no url was given')
  })

  test('the byte cap is the port’s instruction, not a hope', async () => {
    const http = fakePort({ contentType: 'text/plain', text: 'ok' })

    await new FetchTool({ http }).call({ url: 'https://example.com/' })

    expect(http.calls[0].limit).toBeGreaterThan(0)
    expect(http.calls[0].timeout).toBeGreaterThan(0)
    expect(http.calls[0].url).toBe('https://example.com/')
  })

  test('with no port the tool says so rather than failing on a missing function', async () => {
    const result = await new FetchTool().call({ url: 'https://example.com/' })

    expect(result.ok).toBe(true)
    expect(result.value).toContain('nothing could be fetched')
  })

  test('the address that answered is named when it is not the one that was asked for', async () => {
    const http = fakePort({
      url: 'https://example.com/en-GB/login',
      contentType: 'text/plain',
      text: 'sign in to continue',
    })

    const result = await new FetchTool({ http }).call({ url: 'https://example.com/docs' })

    // A redirect is how a page becomes a login wall or a regional edition. An
    // agent reading the answer under the URL it typed cannot see that happen,
    // and will report the login page as the documentation.
    expect(result.value).toContain('redirected to https://example.com/en-GB/login')

    const straight = await new FetchTool({
      http: fakePort({ contentType: 'text/plain', text: 'the actual docs' }),
    }).call({ url: 'https://example.com/docs' })
    expect(straight.value).not.toContain('redirected')
  })

  test('markup with no content-type is still reduced rather than handed over raw', async () => {
    // Not exotic: an S3 object and a misconfigured static host both do this,
    // and deciding from the header alone sent the script bodies to the model.
    const http = fakePort({
      contentType: '',
      text: '<!doctype html><html><head><title>T</title><script>var secret="LEAK"</script></head><body><p>the fact</p></body></html>',
    })

    const result = await new FetchTool({ http }).call({ url: 'https://cdn.example/page' })

    expect(result.value).toContain('the fact')
    expect(result.value).not.toContain('LEAK')
    expect(result.value).not.toContain('<p>')
  })

  test('plain text with no content-type is left alone', async () => {
    const http = fakePort({ contentType: '', text: 'a < b and c > d' })

    const result = await new FetchTool({ http }).call({ url: 'https://cdn.example/notes' })

    // The sniff must not fire on prose that merely contains an angle bracket:
    // running that through the reducer eats everything after the `<`.
    expect(result.value).toContain('a < b and c > d')
    expect(result.value).not.toContain('reduced from HTML')
  })

  test('a body that stopped part-way keeps what arrived and says why it stopped', async () => {
    const http = fakePort({
      contentType: 'text/plain',
      text: 'the first half of the answer',
      stopped: 'the connection reset',
    })

    const result = await new FetchTool({ http }).call({ url: 'https://example.com/' })

    // The two facts that were both lost: the partial body was discarded and
    // the model was told the response had no readable content, while the real
    // reason went into a note nothing downstream of a tool has ever read.
    expect(result.value).toContain('the first half of the answer')
    expect(result.value).not.toContain('no readable content')
    expect(result.value).toContain('the connection reset')
  })

  test('a genuinely empty body says so, and does not claim a broken connection', async () => {
    const result = await new FetchTool({
      http: fakePort({ status: 204, contentType: 'text/plain', text: '' }),
    }).call({ url: 'https://example.com/' })

    expect(result.value).toContain('no readable content')
    expect(result.value).not.toContain('broke part-way')
  })

  test('a port handed in as the wrong type is the same case as no port at all', async () => {
    // How this actually happens: the tool is built from a `services` record in
    // `composition.js`, and a renamed or mistyped field arrives as an object,
    // not as `undefined`. A truthiness test would take it and call it.
    const result = await new FetchTool({ http: { get: () => {} } }).call({
      url: 'https://example.com/',
    })

    expect(result.ok).toBe(true)
    expect(result.value).toContain('nothing could be fetched')
  })

  test('a note from the port reaches the agent instead of dying in the toolbox', async () => {
    const http = fakePort(() =>
      Outcome.ok(
        {
          url: 'https://example.com/',
          status: 200,
          contentType: 'text/plain',
          text: 'the body',
          bytes: 8,
          truncated: false,
          stopped: '',
          blocked: Blocked.NONE,
        },
        ['the declared charset was unknown, so utf-8 was used'],
      ),
    )

    const toolbox = new Toolbox([new FetchTool({ http })])
    const { observation } = await toolbox.run('fetch({"url": "https://example.com/"})')

    expect(observation).toContain('the body')
    expect(observation).toContain('the declared charset was unknown')
  })

  test('a port that fails is an observation, never a failed turn', async () => {
    const http = fakePort(() => Outcome.failed(Reason.INTERNAL, 'the transport exploded'))

    const result = await new FetchTool({ http }).call({ url: 'https://example.com/' })

    // The agent's next move is a decision it can only make if it is told.
    expect(result.ok).toBe(true)
    expect(result.value).toContain('the transport exploded')
  })
})
