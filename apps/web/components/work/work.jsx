import { Attention, Fleet, Glance } from '@/components/views/dashboard'
import { Chat } from '@/components/views/chat'
import s from './work.module.css'

/**
 * THE WORK SCREEN — the act this product exists for, and the two questions
 * around it.
 *
 * The order is the argument. Which agent needs me is FIRST, in a band only that
 * group can fill, so it is above the fold however many agents exist. The
 * transcript and the composer are SECOND, because saying the next thing is what
 * a person opened this page to do — a screen that puts four status panels above
 * the text box is a dashboard wearing a chat client's name. Everything else —
 * the four numbers, the rest of the fleet — is below both, where a person goes
 * looking rather than lands.
 *
 * It composes PANES it does not own: `dashboard` and `chat` are two projections
 * the seam produces (docs/SEAM.md), and this file decides only where they sit.
 *
 * @param {{roster: import('@/components/views/dashboard').DashboardData,
 *          transcript: import('@/components/views/chat').ChatData}} props
 */
export function Work({ roster, transcript }) {
  return (
    <div className={s.work}>
      <Attention data={roster} />
      <Chat data={transcript} />
      <Glance data={roster} />
      <Fleet data={roster} />
    </div>
  )
}
