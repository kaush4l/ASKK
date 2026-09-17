import { describe, expect, test } from 'bun:test'
import { crossesIntoLoopback } from '../../../src/core/tools/HttpPort.js'

describe('crossing into the loopback address space', () => {
  test('a published page reaching the user’s own machine is a crossing', () => {
    // Measured on the live site, 2026-09-17: Chrome refuses this with
    // "Permission was denied for this request to access the `loopback` address
    // space". It is not mixed content — 127.0.0.1 is potentially trustworthy.
    expect(crossesIntoLoopback('http://127.0.0.1:8873/v1', 'https://kaush4l.github.io')).toBe(true)
    expect(crossesIntoLoopback('http://localhost:1234/v1', 'https://example.com')).toBe(true)
  })

  test('a page served from the machine itself is not crossing anything', () => {
    // Which is why running the app locally has always worked, and is the first
    // thing worth suggesting to somebody whose server is fine.
    expect(crossesIntoLoopback('http://127.0.0.1:8873/v1', 'http://localhost:3000')).toBe(false)
    expect(crossesIntoLoopback('http://localhost:1234/v1', 'http://127.0.0.1:4200')).toBe(false)
  })

  test('an ordinary remote endpoint is not a crossing, wherever the page is', () => {
    expect(crossesIntoLoopback('https://api.openai.com/v1', 'https://kaush4l.github.io')).toBe(
      false,
    )
  })

  test('no origin means no page, so nothing is being crossed', () => {
    // A test or a non-browser caller. Reporting a loopback denial there would
    // be inventing a browser that is not present.
    expect(crossesIntoLoopback('http://127.0.0.1:8873/v1', '')).toBe(false)
  })

  test('a url that is not a url is not a crossing', () => {
    expect(crossesIntoLoopback('not a url', 'https://example.com')).toBe(false)
  })
})
