import { Archivo, JetBrains_Mono } from 'next/font/google'
import './globals.css'

/**
 * Two faces, chosen for what this page is.
 *
 * Archivo carries the interface. It is an industrial grotesque with tight
 * apertures and a real weight axis, and it is here because this page is an
 * instrument rather than a website — it holds up at 12px, which is where the
 * whole evidence register lives. JetBrains Mono carries every number,
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
const sans = Archivo({
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

// Declared so the browser paints its own furniture — form controls, scrollbars,
// the address bar on a phone — to match the page rather than flashing the
// opposite scheme around it.
export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0c0e11' },
    { media: '(prefers-color-scheme: light)', color: '#f4f2ed' },
  ],
  // Both, and the tokens in `globals.css` define both. Someone who has told
  // their operating system whether they want light or dark has already answered
  // this question, so there is no toggle in the app: a preference stored in two
  // places disagrees in one of them.
  colorScheme: 'dark light',
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
