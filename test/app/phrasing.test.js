import { describe, expect, test } from 'bun:test'
import {
  blocks,
  bytes,
  doingWord,
  duration,
  linked,
  spans,
  statusLine,
  tokens,
  toolOf,
  verbFor,
  visibleStream,
} from '../../src/app/phrasing.js'

/**
 * The page's own words, and the line it may not cross.
 *
 * `src/app/phrasing.js` turns machine facts into sentences, and the reason it
 * has a test file at all is that two of its functions sit next to a rule this
 * codebase takes seriously: `Toolbox` decides what a call is and `core/response`
 * decides what a reply means, and a second decider in the page would agree with
 * them until the day it did not. What is pinned here is that these functions
 * read a NAME and find where a FIELD BEGINS, and never interpret an argument.
 */

describe('naming what a step did', () => {
  test('the verb comes from the tool name and the arguments are not read', () => {
    expect(verbFor('shell({"command": "rm -rf /"})')).toBe(
      'Ran a command on the Linux machine in this tab',
    )
    // And the present tense while it is still running. A reviewer read
    // "Ran a command" beside a clock saying the turn was one second old and
    // the command had not come back — a finished label over unfinished work.
    expect(verbFor('shell({"command": "uname -a"})', false)).toBe(
      'Running a command on the Linux machine in this tab',
    )
    expect(verbFor('researcher({"task": "x"})', false)).toBe('Asking researcher')
    expect(verbFor('', false)).toBe('Working on it')
    // Same verb for a call whose arguments are nonsense, malformed, or absent.
    // A page that said something different about these would be a page that had
    // opinions about whether a call is valid — which is `Toolbox`'s decision.
    expect(verbFor('shell({broken')).toBe('Ran a command on the Linux machine in this tab')
    expect(verbFor('shell()')).toBe('Ran a command on the Linux machine in this tab')
  })

  test('an unknown tool is named, not described', () => {
    // An MCP server offers whatever it offers and an agent file may name a peer
    // that did not exist when this was written. Handing back the real name is
    // honest; "did something" would be wrong and unlookupable.
    expect(verbFor('researcher({"task": "read the page"})')).toBe('Asked researcher')
    expect(verbFor('disk({"path": "/"})')).toBe('Asked disk')
  })

  test('text that is not a call at all is not given a verb it did not earn', () => {
    expect(toolOf('the answer is 68')).toBe('')
    expect(verbFor('the answer is 68')).toBe('Worked on it')
    expect(verbFor('')).toBe('Worked on it')
  })
})

