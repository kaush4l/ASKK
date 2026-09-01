import { AgentCatalogue } from '../core/agent/AgentCatalogue.js'
import { Outcome } from '../core/Outcome.js'
import { Blocked } from '../core/tools/HttpPort.js'
import { SEARCH_ENDPOINT } from '../core/tools/SearchTool.js'
import { AgentWorkerPool } from './AgentWorkerPool.js'
import { Workspace } from './files/Workspace.js'
import { Kernel } from './Kernel.js'
import { IndexedDb } from './repositories/IndexedDb.js'
import { IndexedDbRepository } from './repositories/IndexedDbRepository.js'
import { MemoryRepository } from './repositories/MemoryRepository.js'
import { C2wSandbox } from './sandbox/C2wSandbox.js'
import { AgentService } from './services/AgentService.js'
import { ChatService } from './services/ChatService.js'
import { ConversationService } from './services/ConversationService.js'
import { FilesService } from './services/FilesService.js'
import { SettingsService } from './services/SettingsService.js'

export const DB_NAME = 'askk'
// 3 because the agent's files are a third store. `IndexedDb.open` creates only
// the stores that are missing, so an existing database keeps its conversations
// and settings and gains one — a version that did not move would leave every
// browser that has already opened this app without a files store at all, and
// every write to it failing on a name the database has never heard of.
export const DB_VERSION = 3
export const STORE_CONVERSATIONS = 'conversations'
export const STORE_SETTINGS = 'settings'
export const STORE_FILES = 'files'

/** Long enough to answer "is anything there", short enough not to double a failed call. */
const REACH_TIMEOUT = 8000

/** Nothing came back, and here is which kind of nothing. */
const nothing = (url, blocked) =>
  Outcome.ok({
    url,
    status: 0,
    contentType: '',
    text: '',
    bytes: 0,
    truncated: false,
    stopped: '',
    blocked,
  })

/**
 * Read a body up to a cap, and say whether the cap was reached.
 *
 * Streamed rather than `response.text()` because `text()` has already
 * downloaded the whole thing before it can be measured — the cap would then be
 * a cap on what is remembered and not on what is paid for.
 *
 * `stopped` is why the stream ended early, empty when it ended properly. The
 * text that did arrive comes back either way: a body that broke half-way is
 * half an answer, and discarding it to report "no readable content" tells the
 * model something that is not true about a page it half received.
 */
async function readCapped(response, limit, contentType) {
  const reader = response.body?.getReader()
  if (!reader) return { text: '', bytes: 0, truncated: false, stopped: '' }

  // A server that declares a charset the runtime does not know must not cost
  // the whole body, so an unusable label falls back rather than failing.
  const label = /charset=([\w-]+)/i.exec(contentType)?.[1] ?? 'utf-8'
  const decoder = (await Outcome.attempt(() => new TextDecoder(label))).unwrapOr(new TextDecoder())

  let text = ''
  let bytes = 0
  while (true) {
    const chunk = await Outcome.attempt(() => reader.read())
    if (!chunk.ok) return { text, bytes, truncated: false, stopped: chunk.failure.message }

    const { done, value } = chunk.value
    if (done) return { text: text + decoder.decode(), bytes, truncated: false, stopped: '' }
    // Strictly over, not at: a body of exactly `limit` bytes is a WHOLE body,
    // and `>=` reported it as truncated — the model was then told a complete
    // page might be missing its end.
    if (bytes + value.byteLength > limit) {
      text += decoder.decode(value.subarray(0, limit - bytes))
      await reader.cancel()
      return { text, bytes: limit, truncated: true, stopped: '' }
    }
    bytes += value.byteLength
    text += decoder.decode(value, { stream: true })
  }
}

/**
 * Did anything answer at all?
 *
 * Sent as the SAME request, not a bare GET. An endpoint that answers GET and
 * refuses POST would otherwise have a failed POST diagnosed as "that origin
 * will not let a browser read it", which is a permanent property and sends the
 * agent away for good. `no-cors` drops the non-safelisted headers itself, so
 * this can only establish that something is THERE — establishing that it is
 * readable is the thing that already failed.
 */
