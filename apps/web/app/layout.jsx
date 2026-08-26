/**
 * THE DOCUMENT. Everything below it is a client component, because the whole
 * application is a state machine that runs in the browser — there is no server
 * to render against (I1), so a server component here would render a shell it
 * cannot fill.
 */
import { THEME_BOOT } from '@/components/shell/theme-boot'
import './globals.css'
import '../styles/base.css'
import '../styles/motion.css'
/* THE FOUR DIRECTIONS, AFTER THE ROOM AND ON PURPOSE. Each is written as
   `:root[data-direction=…]`, which is two selectors where `[data-theme=…]` is
   one, so a direction outranks the room by specificity and the import order is
   not what is load-bearing — but a reader should not have to work that out from
   a specificity table, so they are last as well. */
import '../styles/directions/halo.css'
import '../styles/directions/console.css'
import '../styles/directions/gallery.css'
import '../styles/directions/atelier.css'

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

/** @param {{children: React.ReactNode}} props */
export default function RootLayout({ children }) {
  return (
    // `suppressHydrationWarning` because the script below stamps `data-theme`
    // on this element before React sees it, which is the whole point of it.
    <html lang="en" suppressHydrationWarning>
      {/* A BARE, SYNCHRONOUS SCRIPT, and it has to be all three words.
          `next/script`'s `beforeInteractive` only PUSHES this onto a queue the
          Next runtime drains, which is after the first paint — measured in the
          export, which is the whole reason this is not that.
          `dangerouslySetInnerHTML` does not appear in this tree at all (I5):
          React renders a string child of `<script>` as its body, and React 19
          hoists the element into the head itself.

          AND THERE IS NO `<head>` ELEMENT AROUND IT, WHICH IS NOT A STYLE
          CHOICE. A manual `<head>` in an App Router root layout stops Next's
          client runtime from starting — SILENTLY. Measured against 16.3.2:
          `window.next` was `undefined`, every chunk had loaded 200, the
          Turbopack runtime had run, and there was no console error, no warning
          and no rejection. Removing this one element is what put `window.next`
          back and let React hydrate. */}
      <script>{THEME_BOOT}</script>
      <body>{children}</body>
    </html>
  )
}
