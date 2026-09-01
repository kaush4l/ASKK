import { describe, expect, test } from 'bun:test'
import { Outcome, Reason } from '../../../src/core/Outcome.js'
import { Blocked } from '../../../src/core/tools/HttpPort.js'
import { SearchTool } from '../../../src/core/tools/SearchTool.js'

/**
 * A search tool has one job and one temptation. The job is to produce a URL
 * worth fetching. The temptation is to return everything the endpoint gave it,
 * which is where an agent's context window actually goes — five results with
 * full page extracts costs more than the page the agent wanted in the first
 * place, and it pays that on a turn that has not yet learned anything.
 *
 * So the assertions here are mostly about what is NOT in the output.
 */

function fakePort(reply) {
  const calls = []
  const port = async (request) => {
    calls.push(request)
    const answer = typeof reply === 'function' ? reply(request) : reply
    if (answer instanceof Outcome) return answer
    return Outcome.ok({
      url: request.url,
      status: 200,
      contentType: 'application/json',
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

const hits = (data) => ({ text: JSON.stringify({ success: true, data }) })

describe('SearchTool', () => {
  test('the query goes out as a JSON POST to the endpoint', async () => {
    const http = fakePort(hits([]))

    await new SearchTool({ http, endpoint: 'https://search.example/v1' }).call({
      query: 'zig compiler release',
    })

    const [request] = http.calls
    expect(request.url).toBe('https://search.example/v1')
    expect(request.method).toBe('POST')
    expect(request.headers['content-type']).toBe('application/json')
    expect(JSON.parse(request.body).query).toBe('zig compiler release')
    expect(JSON.parse(request.body).limit).toBeGreaterThan(0)
  })

  test('results are a short ranked list and nothing else', async () => {
    // What the endpoint really returns: descriptions that are page extracts,
    // markdown and all, thousands of characters each.
    const http = fakePort(
      hits(
        Array.from({ length: 8 }, (_unused, i) => ({
          title: `Result ${i}`,
          url: `https://example.com/${i}`,
          description: `# heading\n\n${'padding '.repeat(500)}`,
        })),
      ),
    )

    const result = await new SearchTool({ http }).call({ query: 'zig' })
    const lines = result.value.split('\n')

    // Ranked, capped, and two lines each: a numbered title-and-url line and one
    // clipped snippet. Anything more is a wall of text.
    expect(lines[0].startsWith('1. Result 0 — https://example.com/0')).toBe(true)
    expect(lines).toHaveLength(10)
    expect(result.value).not.toContain('6.')
    // The endpoint offered ~32,000 characters; what reaches the model is a
    // fraction of one page of it.
    expect(result.value.length).toBeLessThan(1500)
  })

  test('a snippet is one line, so a markdown heading cannot pose as the model’s own output', async () => {
    const http = fakePort(
      hits([
        { title: 'Docs', url: 'https://example.com/', description: '# Install\n\n```sh\nrun\n```' },
      ]),
    )

    const result = await new SearchTool({ http }).call({ query: 'install' })

    expect(result.value).toBe('1. Docs — https://example.com/\n   # Install ```sh run ```')
  })

  test('a result with no snippet is one line, not a line and a blank one', async () => {
    const http = fakePort(hits([{ title: 'Bare', url: 'https://example.com/' }]))

    const result = await new SearchTool({ http }).call({ query: 'bare' })

    expect(result.value).toBe('1. Bare — https://example.com/')
  })

  test('no results says so, and repeats what the endpoint said about why', async () => {
    const empty = await new SearchTool({ http: fakePort(hits([])) }).call({ query: 'qwertyuiop' })
    const refusedByService = await new SearchTool({
      http: fakePort({ text: JSON.stringify({ success: false, data: [], error: 'rate limited' }) }),
    }).call({ query: 'zig' })

    expect(empty.value).toContain('no results')
    expect(empty.value).toContain('qwertyuiop')
    expect(refusedByService.value).toContain('rate limited')
  })

  test('an envelope this tool cannot read is not the same answer as zero results', async () => {
    // The failure this exists to stop: the endpoint ships `data: {web: [...]}`
    // one day, `Array.isArray(body.data)` is false, and every search from then
    // on is a confident, permanent, silent "nothing found" — which an agent
    // treats as a fact about the world rather than about the tool.
    const shifted = await new SearchTool({
      http: fakePort({ text: JSON.stringify({ success: true, data: { web: [{ url: 'x' }] } }) }),
    }).call({ query: 'zig' })
    const genuinelyEmpty = await new SearchTool({ http: fakePort(hits([])) }).call({
      query: 'zig',
    })

    expect(shifted.value).toContain('not in the shape this tool reads')
    expect(shifted.value).toContain('could not search')
    expect(shifted.value).not.toContain('no results for')
    // And the honest zero still reads as a zero, which is the agent's cue to
    // try other words rather than to give up on searching.
    expect(genuinelyEmpty.value).toContain('no results for')
    expect(genuinelyEmpty.value).not.toContain('could not search')
  })

  test('a port handed in as the wrong type is the same case as no port at all', async () => {
    const result = await new SearchTool({ http: { post: () => {} } }).call({ query: 'zig' })

    expect(result.ok).toBe(true)
    expect(result.value).toContain('nothing could be searched for')
  })

  test('an endpoint that will not answer a browser is named, not called a failure', async () => {
    const http = fakePort({ status: 0, blocked: Blocked.REFUSED })

    const result = await new SearchTool({ http }).call({ query: 'zig' })

    expect(result.ok).toBe(true)
    expect(result.value).toContain('refused')
    // The instruction that keeps a model from inventing what a search would
    // have found, which is the actual harm of a search tool that stops working.
    expect(result.value).toContain('could not check')
  })

  test('a non-200 is reported with its status', async () => {
    const result = await new SearchTool({ http: fakePort({ status: 429, text: '' }) }).call({
      query: 'zig',
    })

    expect(result.value).toContain('429')
    expect(result.value).toContain('rate-limiting')
  })

  test('a 200 that is not JSON is survivable', async () => {
    const result = await new SearchTool({
      http: fakePort({ status: 200, contentType: 'text/html', text: '<html>captcha</html>' }),
    }).call({ query: 'zig' })

    expect(result.ok).toBe(true)
    expect(result.value).toContain('not in JSON')
  })

  test('an empty query costs no request', async () => {
    const http = fakePort(hits([]))

    const result = await new SearchTool({ http }).call({ query: '   ' })

    expect(http.calls).toHaveLength(0)
    expect(result.value).toContain('no query was given')
  })

  test('with no port the tool says so rather than failing on a missing function', async () => {
    const result = await new SearchTool().call({ query: 'zig' })

    expect(result.ok).toBe(true)
    expect(result.value).toContain('nothing could be searched for')
  })

  test('a port that fails is an observation', async () => {
    const http = fakePort(() => Outcome.failed(Reason.UNAVAILABLE, 'no network at all'))

    const result = await new SearchTool({ http }).call({ query: 'zig' })

    expect(result.ok).toBe(true)
    expect(result.value).toContain('no network at all')
  })
})
