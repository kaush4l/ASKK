import { Shell } from '@/components/shell/shell'
import { LiveSetup } from '@/components/setup/live-setup'

/**
 * SETUP, at `/setup/`. Named Setup rather than Settings because it is the
 * address of a model server and not a page of preferences.
 */
export default function Page() {
  return (
    <Shell slug="setup">
      <LiveSetup />
    </Shell>
  )
}
