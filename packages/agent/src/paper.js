/**
 * THE COMPONENTS THE LOOP FILLS IN. `packages/context` decides what a component
 * IS — an id, a slot, an intent and a `render` — and this file says what the
 * loop has to put in one: the toolbox this call actually granted, what is being
 * attempted, what the last round of tools returned, the stage's brief, and the
 * shape the reply must take.
 *
 * WHY THESE AND NOT THE WHOLE PROMPT. Every block here is a function of THIS
 * TURN and THIS STAGE'S GRANT. The stable head — the soul, the identity, the
 * conversation — is written into the paper once, by whoever adopted the agent
 * or by the host that owns the window; rebuilding it per call would be a second
 * author for words that are not the loop's.
 *
 * The `## id (intent)` frame is inherited, so a component with nothing to say
 * returns NO parts and the whole block disappears. An agent that has kept
 * nothing has no memory heading — not a memory heading with nothing under it,
 * which reads to a model as an empty memory rather than as a faculty it does
 * not have.
 * @module
 */

import { SLOT, text } from '@harness/context'

/** @typedef {import('@harness/context').Component} Component */
/** @typedef {import('@harness/context').Part} Part */
/** @typedef {import('./faculty/index.js').Block} Block */
/** @typedef {import('./state.js').AgentState} AgentState */

/**
 * WHO THIS AGENT IS, in its own file's words — the pinned head, because an
 * agent must be someone before it is told anything. The body of `agent.md`
 * verbatim: nothing here composes prose about the agent, it only places what
 * the author wrote.
 *
 * A file with an empty body renders NO parts, and the block elides. That is a
 * real state and it says so structurally: an agent with no soul is asked
 * nothing about itself rather than being handed a heading with silence under
 * it.
 * @param {string} prompt @returns {Component}
 */
export function soul(prompt) {
  return {
    id: 'soul',
    slot: SLOT.SOUL,
    intent: 'Who you are.',
    stability: 'static',
    floor: 'full',
    priority: 0,
    render: () => text(prompt),
  }
}

/**
 * How to write calls. A constant beside the block that emits it because the
 * reply parser is built to this exact description — the sentence and the
 * scanner are one contract in two places, and they move together.
 */
const HOW_TO_CALL = 'Call them exactly as written above. Calls that do not depend on each other '
  + 'go on one line, separated by commas, and run at the same time. A call that needs an '
  + 'earlier call\'s result goes on its own line — lines run in order, top to bottom. Results '
  + 'come back labelled with the tool name, in the order you wrote the calls.'

/**
 * WHAT EXISTS AND HOW TO CALL IT, from the lines the granted toolbox generates.
 * Nothing here is prose about tools: it is the literal shape of a call, one per
 * line, because a model copies what it sees.
 *
 * `floor: 'pointer'` and priority 3: an agent's toolbox changes far less often
 * than its conversation, so it stays inside the cacheable head.
 * @param {readonly string[]} usages @returns {Component}
 */
export function affordances(usages) {
  return {
    id: 'affordances',
    slot: SLOT.AFFORDANCES,
    intent: 'What exists and how to call it.',
    stability: 'semi_static',
    floor: 'pointer',
    priority: 3,
    render: () => text(usages.length === 0
      ? 'No tools are installed; answer from what you know.'
      : `AVAILABLE TOOLS\n\n${usages.join('\n')}\n\n${HOW_TO_CALL}`),
  }
}

/**
 * ONE FACULTY'S BLOCK, RENDERED FROM WHAT A HOST LAST WROTE FOR IT. The block
 * declares where it goes and why; the parts are `AgentState.senses[id]`, which
 * is the slot where an impure host leaves fresh data for a pure component. No
 * parts is a faculty that has nothing to say YET, and it elides — which is a
 * different thing from a faculty this agent does not have, and that one has no
 * block at all.
 * @param {Block} block @param {readonly unknown[]} parts @returns {Component}
 */
export function sensed(block, parts) {
  return {
    ...block,
    cacheable: false,
    render: () => /** @type {Part[]} */ ([...parts]),
  }
}

/** What is being attempted right now. Null is idle, and an idle agent is not being asked anything. @param {string | null} task @returns {Component} */
export function taskBlock(task) {
  return {
    id: 'task',
    slot: SLOT.TASK,
    intent: 'What is being attempted right now.',
    stability: 'dynamic',
    cacheable: false,
    render: () => text(task ?? ''),
  }
}

/**
 * THE LAST ROUND'S RESULTS, one line each, in the order the model WROTE the
 * calls. An array and not one upserted line: three calls on one line produced
 * three overwrites in the predecessor and the model saw one of them.
 *
 * `volatile`, and it never caches: these are the newest thing in the paper and
 * the reason the turn is being asked again.
 * @param {readonly string[]} lines @returns {Component}
 */
export function observations(lines) {
  return {
    id: 'observations',
    slot: SLOT.OBSERVATIONS,
    intent: 'Results of the last actions.',
    stability: 'volatile',
    floor: 'pointer',
    cacheable: false,
    render: () => text(lines.join('\n')),
  }
}

/**
 * WHAT THIS TURN IS BEING ASKED TO DO — the stage's brief, as a block of its
 * own. Not a forged `user:` turn: a stage instruction written into the
 * conversation is indistinguishable from something the person said, and the
 * next compaction would summarise it as one.
 * @param {string} brief @returns {Component}
 */
export function directive(brief) {
  return {
    id: 'directive',
    slot: SLOT.DIRECTIVE,
    intent: 'What this turn is being asked to do.',
    stability: 'volatile',
    cacheable: false,
    render: () => text(brief),
  }
}

/** Answer the person, in words. The cheap exit, and the common case. */
const PROSE = 'Reply in plain prose to the user\'s message. Be concise.'

/**
 * Answer, or call tools — written as an ORDERED CHOICE rather than a menu,
 * because a model given a menu picks and a model given a rule follows it. It
 * names `## affordances`, which is the heading the frame actually writes.
 */
const ENVELOPE = 'Either answer the user in plain prose, or call tools by writing the calls '
  + 'exactly as the `## affordances` block shows them and nothing else. Results come back on '
  + 'lines beginning `Result:` — read them, then answer.'

/**
 * THE PINNED LAST WORD. The envelope is offered only when there is something to
 * call: telling a model it may call tools and then showing it none is an
 * invitation to invent one.
 *
 * A stage whose reply the MACHINE parses states its shape as fields instead,
 * and that overrides both — it is the one case where the shape is not a
 * property of the toolbox.
 *
 * `floor: 'full'`: a model that has lost the shape of its own reply does not
 * produce a shorter answer, it produces an unusable one.
 * @param {{hasTools: boolean, schema: {about: string, fields: Array<{name: string, about: string}>} | null}} of
 * @returns {Component}
 */
export function contract(of) {
  const body = of.schema
    ? [of.schema.about, ...of.schema.fields.map((f) => `${f.name}: ${f.about}`)].join('\n')
    : (of.hasTools ? ENVELOPE : PROSE)
  return {
    id: 'response_contract',
    slot: SLOT.RESPONSE,
    intent: 'The exact shape of the expected reply.',
    stability: 'static',
    floor: 'full',
    priority: 0,
    render: () => text(body),
  }
}
