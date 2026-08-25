import { Badge } from '@/components/ui/badge'
import { Composer } from '@/components/ui/composer'
import { GLYPH_STATES } from '@/components/ui/glyph'
import { Inspector } from '@/components/ui/inspector'
import { Markdown } from '@/components/ui/markdown'
import { Ring } from '@/components/ui/ring'
import { chat, reply } from '@/fixtures/transcript'
import s from './gallery.module.css'

/**
 * THE COMPONENTS, EVERY STATE OF EACH, BESIDE THE VIEWS THAT USE THEM.
 *
 * A view specimen shows a component in the ONE state that view's projection
 * happens to carry. That is how a four-state inspector ships having been looked
 * at in two states: the fixture is a realistic transcript, and a realistic
 * transcript does not contain every state at once on purpose. So the states are
 * enumerated here, from the same vocabulary the components read.
 */

/** One tool call in each of the four states, differing only in the state. */
const CALLS = ['pending', 'working', 'ok', 'failed'].map((status, i) => ({
  id: `call-${status}`, row: /** @type {'call'} */ ('call'), name: 'read_page', status,
  statusLabel: ['Queued behind the read', 'Running — 14s', 'Finished in 0.8s', 'Refused by the browser'][i] ?? '',
  argsLabel: 'url="https://firecrawl.dev/docs"',
  resultLabel: ['', '', 'access-control-allow-origin: *\ncontent-type: text/html',
    'No access-control-allow-origin on the response, so this page never saw the body.'][i] ?? '',
}))

/** A window that is nearly spent — the state the ring exists to make visible.
 *  Exported because `test/composer.test.js` lays its four arcs out and checks
 *  they are laid end to end; a second copy of it there would be a second
 *  fixture free to drift from the one a critic actually looks at. */
export const NEARLY_FULL = {
  label: '119,540 of 128,000 tokens',
  headroomLabel: '8,460 tokens before the oldest turn is dropped from the window.',
  parts: [
    { id: 'input', key: 'Input', value: '81,200 tokens', fraction: 0.634 },
    { id: 'output', key: 'Output', value: '12,410 tokens', fraction: 0.097 },
    { id: 'reasoning', key: 'Reasoning', value: '18,930 tokens, never fed back', fraction: 0.148 },
    { id: 'cached', key: 'Cached', value: '7,000 tokens, billed at a tenth', fraction: 0.055 },
  ],
}

/** @type {ReadonlyArray<{name: string, node: React.ReactNode}>} */
export const COMPONENTS = [
  {
    name: 'glyph + badge — every state this product draws a shape for',
    node: (
      <div className={s.strip}>
        {GLYPH_STATES.map((status) => <Badge key={status} status={status} label={status} />)}
      </div>
    ),
  },
  {
    name: 'inspector — pending, running, complete, failed',
    node: <div className={s.stack}>{CALLS.map((call) => <Inspector key={call.id} data={call} />)}</div>,
  },
  { name: 'markdown — every node kind the core can send', node: <Markdown blocks={reply} /> },
  { name: 'context ring — a window nearly spent', node: <Ring cost={NEARLY_FULL} /> },
  { name: 'composer — three bands, and why it cannot send', node: <Composer data={chat.composer} /> },
]