async function reachable({ url, method, headers, body }) {
  const control = new AbortController()
  const timer = setTimeout(() => control.abort(), REACH_TIMEOUT)
  const opaque = await Outcome.attempt(() =>
    fetch(url, { method, headers, body, mode: 'no-cors', signal: control.signal }),
  )
  clearTimeout(timer)
  return opaque.ok
}

/**
 * The real HTTP port — the whole outside world the web tools are allowed.
 *
 * It lives beside the wiring because it is the only implementation and it is a
 * thin layer of policy over `fetch`; the day there is a second one it earns its
 * own file. What the policy is: a byte cap, a deadline, and one extra request
 * on failure to find out what kind of failure it was.
 *
 * That last part is the whole reason this is not a one-liner. A page cannot see
 * why `fetch` rejected — a CORS refusal, a dead host and a DNS failure are all
 * `TypeError: Failed to fetch` with nothing else in them. But an origin that
 * merely will not let a page READ it still answers a `no-cors` request, opaquely,
 * while a host that is not there rejects that too. Measured in a module worker
 * in Chrome, and recorded in `docs/CORS-PROBE.md` §4:
 *
 *     ziglang.org        cors: REJECTED TypeError  no-cors: resolved type=opaque
 *     …no-such-host…     cors: REJECTED TypeError  no-cors: REJECTED TypeError
 *
 * One extra round trip, only on the path that already failed, buys the agent
 * the difference between "go somewhere else" and "try again".
 */
