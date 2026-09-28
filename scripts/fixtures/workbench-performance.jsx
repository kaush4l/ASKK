// Synthetic input, actual production UI components. No workspace/controller is used.
import React, { useCallback, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import FileTree from '../../src/workbench/FileTree.jsx'
import Terminal from '../../src/workbench/Terminal.jsx'
import TerminalDeliveryBenchmark from './terminal-delivery-benchmark.jsx'

const datasets = new Map([1000, 10000].map(count => [count, Array.from({ length: count }, (_, index) => ({ path: `packages/pkg-${String(index % 100).padStart(3, '0')}/file-${String(index).padStart(5, '0')}.js`, rev: 1 }))]))
const noDirtyPaths = new Set()
const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
const round = value => Math.round(value * 10) / 10
const longTasks = []
try { new PerformanceObserver(list => { for (const entry of list.getEntries()) longTasks.push({ start: entry.startTime, duration: entry.duration }) }).observe({ type: 'longtask', buffered: true }) } catch {}

function Fixture() {
  const [files, setFiles] = useState([]); const [query, setQuery] = useState(''); const [selected, setSelected] = useState('')
  const [output, setOutput] = useState(''); const [outputLength, setOutputLength] = useState(0); const [session, setSession] = useState('fixture-0')
  const [busy, setBusy] = useState(false); const [results, setResults] = useState([]); const records = useRef([])
  const open = useCallback(path => setSelected(path), [])
  async function record(value) {
    records.current.push(value); setResults([...records.current])
    await fetch('/results', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profile: 'actual-workbench-components-synthetic-input', browser: navigator.userAgent, at: new Date().toISOString(), results: records.current }) })
  }
  async function measure(name, mutate, extra = {}) {
    const started = performance.now()
    flushSync(mutate)
    const commitMs = performance.now() - started
    await paint()
    await record({ name, ...extra, commitMs: round(commitMs), throughTwoFramesMs: round(performance.now() - started), renderedTreeRows: document.querySelectorAll('[role="treeitem"]').length, longTasks: longTasks.filter(task => task.start >= started).map(task => round(task.duration)) })
  }
  async function trees() {
    setBusy(true)
    try {
      for (const count of [1000, 10000]) {
        flushSync(() => { setFiles([]); setQuery(''); setSelected('') }); await paint()
        await measure(`Mount ${count} files`, () => setFiles(datasets.get(count)), { files: count })
        await measure(`Filter ${count} files to last filename`, () => setQuery(`file-${String(count - 1).padStart(5, '0')}`), { files: count })
        await measure(`Restore ${count} files from filter`, () => setQuery(''), { files: count })
        await measure(`Select last of ${count} files`, () => setSelected(datasets.get(count).at(-1).path), { files: count })
      }
    } finally { flushSync(() => { setFiles([]); setQuery(''); setBusy(false) }) }
  }
  async function waitForMarker(marker, timeout = 15000) {
    const started = performance.now()
    while (performance.now() - started < timeout) {
      if (document.querySelector('.xterm-accessibility-tree')?.textContent.includes(marker)) return { markerVisible: true, markerLatencyMs: round(performance.now() - started) }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    return { markerVisible: false, markerLatencyMs: round(performance.now() - started) }
  }
  async function commandOutput() {
    setBusy(true)
    try {
      flushSync(() => { setSession(`fixture-${Date.now()}`); setOutput(''); setOutputLength(0) }); await paint()
      const source = Array.from({ length: 60000 }, (_, index) => `line ${String(index).padStart(6, '0')} synthetic compiler output ${'x'.repeat(42)}\n`).join('')
      let total = `${source}\nTAIL-INITIAL\n`.length; let tail = `${source}\nTAIL-INITIAL\n`.slice(-500000)
      const started = performance.now(); flushSync(() => { setOutput(tail); setOutputLength(total) }); const commitMs = performance.now() - started
      const initial = await waitForMarker('TAIL-INITIAL')
      await record({ name: 'Render bounded 500k-character command tail', sourceCharacters: source.length, displayedSnapshotCharacters: tail.length, commitMs: round(commitMs), ...initial, screenRows: document.querySelectorAll('.xterm-accessibility-tree [role="listitem"]').length })
      const streamStarted = performance.now(); const commitSamples = []
      for (let index = 0; index < 30; index++) {
        const chunk = `${`stream ${index} ${'y'.repeat(80)}\n`.repeat(170)}TAIL-STREAM-${index}\n`
        total += chunk.length; tail = (tail + chunk).slice(-500000)
        const start = performance.now(); flushSync(() => { setOutput(tail); setOutputLength(total) }); commitSamples.push(round(performance.now() - start))
        await new Promise(resolve => setTimeout(resolve, 30))
      }
      const streamed = await waitForMarker('TAIL-STREAM-29')
      await record({ name: 'Thirty rolling output updates after retention limit', updates: 30, retainedCharacters: tail.length, reactCommitMs: commitSamples, totalMs: round(performance.now() - streamStarted), ...streamed, screenRows: document.querySelectorAll('.xterm-accessibility-tree [role="listitem"]').length, longTasks: longTasks.filter(task => task.start >= streamStarted).map(task => round(task.duration)) })
    } finally { setBusy(false) }
  }
  return <main><h1>ASKK UI performance fixture</h1><p>Synthetic filenames and command text rendered by the actual FileTree and Terminal components. No model, guest, command, or project is started. Timings are measurements, not pass flags.</p><div className="controls"><button disabled={busy} onClick={trees}>Run Explorer benchmarks</button><button disabled={busy} onClick={commandOutput}>Run command-output benchmarks</button><button disabled={busy} onClick={async () => { flushSync(() => { setOutput("DISCONTINUITY-PROOF\n"); setOutputLength(20) }); const result = await waitForMarker("DISCONTINUITY-PROOF"); await record({ name: "Replace output within same session", ...result, visibleText: document.querySelector(".xterm-accessibility-tree")?.textContent.trim() }) }}>Replace output</button><button disabled={busy} onClick={async () => { flushSync(() => { setOutput(""); setOutputLength(0) }); await paint(); await record({ name: "Clear output within same session", visibleText: document.querySelector(".xterm-accessibility-tree")?.textContent.trim() }) }}>Clear output</button><button disabled={busy} onClick={() => { setFiles(datasets.get(10000)); setQuery('') }}>Show 10,000 files for keyboard/scroll QA</button><label>Filter files<input value={query} onChange={event => setQuery(event.target.value)}/></label><span role="status">{busy ? 'Measuring…' : 'Ready'}</span></div><div className="panes"><section className="fixture-explorer"><FileTree files={files} selected={selected} dirtyPaths={noDirtyPaths} onOpen={open} onPin={open} onMenu={open} query={query}/></section><section className="fixture-terminal"><Terminal sessionId={session} output={output} outputLength={outputLength}/></section></div><TerminalDeliveryBenchmark record={record}/><pre id="results">{JSON.stringify(results, null, 2)}</pre></main>
}
createRoot(document.querySelector('#root')).render(<Fixture/>)
