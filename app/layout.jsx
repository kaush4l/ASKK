import '../src/workbench/workbench.css'
import '@xterm/xterm/css/xterm.css'
import BootDiagnostic from './BootDiagnostic.jsx'

export const metadata = {
  title: 'ASKK — Your ideas, in motion',
  description: 'A browser-owned agent workbench. Build with files, tools, and a team of agents.',
}
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' }

export default function RootLayout({ children }) {
  return <html lang="en" suppressHydrationWarning><body><BootDiagnostic />{children}</body></html>
}