// The caps are defaulted here as well as passed by both callers, because an
// absent cap does not fail — it silently downloads everything, which is the one
// bug in this file that would never show up in a test.
export const browserHttp = async ({
  url,
  method = 'GET',
  headers = {},
  body = null,
  limit = 512 * 1024,
  timeout = 20_000,
}) => {
  const control = new AbortController()
  const timer = setTimeout(() => control.abort(), timeout)
  // `finally`, and nothing else in this file uses one: the deadline has to die
  // on every path out, and the previous version cleared it the instant the
  // HEADERS arrived. A server that answered and then trickled forever was then
  // read with no deadline at all, and the turn never ended.
  try {
    const sent = await Outcome.attempt(() =>
      fetch(url, { method, headers, body, signal: control.signal, redirect: 'follow' }),
    )
    if (!sent.ok) {
      if (control.signal.aborted) return nothing(url, Blocked.TIMEOUT)
      const answered = await reachable({ url, method, headers, body })
      return nothing(url, answered ? Blocked.REFUSED : Blocked.UNREACHABLE)
    }

    const response = sent.value
    const contentType = response.headers.get('content-type') ?? ''
    const read = await readCapped(response, limit, contentType)
    // The body is inside the deadline too, so a stream that stalled is a
    // timeout and not a mystery. Checked in this order because an aborted read
    // reports itself as a broken stream and only the signal knows which it was.
    if (read.stopped && control.signal.aborted) return nothing(url, Blocked.TIMEOUT)

    return Outcome.ok({
      // The url AFTER redirects. A tool that reports the address it asked for
      // hides that it is reading something else.
      url: response.url || url,
      status: response.status,
      contentType,
      blocked: Blocked.NONE,
      ...read,
    })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The single place where concrete implementations are chosen.
 *
 * Every other backend module receives its collaborators through its
 * constructor, so this is the only file that must change to swap a datastore —
 * and the only file that knows both a service and an adapter exist.
 *
 * Storage is probed here rather than on first use. A browser that refuses
 * IndexedDB — a private window, blocked site data — gets in-memory
 * repositories, so the app still runs and the loss of persistence is a note the
 * user can be shown instead of a failure on their first message.
 */
export async function buildKernel({
  db = new IndexedDb(DB_NAME, DB_VERSION, [STORE_CONVERSATIONS, STORE_SETTINGS, STORE_FILES]),
} = {}) {
  const opened = await db.open()
  const notes = opened.ok ? [] : [`storage unavailable: ${opened.failure.message}`]

  const make = (name, store) =>
    opened.ok ? new IndexedDbRepository(name, db, store) : new MemoryRepository(name)

  // Built from an inlined constant, not the router: this runs in a worker,
  // which has no router and no document to resolve a relative URL against.
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? ''
  const catalogue = new AgentCatalogue(base)
  const pool = new AgentWorkerPool()

  // The sandbox is constructed, not booted. Its image is ~100 MB and an agent
  // that never runs a command must never download it — the first `shell` call
  // is what pays for it.
  //
  // The image URL is DERIVED, exactly like the worker URL beside it, because the
  // two files ship side by side: `public/sandbox/` is copied into the export
  // whole. Reasoning about the repository from a line that runs in the export is
  // what left this `''` in every build ever made. `docs/GATE.md` has the
  // measurement.
  //
  // GZIPPED, and that is what makes the deploy possible rather than an
  // optimisation. The module is 107,054,914 bytes, GitHub blocks a file over
  // 100 MiB, and the block is on the file at rest — so the uncompressed guest
  // could be in neither the repository nor the Pages deploy, and every `shell`
  // call on the live page reached a 404. `gzip -9` is 40,029,960 bytes, which
  // GitHub takes, and `vm-worker.js` inflates it with `DecompressionStream`.
  //
  // The build-time override survives, and stays build-time. Which host serves
  // the image is a property of the DEPLOY, not of the person visiting it: a
  // deploy whose host will not serve 107 MB is redirected once, for everybody,
  // with `SANDBOX_IMAGE=<url> bun run build`. As a user setting it would be a
  // URL nobody visiting can know, stored in a database only their own browser
  // reads, and every other visitor would still be broken.
  const sandbox = new C2wSandbox({
    imageUrl: process.env.NEXT_PUBLIC_SANDBOX_IMAGE || `${base}/sandbox/sandbox.wasm.gz`,
    workerUrl: `${base}/sandbox/vm-worker.js`,
  })

  const settingsRepository = make('Settings', STORE_SETTINGS)
  const settings = new SettingsService(settingsRepository)
  // One instance, handed to both the route table and the chat use case. Two
  // would be two write queues over one store, which is the interleaving the
  // queue exists to stop — and a second author of the conversation schema is
  // exactly the defect this replaced.
  const conversations = new ConversationService(make('Conversation', STORE_CONVERSATIONS))

  // The agent's own files, in the same database and behind the same port as
  // everything else. ONE instance, handed to the chat use case as a port and
  // registered on the kernel through `FilesService` below — two would be two
  // write queues over one store, which is the interleaving a queue exists to
  // stop, and it is the same argument `ConversationService` is built on.
  //
  // This line used to end "NOTHING registers it on the kernel, because no
  // component asks for it ... the day the page grows a file view is the day it
  // earns one". That day is this one. The sentence is rewritten rather than
  // left to rot beside a `register` call that contradicts it: a citation that
  // still resolves while the fact under it has inverted is the most expensive
  // kind this tree makes.
  const files = new Workspace(make('File', STORE_FILES))

  const chat = new ChatService({
    conversations,
    settings,
    catalogue,
    pool,
    sandbox,
    files,
    http: browserHttp,
  })

  const kernel = new Kernel()
    .register('conversations', conversations)
    .register('settings', settings)
    .register('chat', chat)
    .register('agents', new AgentService(catalogue, pool))
    // Read-only, and `FilesService` argues why at length. The short version:
    // the store is safe from interleaving and it is not safe from a person
    // saving a file the agent rewrote while they were reading it.
    .register('files', new FilesService(files))

  // Said out loud, in the one place the user reads notes. Nothing else in this
  // app leaves the machine except the model call the user configured — but a
  // search cannot be served from inside a static page, so every query goes
  // unauthenticated to one third party, and the user is entitled to know which.
  notes.push(`web search sends the query to ${new URL(SEARCH_ENDPOINT).host}; nothing else does`)

  // The chat service comes back beside the kernel because the ports it was
  // handed are the one thing this file does that nothing else can witness. A
  // Kernel route is a bound method, so a caller holding the kernel cannot reach
  // the object behind it, and deleting the `http` line above left the whole gate
  // — lint, tests, export, smoke — green while every web tool answered "this
  // build cannot make an HTTP request" for ever.
  return { kernel, chat, notes, persistent: opened.ok }
}