describe('what a reader sees of a reply that is still arriving', () => {
  test('the contract itself is never shown', () => {
    // The measured defect: someone who asked what 17 times 4 is watched
    // `think:`, `plan:` and `act: answer` stream into the transcript for the
    // whole time they were paying most attention, and then watched all three
    // vanish.
    const partial = 'think: [answerable now]\n\nplan: []\n\nact: answer\n\nresult: It is 68.'
    const seen = visibleStream(partial)

    expect(seen.answer).toBe('It is 68.')
    expect(seen.waiting).toBe(false)
    expect(seen.thinking).toBe('answerable now')
    expect(seen.answer).not.toContain('act:')
    expect(seen.answer).not.toContain('plan:')
  })

  test('a reply that has not reached its answer yet says it is waiting, and shows nothing', () => {
    const seen = visibleStream('think: [the web will have this]\n\nplan: [search for it]\n\nact: ')
    expect(seen.answer).toBe('')
    expect(seen.waiting).toBe(true)
    expect(seen.thinking).toBe('the web will have this')
  })

  test('a result line with nothing after it yet is not an empty answer', () => {
    const seen = visibleStream('think: [x]\n\nplan: []\n\nact: answer\n\nresult:')
    expect(seen.answer).toBe('')
    expect(seen.waiting).toBe(true)
  })

  test('prose from an agent with no contract is shown whole', () => {
    // The one decision this function may not make is that a reply is
    // malformed. An agent whose response contract is the plain one writes
    // prose, and hiding it would be the page refusing a reply it does not own
    // the grammar of.
    const seen = visibleStream('Ceramic filters remove particles down to 0.2 microns.')
    expect(seen.answer).toBe('Ceramic filters remove particles down to 0.2 microns.')
    expect(seen.waiting).toBe(false)
  })

  test('an answer is everything after result:, including words that look like fields', () => {
    // Measured against the shipped function: an answer containing the word
    // "Plan:" at the start of a line came back truncated at it, and so did one
    // containing a fenced code block with `act: run()` inside. The answer then
    // POPPED BACK when the turn ended and the parsed reply replaced the stream,
    // so what a person saw while waiting was a sentence that had lost its tail.
    //
    // `result` is the LAST field of the contract. Nothing follows it, so
    // everything after it is the answer and there is no boundary to look for.
    expect(
      visibleStream('result: Here is the outline.\nPlan: buy tea\nThen drink it.').answer,
    ).toBe('Here is the outline.\nPlan: buy tea\nThen drink it.')
    expect(visibleStream('result: here is code\n```\nact: run()\n```\nmore').answer).toBe(
      'here is code\n```\nact: run()\n```\nmore',
    )
  })

  test('the scratchpad still ends where the next field begins', () => {
    // `think` is not last, so it does have a boundary — and the fields after it
    // must not be shown as part of it.
    const seen = visibleStream('think: [weigh it up]\n\nplan: [do the thing]\n\nact: tool')
    expect(seen.thinking).toBe('weigh it up')
    expect(seen.answer).toBe('')
  })

  test('nothing at all is not a waiting state', () => {
    expect(visibleStream('')).toEqual({ thinking: '', answer: '', waiting: false })
  })

  test('an answer that mentions the field names in its own text survives', () => {
    // `result:` inside the answer's own prose must not truncate it. The section
    // reader takes everything to the NEXT field line, and a colon mid-sentence
    // is not one.
    const seen = visibleStream('result: The plan: buy tea. Then act: drink it.')
    expect(seen.answer).toBe('The plan: buy tea. Then act: drink it.')
  })
})

describe('what a sub-agent is doing', () => {
  test('a tool name becomes a phrase, and an unknown one is still named', () => {
    expect(doingWord(['fetch'])).toBe('reading a page')
    expect(doingWord(['shell', 'search'])).toBe('running a command')
    expect(doingWord(['disk'])).toBe('using disk')
    expect(doingWord([])).toBe('thinking')
  })
})

describe('readouts', () => {
  test('a duration reads in the unit a person asks in', () => {
    expect(duration(0)).toBe('0s')
    expect(duration(47_000)).toBe('47s')
    expect(duration(247_000)).toBe('4m 07s')
  })

  test('bytes are reported at the scale worth reading, and nothing is not zero', () => {
    expect(bytes(900)).toBe('900 B')
    expect(bytes(52_602_121)).toBe('50.2 MB')
    expect(bytes(0)).toBe('')
    expect(bytes(null)).toBe('')
  })
})

