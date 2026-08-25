import { Shell } from '@/components/shell/shell'
import { LiveWork } from '@/components/work/live-work'

/**
 * WORK, at `/`. The run and the whole of it: which agent needs you, the
 * transcript you type into, every tool call, and the fleet under both.
 *
 * The route declares WHICH destination it is rather than the shell inferring it
 * from the path — a page that names a slug the table does not list throws at
 * render instead of quietly becoming Work.
 *
 * THE FIXTURES ARE GONE FROM THIS FILE and the seam is in their place. They
 * were imported HERE, one line each, precisely so that wiring the core was one
 * edit in one file — and this is that edit. They live on in `/design-system/`,
 * where a fixture is what a critic looks at, and in the tests.
 */
export default function Page() {
  return (
    <Shell slug="">
      <LiveWork />
    </Shell>
  )
}
