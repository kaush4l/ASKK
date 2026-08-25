'use client'

import { get } from '@harness/kernel'

import { Empty } from '@/components/ui/empty'
import { View } from '@/components/views'
import { BOOTING } from '@/lib/copy'
import { useSession, useProjection } from './use-session'
import s from './shell.module.css'

/**
 * THE INSTRUMENTS COLUMN — what else you need while you are doing this, and as
 * of this increment it holds something.
 *
 * It is rendered only where it has something to say (`Destination.rail`, which
 * is Work and nowhere else), and ABSENT rather than present-and-empty
 * elsewhere: the predecessor shipped a header switch reading `Hide workspace
 * files` with `aria-expanded="true"` over a `#rail` that was `display: none` at
 * 0×0 — a dead control reporting a state it did not have. For two increments
 * this column was that dead control's quieter cousin: two sentences promising a
 * folder, over no folder.
 *
 * It is named for what is IN it and never for its geometry: it wore `Side panel
 * · main` once, a region named after itself, which tells a reader nothing they
 * cannot already see.
 *
 * A FAILURE HERE IS NOT THE SCREEN FAILING. The folder pane says what went
 * wrong in its own column and the transcript beside it keeps working — a build
 * with no workspace is a build a person can still talk to.
 *
 * @param {{subject: string}} props
 */
export function Rail({ subject }) {
  return (
    <aside className={s.rail} aria-label={NOUN}>
      <p className={s.railWho}>
        {NOUN} · <strong>{subject}</strong>
      </p>
      <Folder />
    </aside>
  )
}

function Folder() {
  const session = useSession()
  if (!session) return <Empty note={BOOTING} />
  if (session.problem) return <View view="problem" data={session.problem} />
  return <Listing session={session} />
}

/** @param {{session: import('@/lib/session').Session}} props */
function Listing({ session }) {
  const folder = useProjection(session, get('/files'))
  return <View view={folder.view} data={folder.data} />
}

/** Named for its CONTENTS and not its position (DESIGN.md §11, R8-7). */
const NOUN = 'folder'
