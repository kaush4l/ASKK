import { Instrument_Sans, JetBrains_Mono } from 'next/font/google'
import './globals.css'

/**
 * Two faces, chosen for what this page is.
 *
 * Instrument Sans carries the interface. JetBrains Mono carries every number,
 * every label and every piece of the prompt, and it is here for one property
 * above all: tabular figures. A token count that shifts sideways as it changes
 * is a readout you cannot read at a glance, which defeats the point of showing
 * one. Two families, no third — the wordmark takes its character from how it is
 * set rather than from a face bought in for the occasion.
 *
 * Self-hosted at build time by `next/font`, so a static export makes no request
 * to a font CDN and the page has no third-party dependency at runtime.
 */
/*
 * `preload: false` on both, measured rather than assumed. Next emits a preload
 * link for every face it generates, and this page loads exactly one face per
 * family — the browser reported the rest as "preloaded but not used", which is
 * bandwidth spent on files nobody reads. Without the preloads the used face
 * still arrives, one beat later, from the stylesheet; `display: swap` and Next's
 * metric-matched fallback mean that beat costs a repaint and not a reflow.
 */
const sans = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
  preload: false,
})

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
  preload: false,
})

// No hand-written <head> here. Writing one stops Next injecting its own client
// runtime, and the page then renders once and does nothing for ever after —
// with no error anywhere. Metadata goes through this export instead.
export const metadata = {
  title: 'ASKK',
  description: 'A personal agent that runs in the browser.',
}

// Dark by design, and declared so the browser paints its own furniture — form
// controls, scrollbars, the address bar on a phone — to match rather than
// flashing white around a dark page.
export const viewport = {
  themeColor: '#070a0e',
  colorScheme: 'dark',
  // The composer sits against the bottom edge, so the page has to be allowed to
  // reach under the home indicator and pad itself back out.
  viewportFit: 'cover',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
