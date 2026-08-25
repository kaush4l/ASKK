/**
 * THE DOCUMENT. Everything below it is a client component, because the whole
 * application is a state machine that runs in the browser — there is no server
 * to render against (I1), so a server component here would render a shell it
 * cannot fill.
 */
import { THEME_BOOT } from '@/components/shell/theme-boot'
import './globals.css'
import '../styles/base.css'

export const metadata = {
  title: 'HARNESS',
  description: 'A personal agent harness that runs entirely in your browser.',
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // The two grounds, so the browser's own chrome matches the room. These are
  // `--ground` from both palettes; they are literals because a meta tag cannot
  // read a custom property.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f3eefa' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0611' },
  ],
}

/**
 * `unknown` and not `React.ReactNode`: this tree has no React type declarations
 * yet — see the FACE lane's request in STATUS.md — and naming a namespace that
 * does not resolve is a type that reads as checked and is not.
 * @param {{children: unknown}} props
 */
export default function RootLayout({ children }) {
  return (
    // `suppressHydrationWarning` because the script below stamps `data-theme`
    // on this element before React sees it, which is the whole point of it.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* A BARE, SYNCHRONOUS SCRIPT, and it has to be all three words.
            `next/script`'s `beforeInteractive` only PUSHES this onto a queue the
            Next runtime drains, which is after the first paint — measured in
            the export, which is the whole reason this is not that.
            `dangerouslySetInnerHTML` does not appear in this tree at all (I5):
            React renders a string child of `<script>` as its body. */}
        <script>{THEME_BOOT}</script>
      </head>
      <body>{children}</body>
    </html>
  )
}
