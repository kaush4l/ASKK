import '../src/workbench/workbench.css'
import '@xterm/xterm/css/xterm.css'
import BootDiagnostic from './BootDiagnostic.jsx'

export const metadata = {
  title: 'ASKK — Your agents, in view',
  description: 'Run agents in your browser. Choose workflows and tools, review actions, and follow results in a live workspace.',
}
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' }

export default function RootLayout({ children }) {
  return <html lang="en" suppressHydrationWarning><body><BootDiagnostic />{children}</body></html>
}
