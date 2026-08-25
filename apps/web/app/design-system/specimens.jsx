import { Badge } from '@/components/ui/badge'
import { Composer } from '@/components/ui/composer'
import { GLYPH_STATES } from '@/components/ui/glyph'
import { Inspector } from '@/components/ui/inspector'
import { Markdown } from '@/components/ui/markdown'
import { Ring } from '@/components/ui/ring'
import { NEARLY_FULL, chat, reply } from '@/fixtures/transcript'
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
const CALLS = ['pending', 'calling', 'ok', 'failed'].map((status, i) => ({
  id: `call-${status}`, row: /** @type {'call'} */ ('call'), name: 'read_page', status,
  statusLabel: ['Queued behind the read', 'Running — 14s', 'Finished in 0.8s', 'Refused by the browser'][i] ?? '',
  argsLabel: 'url="https://firecrawl.dev/docs"',
  resultLabel: ['', '', 'access-control-allow-origin: *\ncontent-type: text/html',
    'No access-control-allow-origin on the response, so this page never saw the body.'][i] ?? '',
}))

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
  // TWO REFUSALS, AND THEY COME FROM DIFFERENT PLACES. The first is the
  // interface's own — a specimen has no session behind it, so nothing is
  // listening — and the second is the core's sentence, which is the one a
  // person meets when a build was assembled without the right to record facts.
  { name: 'composer — three bands, and nothing listening', node: <Composer data={chat.composer} /> },
  {
    name: 'composer — the core refused it',
    node: <Composer data={{ ...chat.composer, refusedLabel: 'This build did not grant the chat module the right to record facts, so nothing can be sent.' }} />,
  },
]
