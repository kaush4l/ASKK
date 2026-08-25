/**
 * ONE REALISTIC PROJECTION PER VIEW — the workspace's five (docs/SEAM.md:
 * files, terminal, processes, space, debug). Nothing here is true; see
 * `fixtures/run.js` for what a fixture is FOR.
 *
 * Two of these carry a state the predecessor got wrong and a critic should be
 * able to reject on sight: a process that a reload destroyed does not look like
 * one somebody stopped, and a folder that HELD files before a reload does not
 * say the same words as one that never held any.
 */

/** @type {import('@/components/views/files').FilesData} */
export const files = {
  atLabel: 'The workspace folder',
  emptyNote:
    'artifacts held report.md and two charts, and the reload took them — this Linux keeps its filesystem in memory.',
  entries: [
    { name: 'artifacts/', kind: 'folder', meta: '3 items' },
    { name: 'notes.md', kind: 'file', meta: '4.1 KB, written by scout 2 minutes ago' },
    { name: 'tick.log', kind: 'file', meta: '812 B, still being written to' },
  ],
  open: {
    pathLabel: 'notes.md',
    stateLabel: 'Editing',
    contents: '# What the search turned up\n\nFirecrawl answers without a key and sends\naccess-control-allow-origin: *.\n',
  },
}

/** @type {import('@/components/views/terminal').TerminalData} */
export const terminal = {
  whereLabel: "scout's folder, in the Linux this page runs",
  emptyNote: 'Nothing has been run in this folder yet.',
  refusedLabel: '',
  runs: [
    { id: 'r1', command: 'ls -la artifacts', status: 'ok', statusLabel: 'Finished in 0.4s',
      output: 'total 12\ndrwxr-xr-x 2 root root 4096 Aug 25 09:12 .\n-rw-r--r-- 1 root root 2048 Aug 25 09:12 report.md' },
    { id: 'r2', command: 'python3 -c "print(1)"', status: 'failed', statusLabel: 'Exited 127',
      output: '/bin/sh: python3: not found' },
    { id: 'r3', command: 'tail -f tick.log', status: 'calling', statusLabel: 'Running — 7m 41s',
      output: 'tick 41\ntick 42' },
  ],
}

/** @type {import('@/components/views/processes').ProcessesData} */
export const processes = {
  emptyNote: 'pulse_logger and ticker were started here, and the reload took them.',
  rows: [
    { id: 'p1', name: 'ticker', status: 'calling', statusLabel: 'Running', ageLabel: 'Started 12 minutes ago',
      commandLabel: 'sh -c "while true; do echo tick >> tick.log; sleep 5; done"' },
    { id: 'p2', name: 'pulse_logger', status: 'stopped', statusLabel: 'Stopped — you ended it', ageLabel: 'Ran for 4 minutes',
      commandLabel: 'sh -c "python3 pulse.py >> pulse.log"' },
    { id: 'p3', name: 'watcher', status: 'failed', statusLabel: 'Gone — the reload destroyed it', ageLabel: 'Ran for 31 seconds',
      commandLabel: 'sh -c "inotifywait -m artifacts"' },
  ],
}

/** @type {import('@/components/views/space').SpaceData} */
export const space = {
  spaceLabel:
    'Space: research — scout works here, with every other agent whose file names it. What they share is the facts and notes below; the folder is this page’s own.',
  pathLabel:
    "scout's folder: /work/research — a real folder in the Linux that commands run in. This engine keeps its filesystem in memory, so a reload empties it.",
  factsEmptyNote: 'No shared facts yet. An agent settles one with remember_fact.',
  notesEmptyNote: 'No notes yet. An agent leaves one with leave_note.',
  note: 'Facts and notes are read fresh into every agent’s prompt before every turn, so nobody has to be told they changed. The board keeps the newest 20 notes.',
  facts: [
    { key: 'subject', value: 'keyless web search from a browser' },
    { key: 'decided', value: 'Firecrawl is the primary; public SearXNG is not' },
  ],
  notes: [
    { id: 'n1', author: 'scout', said: '60 of 76 public SearXNG instances answered 429.' },
    { id: 'n2', author: 'critic', said: 'r.jina.ai returns 401 from consumer ISPs, which is where a browser agent lives.' },
  ],
}

/** @type {import('@/components/views/debug').DebugData} */
export const debug = {
  emptyNote: 'This log holds no turns yet.',
  ownLogNote: 'These are this page’s own facts. A sub-agent runs in its own Worker, so its route, stage and model-call facts are in its log and not in this one.',
  counts: [
    { key: 'Turns', value: '9' },
    { key: 'Model calls', value: '14' },
    { key: 'Writes that failed', value: '0' },
  ],
  turns: [
    {
      id: 't9', headline: 'Turn 9 — react',
      facts: [
        { key: 'Route', value: 'react — the question needs a lookup, not an answer' },
        { key: 'Stage', value: 'work, 2 of 4' },
        { key: 'Document', value: 'sha256:8f21c4…, 6,102 tokens of a 128,000 window' },
        { key: 'Cost', value: '6,102 in · 380 out' },
      ],
    },
    {
      id: 't8', headline: 'Turn 8 — answer',
      facts: [
        { key: 'Route', value: 'answer — nothing to look up' },
        { key: 'Stage', value: 'critique, 4 of 4' },
        { key: 'Document', value: 'sha256:1a90de…, 4,880 tokens of a 128,000 window' },
        { key: 'Cost', value: '4,880 in · 512 out' },
      ],
    },
  ],
}
