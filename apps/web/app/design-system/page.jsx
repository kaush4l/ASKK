import { Shell } from '@/components/shell/shell'

/**
 * THE DESIGN SYSTEM, at `/design-system/`. Deliberately not in the nav and not
 * linked from the product: an internal gallery reached by address, carrying a
 * crumb back. It is a real route because the address has to resolve.
 */
export default function Page() {
  return <Shell slug="design-system" />
}
