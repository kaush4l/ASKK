/**
 * THE GOLDEN MATRIX'S SUBJECT: three adapters × three budgets × four kinds of
 * content, as one set of fixtures every golden is built from.
 *
 * It snapshots the FINAL REQUEST BODY and not the Document, because the body
 * is what a provider sees and the document is not. A golden that stops at the
 * document lets the wire drift underneath it — which is the exact shape of the
 * Rust defect where `effects.rs` called the OpenAI serialiser whatever format
 * the render had just chosen.
 * @module
 */

import {
  UNLIMITED_BUDGET, modelCard, assemble, adapterFor, paperOf,
  soul, identity, operatingRules, goal, affordances, memory, space,
  environment, task, history, observations, directive, prose, toolEnvelope, shaped,
  SLOT,
} from '@harness/context'

/** @typedef {import('@harness/context').Component} Component */
/** @typedef {import('@harness/context').Budget} Budget */

/** A fixed moment: every golden must be reproducible, and a clock is not. */
export const AT = 1_750_000_000_000

export const PROVIDERS = /** @type {const} */ (['openai', 'anthropic', 'gemini'])
export const KINDS = /** @type {const} */ (['text', 'image', 'tools', 'thinking'])

/**
 * The three budgets, and the middle one is the whole point: `unbudgeted` shows
 * the paper whole, `impossible` shows what survives when nothing fits, and
 * `tight` is the one that actually bites and has to choose.
 * @type {Record<string, Budget>}
 */
export const BUDGETS = {
  unbudgeted: UNLIMITED_BUDGET,
  tight: { maxTokens: 200 },
  impossible: { maxTokens: 24 },
}

/**
 * A real PNG header and nothing after it: 24 bytes, the IHDR the sizer reads,
 * and a declared 1600×1200 that the three image rules disagree about by ~3x.
 * A whole photograph would put 230 KB of base64 in twelve golden files to
 * prove a fact two numbers already prove.
 * @param {number} width @param {number} height
 */
function pngHeader(width, height) {
  const be = (/** @type {number} */ n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
  const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be(13), 0x49, 0x48, 0x44, 0x52, ...be(width), ...be(height)]
  return btoa(String.fromCharCode(...bytes))
}

/**
 * A block this package does not define, at a slot it was never compiled for —
 * a browser faculty's page snapshot. It is here rather than in `blocks/`
 * because nothing in this build fills one yet, and it proves the claim
 * `slot.js` makes about open numbering: a component does not have to live in
 * this package to say where it sits.
 * @returns {Component}
 */
function page() {
  return {
    id: 'page',
    slot: SLOT.OBSERVATIONS,
    intent: 'What the page in front of this agent currently shows.',
    stability: 'volatile',
    floor: 'elided',
    priority: 6,
    cacheable: false,
    render: () => [{ type: 'image', mediaType: 'image/png', dataBase64: pngHeader(1600, 1200) }],
  }
}

/** The two tools the `tools` and `thinking` kinds are built around. */
export const TOOLS = [
  {
    name: 'read_file',
    description: 'Read one file out of the space.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'record_note',
    description: 'Keep one line across conversations.',
    parameters: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] },
  },
]

const TURNS = [
  'user: what is in the plan?',
  'assistant: reading it now',
  'result: read_file: plan.md has four steps, two of them unfinished',
  'user: summarise the unfinished ones',
]

/**
 * The paper for one kind. Every block in the library appears in all four, so
 * the goldens cover the whole vocabulary; what changes between kinds is what
 * the turn is ABOUT, which is what makes four reports rather than one.
 * @param {string} kind
 * @returns {Component[]}
 */
export function blocksFor(kind) {
  const tools = kind === 'tools' || kind === 'thinking'
  return [
    soul('# Notes\nYou are the archivist. You keep what matters.'),
    identity('archivist', "Keeps the group's record straight."),
    operatingRules(),
    goal('the plan is understood', 'every unfinished step is named'),
    affordances(tools ? TOOLS.map((t) => `${t.name}(...): ${t.description}`) : []),
    memory(['the plan lives at plan.md']),
    space({ name: 'atelier', path: '/spaces/atelier', durable: true, facts: [['owner', 'kaush']], notes: ['plan.md rewritten'] }, ['find_files']),
    environment('2025-06-15 14:26 UTC, Europe/London, a browser tab', tools ? 'a Linux you can run commands in' : ''),
    task('summarise the unfinished steps of the plan'),
    history(TURNS),
    observations(['read_file: plan.md, 4 steps']),
    directive(kind === 'thinking' ? 'Reason about the plan before you answer.' : ''),
    ...(kind === 'image' ? [page()] : []),
    contractFor(kind),
  ]
}

/** @param {string} kind */
function contractFor(kind) {
  if (kind === 'tools') return toolEnvelope()
  if (kind === 'thinking') {
    return shaped({
      about: 'A verdict on whether the plan is understood.',
      fields: [
        { name: 'VERDICT', about: 'one word, pass or fail' },
        { name: 'WHY', about: 'one sentence naming the evidence' },
      ],
    })
  }
  return prose()
}

/**
 * The card, read through `modelCard` so a golden is billed by the same path an
 * install is. Vision is declared only where the turn has an image and
 * reasoning only where it has thinking: an undeclared modality is one this
 * build does not send.
 * @param {string} provider @param {string} kind
 */
export function cardFor(provider, kind) {
  return modelCard(`${provider}-fixture`, {
    model: `${provider}/fixture-1`,
    kind: provider,
    context_tokens: 8192,
    max_output_tokens: 1024,
    accepts_images: kind === 'image',
    reasons: kind === 'thinking',
  })
}

/**
 * One earlier assistant turn to replay, in THIS provider's own opaque echo
 * material. There is no neutral spelling of it — that is the point of
 * `ownReplay` — so the fixture is per provider.
 * @param {string} provider @param {string} kind
 * @returns {import('@harness/context').Exchange[]}
 */
export function replayFor(provider, kind) {
  if (kind !== 'tools' && kind !== 'thinking') return []
  const calls = [{ id: 'call_1', tool: 'read_file', args: '{"path":"plan.md"}' }]
  const results = [{ id: 'call_1', output: 'plan.md: 4 steps, 2 unfinished' }]
  const reasoning = 'The plan file is the only source; read it before answering.'
  /** @type {Record<string, unknown>} */
  const replayState = {
    openai: { reasoning },
    anthropic: { content: [{ type: 'thinking', thinking: reasoning, signature: 'sig-fixture' }] },
    gemini: { parts: [{ text: reasoning, thoughtSignature: 'sig-fixture' }] },
  }
  return [{ provider, model: `${provider}/fixture-1`, text: '', calls, results, replayState: replayState[provider] }]
}

/**
 * One cell of the matrix: the document, and the body a provider would receive.
 * @param {string} provider @param {string} budget @param {string} kind
 */
export function cell(provider, budget, kind) {
  const adapter = adapterFor(provider)
  const card = cardFor(provider, kind)
  const doc = assemble(paperOf('work', blocksFor(kind), AT), BUDGETS[budget] ?? UNLIMITED_BUDGET, adapter.images)
  const tools = kind === 'tools' || kind === 'thinking' ? TOOLS : []
  return { doc, body: adapter.buildRequest(doc, card, tools, { replay: replayFor(provider, kind), temperature: 0.2 }) }
}
