/**
 * ApprovalCard and ApprovalRecord (UX U5.5). One card per pending approval, shown in up to
 * three places with one shared state: the transcript, the Runs panel, the thread view.
 * Answering in one place answers everywhere.
 */

import { add, h, mono } from './dom.js'
import { clock } from './time.js'

const shared = new Map() // approval id → {note, always, unfolded}
const cards = new Map() // `${id}:${place}` → element

function stateOf(id) {
  if (!shared.has(id)) shared.set(id, { note: '', always: false, unfolded: { value: false } })
  return shared.get(id)
}

/** The card for one pending approval, reused across repaints so a half-typed note survives. */
export function approvalCard(state, approval, place) {
  const key = `${approval.id}:${place}`
  let card = cards.get(key)
  if (!card) {
    card = build(state, approval, place)
    cards.set(key, card)
  }
  card.update()
  return card
}

function build(state, approval, place) {
  const own = stateOf(approval.id)
  const lines = String(approval.call ?? '').split('\n').length
  if (lines <= 12) own.unfolded.value = true

  const allow = h('button', { type: 'button', class: 'primary half', testid: 'approval-allow' }, 'Allow')
  const deny = h('button', { type: 'button', class: 'half', testid: 'approval-deny' }, 'Deny')
  const status = h('span', { class: 'faint small' })
  const waiting = h('span', { class: 'num faint small', dataset: { tick: 'since', t0: String(approval.at), prefix: 'waiting ' } })
  const note = h('input', { type: 'text', class: 'field full', 'aria-label': `Note to ${approval.agent} (optional)`, placeholder: `Note to ${approval.agent} (optional)` })
  note.value = own.note
  note.addEventListener('input', () => (own.note = note.value))
  const always = h('input', { type: 'checkbox', id: `always-${approval.id}-${place}` })
  always.checked = own.always
  const callBlock = mono(approval.call, { lines: 12, open: own.unfolded, wrap: true, onOpen: () => card.update() })
  callBlock.tabIndex = -1
  callBlock.classList?.add('approval-call')

  const answer = (approved) => {
    state.sending.set(approval.id, { always: approved && own.always })
    card.update()
    let ok = false
    try {
      ok = state.hub.approvalsApi.answer(approval.id, { approved, note: own.note.trim(), always: approved && own.always })
    } catch {
      ok = false
    }
    if (!ok && state.sending.has(approval.id)) {
      state.sending.set(approval.id, { failed: true })
      card.update()
    }
  }
  allow.addEventListener('click', () => answer(true))
  deny.addEventListener('click', () => answer(false))
  always.addEventListener('change', () => {
    own.always = always.checked
    card.update()
  })

  const card = h(
    'section',
    { class: 'approval', testid: 'approval', 'aria-label': `${approval.agent} wants to call ${approval.tool}` },
    h(
      'div',
      { class: 'approval-head' },
      h('strong', {}, `${approval.agent} wants to call ${approval.tool}`),
      h('span', { class: 'approval-meta' }, h('span', { class: 'mono' }, approval.risk ?? ''), ` · asked ${clock(approval.at)}`),
    ),
    callBlock,
    h('p', { class: 'dim small' }, `Asked because: ${approval.reason ?? ''}`),
    note,
    h('label', { class: 'check', for: `always-${approval.id}-${place}` }, always, ` Always allow ${approval.tool} for ${approval.agent}`),
    h('p', { class: 'faint small' }, 'Adds a rule in Settings → Permissions.'),
    h('div', { class: 'approval-actions' }, allow, deny, h('span', { class: 'grow' }), status, waiting),
  )
  card.focusCall = () => (callBlock.querySelector?.('pre') ?? callBlock).focus?.()
  card.update = () => {
    const follower = !state.leader()
    const sending = state.sending.get(approval.id)
    const blocked = follower || (sending && !sending.failed)
    allow.textContent = own.always ? 'Always allow' : 'Allow'
    allow.disabled = blocked || !own.unfolded.value
    deny.disabled = blocked
    note.disabled = blocked
    always.disabled = blocked
    status.textContent = follower ? 'Answer in the other tab.' : sending?.failed ? 'Could not send your answer. Try again.' : sending ? 'Sending…' : ''
    status.className = sending?.failed ? 'bad small' : 'faint small'
  }
  return card
}

/** The one line an answered approval leaves behind. */
export function approvalRecord(decision) {
  const approval = decision.approval ?? {}
  const agent = approval.agent ?? 'the run'
  let text
  let cls = 'record small dim'
  if (decision.by === 'system') {
    text = `No longer needed — ${agent} stopped.`
    cls = 'record small faint'
  } else if (!decision.approved) text = `You denied ${approval.tool} · ${clock(decision.at)}`
  else if (decision.always) text = `You always allowed ${approval.tool} for ${agent} · ${clock(decision.at)}`
  else text = `You allowed ${approval.tool} · ${clock(decision.at)}`
  if (decision.by !== 'system' && decision.note) text += ` · note: "${decision.note}"`
  return h('p', { class: cls, testid: 'approval-record' }, text)
}

export function forgetCard(id) {
  for (const key of [...cards.keys()]) if (key.startsWith(`${id}:`)) cards.delete(key)
  shared.delete(id)
}