describe('the one line at the top of the screen', () => {
  test('a download outranks everything, because it is the longest wait there is', () => {
    const line = statusLine({
      ready: true,
      busy: true,
      download: { file: 'linux machine', percent: 12 },
    })
    expect(line.text).toBe('linux machine 12%')
    expect(line.live).toBe(true)
  })

  test('a working sub-agent is named, because it is what the person is waiting for', () => {
    const line = statusLine({
      ready: true,
      busy: true,
      elapsed: 9,
      delegates: [{ agent: 'researcher', answered: false, doing: ['fetch'] }],
    })
    // The plain working line keeps its seconds in a field of their own, so a
    // caller can show them and keep them out of what is announced.
    expect(statusLine({ ready: true, busy: true, elapsed: 9 })).toEqual({
      text: 'working',
      clock: '9s',
      live: true,
    })
    // `researcher: fetch (3)` was the previous rendering — a name, a function
    // and a number, which is three pieces of machine vocabulary for one fact.
    expect(line.text).toBe('researcher is reading a page')

    // A delegate that has not called anything yet still gets a sentence.
    expect(statusLine({ ready: true, delegates: [{ agent: 'researcher' }] }).text).toBe(
      'researcher is thinking',
    )
  })

  test('a finished sub-agent nobody has read is still news', () => {
    const line = statusLine({
      ready: true,
      tasks: [{ agent: 'researcher', state: 'done', read: false }],
    })
    expect(line.text).toBe('researcher has an answer for you')
    expect(line.live).toBe(true)
  })

  test('with nothing happening the line says who is listening', () => {
    // The only fact on this list that changes what the next thing a person
    // types will do.
    expect(statusLine({ ready: true, agent: 'main' })).toEqual({
      text: 'talking to main',
      live: false,
    })
  })

  test('offline outranks everything but the boot, and only when the model is elsewhere', () => {
    expect(statusLine({ ready: true, busy: true, online: false }).text).toBe(
      'offline — the model is somewhere else',
    )
    // A model running in this tab needs no network. Saying the connection is
    // down while the thing works would be the app inventing a fault.
    expect(statusLine({ ready: true, online: false, local: true, agent: 'main' }).text).toBe(
      'talking to main',
    )
    expect(statusLine({ ready: false, online: false }).text).toBe('starting')
  })

  test('before the backend is up nothing else can be true', () => {
    expect(statusLine({ ready: false, busy: true }).text).toBe('starting')
  })
})

describe('addresses in a reply', () => {
  test('an address becomes a piece a caller can render as a link', () => {
    // A reviewer's finding: `document.querySelectorAll('main a').length === 0`,
    // including on cited search results, which arrive as raw markdown. Nothing
    // in the transcript was clickable — so a citation was a string to retype.
    expect(linked('see https://example.com/a for more')).toEqual([
      { text: 'see ' },
      { text: 'https://example.com/a', href: 'https://example.com/a' },
      { text: ' for more' },
    ])
  })

  test('trailing punctuation belongs to the sentence, not to the address', () => {
    const [, link, tail] = linked('read https://example.com/page.')
    expect(link.href).toBe('https://example.com/page')
    expect(tail.text).toBe('.')
    // A bracket closes a markdown link and is not part of the URL either.
    expect(linked('(https://example.com/x)')[1].href).toBe('https://example.com/x')
  })

  test('only http and https, because those are the ones a browser should open', () => {
    // `javascript:` and `data:` are the two that turn a model's output into a
    // thing that runs. A reply is text, and text this function does not
    // recognise stays text.
    for (const said of [
      'javascript:alert(1)',
      'data:text/html,<script>x</script>',
      'file:///etc/passwd',
      'ftp://example.com',
    ]) {
      expect(linked(said).every((piece) => !piece.href)).toBe(true)
    }
  })

  test('text with no address is one piece, and empty text is none', () => {
    expect(linked('nothing here')).toEqual([{ text: 'nothing here' }])
    expect(linked('')).toEqual([])
  })

  test('several addresses in one reply are all found, in order', () => {
    const pieces = linked('a https://one.example b https://two.example c')
    expect(pieces.filter((one) => one.href).map((one) => one.href)).toEqual([
      'https://one.example',
      'https://two.example',
    ])
  })
})

