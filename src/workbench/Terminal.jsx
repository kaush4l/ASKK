'use client'
import { useEffect, useRef } from 'react'
import { Terminal as Xterm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { terminalOutputDelta } from './terminal-output.js'

export default function Terminal({ controller, sessionId, output = '', outputLength, theme = 'dark', interactive = false }) {
  const node = useRef(null)
  const instance = useRef(null)
  const written = useRef('')
  const writtenLength = useRef(0)
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
    written.current = ''
    writtenLength.current = 0
    let live = true
    const resize = () => { if (!live || !node.current?.clientWidth || !node.current?.clientHeight) return; fit.fit(); if (interactive && sessionId) controller?.resizeTerminal?.(sessionId, terminal.cols, terminal.rows) }
    const observer = new ResizeObserver(resize)
    observer.observe(node.current)
    resize()
    const input = terminal.onData(data => { if (interactive && sessionId) controller?.terminalInput?.(sessionId, data) })
    const unsubscribe = interactive && sessionId ? controller?.subscribeTerminal?.(sessionId, chunk => terminal.write(typeof chunk === 'string' ? chunk : chunk.data || chunk.output || '')) : null
    return () => { live = false; observer.disconnect(); input.dispose(); unsubscribe?.(); terminal.dispose(); instance.current = null }
  }, [controller, sessionId, interactive, theme])
  useEffect(() => {
    if (!instance.current || interactive) return
    const text = String(output)
    const delta = terminalOutputDelta(written.current, text, { previousLength: writtenLength.current, outputLength })
    if (delta.reset) instance.current.reset()
    if (delta.text) instance.current.write(delta.text)
    written.current = text
    writtenLength.current = outputLength
  }, [controller, output, outputLength, sessionId, theme, interactive])
  return <div className="terminal-viewport" ref={node} aria-label={interactive ? 'Interactive terminal' : 'Command output'}/>
}
