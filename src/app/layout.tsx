import type { Metadata } from 'next'
import './globals.css'

// No hand-written <head> here. Writing one stops Next injecting its own client
// runtime, and the page then renders once and does nothing for ever after —
// with no error anywhere. Metadata goes through this export instead.
export const metadata: Metadata = {
  title: 'ASKK',
  description: 'A personal agent that runs in the browser.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
