/**
 * The one document. Everything below it is a client component, because the
 * whole application is a state machine that runs in the browser — there is no
 * server to render against (I1), so a server component here would render a
 * shell it cannot fill.
 */
import './globals.css'

export const metadata = {
  title: 'HARNESS',
  description: 'A personal agent harness that runs entirely in your browser.',
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f7f5' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0f12' },
  ],
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
