import { describe, expect, test } from 'bun:test'
import { AgentCatalogue } from '../../../src/core/agent/AgentCatalogue.js'

/**
 * The soul is fetched like an agent file and is allowed to be missing. A tree
 * with no `agents/soul.md` must load agents exactly as it did before, which is
 * why absence is an empty string rather than a failure.
 */
const catalogueServing = (bodies) => {
  const catalogue = new AgentCatalogue('')
  catalogue._fetchText = async (url) =>
    url in bodies
      ? { ok: true, value: bodies[url], notes: [] }
      : { ok: false, value: null, notes: [], failure: { message: 'HTTP 404' } }
  return catalogue
}

describe('the shared soul', () => {
  test('is read once and kept', async () => {
    const catalogue = catalogueServing({ 'agents/soul.md': 'Be careful.' })
    expect((await catalogue.soul()).value).toBe('Be careful.')
    expect((await catalogue.soul()).value).toBe('Be careful.')
  })

  test('is empty rather than a failure when the file is not there', async () => {
    const got = await catalogueServing({}).soul()
    expect(got.ok).toBe(true)
    expect(got.value).toBe('')
  })
})
