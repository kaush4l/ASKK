import { isProblem } from '@harness/kernel'

import { Attention, Fleet, Glance } from '@/components/views/dashboard'
import { Chat } from '@/components/views/chat'
import { View } from '@/components/views'
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
 * IT TAKES RESPONSES AND NOT DATA, because a screen COMPOSES PANES and a pane
 * can fail on its own. A build that serves `/chat` and not `/` is a real state
 * of this system, and the previous shape — two projections, both assumed
 * present — meant one 404 replaced the whole screen including the transcript
 * that had projected perfectly well.
 *
 * @param {{roster: import('@harness/kernel').Response,
 *          transcript: import('@harness/kernel').Response,
 *          onSend?: (text: string) => void}} props
 */
export function Work({ roster, transcript, onSend }) {
  const noRoster = isProblem(roster)
  return (
    <div className={s.work}>
      {noRoster ? <View view={roster.view} data={roster.data} /> : <Attention data={shaped(roster.data)} />}
      {isProblem(transcript)
        ? <View view={transcript.view} data={transcript.data} />
        : <Chat data={shaped(transcript.data)} onSend={onSend} />}
      {noRoster ? null : (
        <>
          <Glance data={shaped(roster.data)} />
          <Fleet data={shaped(roster.data)} />
        </>
      )}
    </div>
  )
}

/**
 * THE ONE NARROWING THIS FILE DOES, and it is the same one the view registry
 * writes down: the seam types `data` as `Record<string, unknown>` and each
 * component declares the shape ITS view carries. Narrowing here would mean a
 * second copy of every projection's shape living in the interface, which is the
 * defect the registry exists to remove.
 * @param {Record<string, unknown>} data
 * @returns {any} the written reason is the paragraph above, not the signature.
 */
function shaped(data) {
  return data
}
