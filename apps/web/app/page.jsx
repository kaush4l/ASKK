import { Shell } from '@/components/shell/shell'
import { Work } from '@/components/work/work'
import { chat } from '@/fixtures/transcript'
import { dashboard } from '@/fixtures/run'

/**
 * WORK, at `/`. The run and the whole of it: which agent needs you, the
 * transcript you type into, every tool call, and the fleet under both.
 *
 * The route declares WHICH destination it is rather than the shell inferring it
 * from the path — a page that names a slug the table does not list throws at
 * render instead of quietly becoming Work.
 *
 * THE PROJECTIONS ARE FIXTURES, and they are imported here rather than reached
 * for inside a component so that wiring the seam is one edit in one file: these
 * two names become `handle(app, request).data` and nothing below this line
 * changes (increment 4).
 */
export default function Page() {
  return (
    <Shell slug="">
      <Work roster={dashboard} transcript={chat} />
    </Shell>
  )
}
