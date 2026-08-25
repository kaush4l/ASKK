'use client'

import { Problem } from '@/components/views/problem'

/**
 * A CLIENT EXCEPTION, SAID OUT LOUD.
 *
 * Next has a default boundary and it renders "This page couldn't load" with a
 * Reload button and NOTHING ELSE — no message, no stack, nothing in the console
 * either, because a production build routes the throw here instead. A whole
 * round of this project was spent finding a one-line TypeError that this file
 * would have printed on the screen the moment it happened.
 *
 * The three sentences are the FACE's own, for the same reason `lib/session.js`
 * words a failed boot: what threw is a component in this tree, so there is no
 * core on the other side of the seam to have worded it. `detail` is the error's
 * own message and never a sentence composed around it (I5).
 *
 * @param {{error: Error & {digest?: string}}} props `reset` is deliberately not
 *   taken: what threw is a render, and re-rendering the same state throws
 *   again. A reload is the only thing that changes anything, and the browser
 *   already has that control.
 */
export default function ErrorScreen({ error }) {
  return (
    <Problem
      data={{
        id: error?.digest ?? '',
        kind: 'render_failed',
        message: 'Something on this page threw while it was being drawn, so the page stopped here.',
        detail: error?.message ?? '',
        repair: 'Reload the page. Nothing was lost: everything this page shows is read from the log, and nothing here writes to it.',
      }}
      subject={error?.name ?? ''}
    />
  )
}
