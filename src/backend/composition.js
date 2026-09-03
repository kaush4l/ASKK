import { AgentCatalogue } from '../core/agent/AgentCatalogue.js'
import { SEARCH_ENDPOINT } from '../core/tools/SearchTool.js'
import { AgentWorkerPool } from './AgentWorkerPool.js'
import { browserHttp } from './browserHttp.js'
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
import { HealthService } from './services/HealthService.js'
import { ScheduleService } from './services/ScheduleService.js'
import { SettingsService } from './services/SettingsService.js'

// Re-exported because it was defined here for four waves and one test, one
// document and every reader's memory point at this name. It is one function and
// it now has two callers; `browserHttp.js` says why it moved.
export { browserHttp }

export const DB_NAME = 'askk'
// 4 because schedules are a fourth store. `IndexedDb.open` creates only the
// stores that are missing, so an existing database keeps its conversations, its
// settings and the agent's files and gains one — a version that did not move
// would leave every browser that has already opened this app without a
// schedules store at all, and every write to it failing on a name the database
// has never heard of. That is the same argument version 3 was made for.
export const DB_VERSION = 4
export const STORE_CONVERSATIONS = 'conversations'
export const STORE_SETTINGS = 'settings'
export const STORE_FILES = 'files'
export const STORE_SCHEDULES = 'schedules'

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
export async function buildKernel() {
  const db = new IndexedDb(DB_NAME, DB_VERSION, [
    STORE_CONVERSATIONS,
    STORE_SETTINGS,
    STORE_FILES,
    STORE_SCHEDULES,
  ])
  const opened = await db.open()
  const notes = opened.ok ? [] : [`storage unavailable: ${opened.failure.message}`]

  const make = (name, store) =>
    opened.ok ? new IndexedDbRepository(name, db, store) : new MemoryRepository(name)

  // Built from an inlined constant, not the router: this runs in a worker,
  // which has no router and no document to resolve a relative URL against.
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? ''
  const catalogue = new AgentCatalogue(base)
  // The prefix goes to the pool, which passes it to every sub-agent thread. It
  // is derived here, once, for the same reason the image URL beside it is.
  const pool = new AgentWorkerPool({ basePath: base })

  // The sandbox is constructed, not booted. Its image is ~50 MB compressed and
  // an agent that never needs the guest must never download it.
  //
  // WHAT PAYS FOR IT, corrected by `scripts/deploy-check.js` against the built
  // deploy: the first thing that needs a guest COMMAND, which is not the same
  // as the first `shell` call — the sentence this comment carried for three
  // waves. An agent whose file declares an mcp server runs one guest command to
  // list that server's tools, once a session, before the first prompt is
  // rendered; `agents/main/agent.md` declares one, so this app's very first
  // message pays for the image even when it asks for nothing. The check prints
  // CLAIM CONFIRMED or CLAIM REFUTED on every run rather than asserting, and it
  // printed REFUTED against the sentence that used to be here.
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
    // The page reads freely and writes only against a precondition, which
    // `FilesService` argues at length. The short version: the store is safe
    // from interleaving and it was never safe from a person saving a file the
    // agent rewrote while they were reading it, so the page has to say what it
    // expected to find and is refused when that is no longer what is there.
    .register('files', new FilesService(files))
    // Whether a QUESTION can be answered, which every other boot note is silent
    // about: storage, the worker and the guest can all be fine while the model
    // this app was told to call is not running.
    .register('health', new HealthService({ settings, http: browserHttp }))
    // Questions that ask themselves. Nothing here holds a timer — the page
    // ticks, under a lock, and this only says what is due; `ScheduleService`
    // argues why the clock lives in the realm that can see a user.
    .register('schedules', new ScheduleService(make('Schedule', STORE_SCHEDULES)))

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
