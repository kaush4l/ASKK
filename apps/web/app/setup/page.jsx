import { Shell } from '@/components/shell/shell'

/**
 * SETUP, at `/setup/`. Named Setup rather than Settings because it is the
 * address of a model server and not a page of preferences.
 */
export default function Page() {
  return <Shell slug="setup" />
}
