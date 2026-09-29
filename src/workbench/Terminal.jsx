'use client'
import { useEffect, useRef } from 'react'
import { Terminal as Xterm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { createTerminalSnapshotWriter } from './terminal-writer.js'

export default function Terminal({ controller, sessionId, output = '', outputLength, theme = 'dark', interactive = false, onError }) {
  const node = useRef(null)
  const instance = useRef(null)
  const writer = useRef(null)
  const errors = useRef(onError)
  errors.current = onError
  useEffect(() => {
    const terminal = new Xterm({
      cursorBlink: interactive, disableStdin: !interactive, convertEol: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12,
      lineHeight: 1.35, scrollback: 5000, screenReaderMode: true,
      theme: theme === 'dark' ? { background: '#141619', foreground: '#c7cbd1', cursor: '#d4a373', selectionBackground: '#3e4652' } : { background: '#ffffff', foreground: '#333840', cursor: '#955f30', selectionBackground: '#d9e5ef' },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(node.current)
    instance.current = terminal
    const delivery = interactive ? null : createTerminalSnapshotWriter(terminal)
    writer.current = delivery
    let live = true
    const send = action => { try { Promise.resolve(action()).catch(error => { if (live) errors.current?.(error?.message || String(error)) }) } catch (error) { if (live) errors.current?.(error?.message || String(error)) } }
    const resize = () => { if (!live || !node.current?.clientWidth || !node.current?.clientHeight) return; fit.fit(); if (interactive && sessionId) send(() => controller?.resizeTerminal?.(sessionId, terminal.cols, terminal.rows)) }
    const observer = new ResizeObserver(resize)
    observer.observe(node.current)
    resize()
    const input = terminal.onData(data => { if (interactive && sessionId) send(() => controller?.terminalInput?.(sessionId, data)) })
    const unsubscribe = interactive && sessionId ? controller?.subscribeTerminal?.(sessionId, chunk => {
      if (chunk?.type === 'error') { const message = chunk.error || 'Terminal connection failed'; terminal.writeln(`\r\n[${message}]`); terminal.options.disableStdin = true; errors.current?.(message) }
      else if (chunk?.type === 'exit' || chunk?.type === 'terminal.exit') { terminal.writeln(`\r\n[Terminal exited${Number.isInteger(chunk.code) ? ` with code ${chunk.code}` : ''}]`); terminal.options.disableStdin = true }
      else terminal.write(typeof chunk === 'string' ? chunk : chunk.data || chunk.output || '')
    }) : null
    return () => { live = false; observer.disconnect(); input.dispose(); unsubscribe?.(); delivery?.dispose(); terminal.dispose(); writer.current = null; instance.current = null }
  }, [controller, sessionId, interactive, theme])
  useEffect(() => {
    if (!instance.current || interactive) return
    writer.current?.update(output, outputLength)
  }, [controller, output, outputLength, sessionId, theme, interactive])
  return <div className="terminal-viewport" ref={node} aria-label={interactive ? 'Interactive terminal' : 'Command output'}/>
}