describe('background work a person can end', () => {
  const line = (tasks) => statusLine({ ready: true, busy: false, tasks })

  test('a running handed-over task names itself and offers to be stopped', () => {
    const said = line([{ id: 't3', agent: 'researcher', state: 'running' }])
    expect(said.text).toBe('researcher is working in the background')
    expect(said.stoppable).toEqual({ id: 't3', agent: 'researcher' })
  })

  test('nothing is stoppable when nothing is running', () => {
    expect(line([]).stoppable).toBeUndefined()
    expect(
      line([{ id: 't1', agent: 'researcher', state: 'done', read: false }]).stoppable,
    ).toBeUndefined()
  })

  test('a stopped task is not reported as an answer waiting to be read', () => {
    // The defect this exists to prevent: `state !== 'failed'` used to mean
    // "finished", so a thread the person killed themselves invited them to go
    // and read an answer that was never written.
    const said = line([{ id: 't2', agent: 'researcher', state: 'stopped', read: false }])
    expect(said.text).toBe('researcher was stopped')
  })

  test('a failed task still says it could not finish', () => {
    expect(line([{ id: 't2', agent: 'researcher', state: 'failed', read: false }]).text).toBe(
      'researcher could not finish',
    )
  })

  test('a task the tab closed on is none of the other three', () => {
    // Not an answer, not a failure, not a stop. The agent did not fail, the
    // person did not end it, and there is nothing to read — the question is
    // still a question.
    const said = line([{ id: 't4', agent: 'researcher', state: 'interrupted', read: false }])
    expect(said.text).toBe('researcher did not finish before the tab closed')
    expect(said.stoppable).toBeUndefined()
  })

  test('a restarted task says it was restarted', () => {
    // Somebody who reopens the app and reads "working in the background" about
    // a question they asked before they closed it is owed the fact that the
    // first attempt did not survive: otherwise the time it has been running,
    // and what it has spent, are both a surprise.
    const said = line([{ id: 't5', agent: 'researcher', state: 'running', resumes: 1 }])
    expect(said.text).toBe(
      'researcher is working in the background, restarted after the tab closed',
    )
    expect(said.stoppable).toEqual({ id: 't5', agent: 'researcher' })
  })
})

describe('a reply that was written in markdown', () => {
  test('a fence becomes a block and its backticks leave the screen', () => {
    const said = 'Here it is:\n\n```bash\nuname -a\n```\n\nThat is the kernel.'
    const parts = blocks(said)
    expect(parts.map((part) => part.kind)).toEqual(['prose', 'code', 'prose'])
    expect(parts[1].text).toBe('uname -a')
    expect(parts[1].language).toBe('bash')
    // The whole point: no part of the output still carries the delimiter.
    expect(parts.some((part) => part.text.includes('```'))).toBe(false)
  })

  test('a fence still being written is a block, not litter', () => {
    // What a reader sees mid-stream. Waiting for the closing fence would show
    // them the opening one for as long as the code takes to arrive.
    const parts = blocks('one moment\n\n```js\nconst x = 1')
    expect(parts.map((part) => part.kind)).toEqual(['prose', 'code'])
    expect(parts[1].text).toBe('const x = 1')
  })

  test('a reply with no code is one run of prose, as it always was', () => {
    expect(blocks('just an answer')).toEqual([
      { kind: 'prose', text: 'just an answer', language: '' },
    ])
    expect(blocks('')).toEqual([])
  })

  test('a fence with no language still says which block it is', () => {
    const parts = blocks('```\nplain\n```')
    expect(parts).toEqual([{ kind: 'code', text: 'plain', language: '' }])
  })

  test('inline code is a span, and the backticks go', () => {
    expect(spans('the kernel is `6.1.0` here')).toEqual([
      { text: 'the kernel is ' },
      { text: '6.1.0', code: true },
      { text: ' here' },
    ])
  })

  test('an address inside backticks is shown, not offered', () => {
    // A URL being quoted is a name. Linking it invites a click on something the
    // author was only naming, which is the wrong reading of their intent.
    const said = spans('point it at `http://127.0.0.1:1234/v1` to begin')
    expect(said[1]).toEqual({ text: 'http://127.0.0.1:1234/v1', code: true })
    expect(said.some((piece) => piece.href)).toBe(false)
  })

  test('an address outside backticks is still a link', () => {
    expect(spans('see https://example.com now').some((piece) => piece.href)).toBe(true)
  })

  test('a lone backtick stays text', () => {
    expect(spans("it's a ` on its own")).toEqual([{ text: "it's a ` on its own" }])
  })
})

describe('a number that says what it measured', () => {
  test('a token count carries its unit and its separators', () => {
    expect(tokens(1525)).toBe('1,525 tokens')
    expect(tokens(0)).toBe('0 tokens')
  })

  test('a missing count is zero rather than NaN', () => {
    // The panels draw this from `usage`, which is null until a reply has been
    // costed, and `undefined.toLocaleString()` is how that used to be a crash.
    expect(tokens(undefined)).toBe('0 tokens')
    expect(tokens(null)).toBe('0 tokens')
  })
})
