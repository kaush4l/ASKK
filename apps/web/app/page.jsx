/**
 * Scaffold. The FACE lane replaces this with the real shell; it exists so the
 * static export has a route to build and the deploy gate has an index.html to
 * check the base path against.
 */
export default function Page() {
  return (
    <main style={{ padding: '4rem 1.5rem', maxWidth: '42rem', margin: '0 auto' }}>
      <h1 style={{ fontSize: '2rem', margin: 0 }}>HARNESS</h1>
      <p style={{ opacity: 0.7 }}>The JavaScript rewrite is being assembled. This page is scaffolding.</p>
    </main>
  )
}
