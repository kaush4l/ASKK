// Next 16's implicit /_not-found page fails to resolve under `output: 'export'`
// (PageNotFoundError at the export step), so the route is declared here instead.
// The export writes this to 404.html, which is exactly the file GitHub Pages
// serves for an unknown path — so the deploy gets a real 404 rather than one
// synthesised by whatever local server happens to be under a check.
export default function NotFound() {
  return (
    <main>
      <h1>404</h1>
      <p>No such page.</p>
    </main>
  )
}
