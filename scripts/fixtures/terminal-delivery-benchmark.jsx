// Actual xterm parser/delivery experiment. This fixture does not alter the app.
import { useRef, useState } from 'react'
import { Terminal as Xterm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { createTerminalSnapshotWriter } from '../../src/workbench/terminal-writer.js'

const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
const round = value => Math.round(value * 10) / 10

export default function TerminalDeliveryBenchmark({ record }) {
  const node = useRef(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Ready')
  async function run() {
    setBusy(true)
    const source = `${Array.from({ length: 7000 }, (_, index) => `line ${String(index).padStart(6, '0')} synthetic compiler output ${'x'.repeat(42)}\n`).join('')}\nDELIVERY-FINISHED\n`.slice(-500000)
    try {
      // Repeat the single write after warm-up so its cold-start cost cannot
      // masquerade as a scheduling improvement in the candidate modes.
      for (const [sample, mode] of [500000, 16384, 4096, 500000, 'snapshot-writer'].entries()) {
        const chunkSize = typeof mode === 'number' ? mode : 4096
        setStatus(`Measuring ${mode === 'snapshot-writer' ? mode : `${chunkSize}-character writes`}`)
        const terminal = new Xterm({ disableStdin: true, convertEol: true, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, lineHeight: 1.35, scrollback: 5000, screenReaderMode: true, theme: { background: '#141619', foreground: '#c7cbd1' } })
        const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(node.current); fit.fit()
        await paint()
        const longTasks = []; const loopGaps = []
        const observer = new PerformanceObserver(list => { for (const item of list.getEntries()) longTasks.push({ start: item.startTime, duration: item.duration }) })
        observer.observe({ type: 'longtask' })
        const started = performance.now(); let previousTick = started; let completedAt; let writes = 0; let inFlight = 0; let maxInFlight = 0
        const timer = setInterval(() => { const now = performance.now(); loopGaps.push(now - previousTick); previousTick = now }, 5)
        const parsed = new Promise(resolve => {
          if (mode === 'snapshot-writer') {
            const writer = createTerminalSnapshotWriter({ reset: () => terminal.reset(), write(part, done) {
              writes++; inFlight += part.length; maxInFlight = Math.max(maxInFlight, inFlight)
              terminal.write(part, () => {
                inFlight -= part.length; done()
                const state = writer.getState()
                if (!state.pendingCharacters && !state.inFlightCharacters) { completedAt = performance.now(); resolve() }
              })
            } })
            writer.update(source, source.length)
            return
          }
          let cursor = 0
          const next = () => {
            if (cursor === source.length) { completedAt = performance.now(); resolve(); return }
            const part = source.slice(cursor, cursor + chunkSize); cursor += part.length
            writes++; inFlight += part.length; maxInFlight = Math.max(maxInFlight, inFlight)
            terminal.write(part, () => { inFlight -= part.length; next() })
          }
          next()
        })
        const firstTimer = new Promise(resolve => setTimeout(() => resolve(performance.now() - started), 0))
        await parsed
        const firstTimerMs = await firstTimer
        await paint()
        const visibleRows = Array.from({ length: terminal.rows }, (_, index) => terminal.buffer.active.getLine(terminal.buffer.active.viewportY + index)?.translateToString(true) || '')
        const paintedAt = performance.now()
        const domMarkerPresent = node.current.querySelector('.xterm-rows')?.textContent.includes('DELIVERY-FINISHED') || false
        clearInterval(timer)
        for (const item of observer.takeRecords()) longTasks.push({ start: item.startTime, duration: item.duration })
        observer.disconnect()
        await record({ name: 'Actual xterm write delivery', sample, delivery: mode === 'snapshot-writer' ? 'production-snapshot-writer' : 'fixture-direct-callbacks', chunkSize, sourceCharacters: source.length, writes, maxInFlightCharacters: maxInFlight, writeCallbackMs: round(completedAt - started), throughTwoFramesMs: round(paintedAt - started), firstTimerMs: round(firstTimerMs), maxEventLoopIntervalMs: round(Math.max(0, ...loopGaps)), measuredTimerTicks: loopGaps.length, longTasks: longTasks.filter(item => item.start >= started && item.start < paintedAt).map(item => round(item.duration)), bufferMarkerPresent: visibleRows.some(line => line.includes('DELIVERY-FINISHED')), domMarkerPresent, visibleTail: visibleRows.filter(Boolean).slice(-2) })
        terminal.dispose()
      }
      setStatus('Complete')
    } catch (error) { setStatus(error.message) }
    finally { setBusy(false) }
  }
  return <section><h2>Parser delivery experiment</h2><p>Same actual xterm version and screen-reader mode as production. Compare one 500k write with callback-controlled chunks; report parser completion, actual DOM marker, long tasks, and event-loop gaps separately from accessibility refresh.</p><button disabled={busy} onClick={run}>Compare xterm delivery</button><span role="status">{status}</span><div ref={node} style={{ height: 280, marginTop: 16 }}/></section>
}
