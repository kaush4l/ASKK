'use client'

import { useEffect, useState } from 'react'

export default function Page() {
  // Proof the client runtime is alive, not just that HTML was produced. A static
  // export that never hydrates looks identical to one that does until you check.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])

  return (
    <main>
      <h1>ASKK</h1>
      <p>Skeleton. Bun + Next {process.env.NEXT_PUBLIC_VERSION ?? '15'}, static export, served from a subpath.</p>
      <hr />
      <p data-testid="hydration">
        client runtime: <code>{hydrated ? 'hydrated' : 'server HTML only'}</code>
      </p>
    </main>
  )
}
