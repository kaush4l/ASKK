/**
 * ONE AGENT'S TRANSCRIPT, AS THE SEAM WILL HAND IT OVER (`GET /chat`).
 *
 * Its own file because it is the only projection with two shapes inside it —
 * the typed nodes a reply is parsed into, and the tool calls between the turns
 * — and because everything a critic rejects the Work screen for is in here.
 * Nothing in it is true; see `fixtures/run.js` for what a fixture is FOR.
 *
 * ALL FOUR CALL STATES ARE PRESENT ON PURPOSE. A transcript that only ever
 * shows a finished call is one where nobody has ever looked at the state the
 * person actually watches, which is the one that has not answered yet.
 */

/**
 * ONE REPLY'S TYPED NODES, exported so `/design-system/` can show the markdown
 * renderer's every node kind without a second copy of them drifting from this
 * one.
 * @type {ReadonlyArray<import('@/components/ui/markdown').Block>}
 */
export const reply = [
  { kind: 'heading', spans: [{ kind: 'text', text: 'What the two endpoints answered' }] },
  {
    kind: 'paragraph',
    spans: [
      { kind: 'text', text: 'Firecrawl answered without a key and sent ' },
      { kind: 'code', text: 'access-control-allow-origin: *' },
      { kind: 'text', text: ', so a browser can call it directly. ' },
      { kind: 'strong', text: 'r.jina.ai refused.' },
    ],
  },
  {
    kind: 'bullets',
    items: [
      [{ kind: 'text', text: '60 of 76 public SearXNG instances answered 429.' }],
      [
        { kind: 'text', text: 'Two of the remaining sixteen sent any ' },
        { kind: 'code', text: 'access-control-allow-origin' },
        { kind: 'text', text: ' at all.' },
      ],
    ],
  },
  { kind: 'code', langLabel: 'shell', text: 'curl -sI https://api.firecrawl.dev/v1/scrape | grep -i allow-origin' },
  {
    kind: 'quote',
    spans: [{ kind: 'emphasis', text: 'Keyless is a property of one endpoint on one day, not of a protocol.' }],
  },
]

/**
 * A WINDOW THAT IS NEARLY SPENT — the state the context ring exists to make
 * visible, and the one a realistic transcript does not contain.
 *
 * It lived in `app/design-system/specimens.jsx` for an increment and moved
 * here when `test/composer.test.js` became its second reader: a fixture two
 * things share belongs beside the other fixtures, or the gallery becomes a
 * module the tests import from.
 * @type {import('@/components/ui/ring').CostData}
 */
export const NEARLY_FULL = {
  label: '119,540 of 128,000 tokens',
  headroomLabel: '8,460 tokens before the oldest turn is dropped from the window.',
  parts: [
    { id: 'input', key: 'Input', value: '81,200 tokens', fraction: 0.634 },
    { id: 'output', key: 'Output', value: '12,410 tokens', fraction: 0.097 },
    { id: 'reasoning', key: 'Reasoning', value: '18,930 tokens, never fed back', fraction: 0.148 },
    { id: 'cached', key: 'Cached', value: '7,000 tokens, billed at a tenth', fraction: 0.055 },
  ],
}

/** @type {import('@/components/views/chat').ChatData} */
export const chat = {
  agent: 'main',
  stageLabel: 'main · work stage, 2 of 4',
  emptyNote: 'Nothing has been said to main yet. What you type starts a turn.',
  waitingLabel: 'Working — 14 seconds in this call',
  waitingStatus: 'thinking',
  rows: [
    {
      id: 'm1', row: 'said', kind: 'user', speaker: 'You',
      blocks: [{ kind: 'paragraph', spans: [{ kind: 'text', text: 'Find out whether Firecrawl still answers without a key.' }] }],
    },
    {
      id: 'c1', row: 'call', name: 'web_search', status: 'ok', statusLabel: 'Finished in 0.8s',
      argsLabel: 'query="firecrawl keyless CORS"',
      resultLabel: '8 results\n1. firecrawl.dev/docs — Scrape endpoint\n2. github.com/mendableai/firecrawl — README',
    },
    { id: 'm2', row: 'said', kind: 'assistant', speaker: 'main', blocks: reply },
    {
      id: 'c2', row: 'call', name: 'read_page', status: 'failed', statusLabel: 'Refused by the browser',
      argsLabel: 'url="https://r.jina.ai/https://firecrawl.dev"',
      resultLabel: 'No access-control-allow-origin on the response, so this page never saw the body.',
    },
    {
      id: 'c3', row: 'call', name: 'read_page', status: 'calling', statusLabel: 'Running — 14s',
      argsLabel: 'url="https://firecrawl.dev/docs"', resultLabel: '',
    },
    {
      id: 'c4', row: 'call', name: 'write_file', status: 'pending', statusLabel: 'Queued behind the read',
      argsLabel: 'path="notes.md"', resultLabel: '',
    },
    {
      id: 'm3', row: 'said', kind: 'error', speaker: '',
      blocks: [{ kind: 'paragraph', spans: [{ kind: 'text', text: 'The hosted endpoint refused this turn: 401. The local one answered it instead.' }] }],
    },
  ],
  composer: {
    promptLabel: 'Say the next thing to main',
    placeholder: 'Ask main to look something up…',
    sendLabel: 'Send',
    // EMPTY, because the composer sends now. What refuses a message is the
    // core — an ungranted build, an endpoint with no address — and this fixture
    // is a healthy transcript. The gallery still shows a composer that cannot
    // send, because nothing is listening to a specimen (`ui/composer.jsx`).
    refusedLabel: '',
    sentWith: [
      { key: 'Agent', value: 'main' },
      { key: 'Model', value: 'gemma-3-12b-it, at the local endpoint' },
      { key: 'Tools', value: 'web_search, read_page, write_file' },
    ],
    cost: {
      label: '41,206 of 128,000 tokens',
      headroomLabel: '86,794 tokens before the oldest turn is dropped from the window.',
      parts: [
        { id: 'input', key: 'Input', value: '24,880 tokens', fraction: 0.194 },
        { id: 'output', key: 'Output', value: '6,410 tokens', fraction: 0.050 },
        { id: 'reasoning', key: 'Reasoning', value: '5,120 tokens, never fed back', fraction: 0.040 },
        { id: 'cached', key: 'Cached', value: '4,796 tokens, billed at a tenth', fraction: 0.037 },
      ],
    },
  },
}
