import { Shell } from '@/components/shell/shell'

/**
 * WORK, at `/`. The run and the whole of it: the transcript, the loop's walk,
 * every tool call, the shell and the folder, in one scroller.
 *
 * The route declares WHICH destination it is rather than the shell inferring it
 * from the path — a page that names a slug the table does not list throws at
 * render instead of quietly becoming Work.
 */
export default function Page() {
  return <Shell slug="" />
}
