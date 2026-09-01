import { AgentCatalogue } from '../core/agent/AgentCatalogue.js'
import { AgentWorkerPool } from './AgentWorkerPool.js'
import { Kernel } from './Kernel.js'
import { IndexedDb } from './repositories/IndexedDb.js'
import { IndexedDbRepository } from './repositories/IndexedDbRepository.js'
import { MemoryRepository } from './repositories/MemoryRepository.js'
import { C2wSandbox } from './sandbox/C2wSandbox.js'
import { AgentService } from './services/AgentService.js'
import { ChatService } from './services/ChatService.js'
import { ConversationService } from './services/ConversationService.js'
import { SettingsService } from './services/SettingsService.js'

export const DB_NAME = 'askk'
export const DB_VERSION = 2
export const STORE_CONVERSATIONS = 'conversations'
export const STORE_SETTINGS = 'settings'

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
  db = new IndexedDb(DB_NAME, DB_VERSION, [STORE_CONVERSATIONS, STORE_SETTINGS]),
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
  // The image URL is a setting rather than a constant because the artifact is
  // far too large to live in a repository: the app is told where it is hosted.
  // Empty means no sandbox, and the shell tool says so instead of failing.
  const sandbox = new C2wSandbox({
    imageUrl: process.env.NEXT_PUBLIC_SANDBOX_IMAGE ?? '',
    workerUrl: `${base}/sandbox/vm-worker.js`,
  })

  const conversations = make('Conversation', STORE_CONVERSATIONS)
  const settingsRepository = make('Settings', STORE_SETTINGS)
  const settings = new SettingsService(settingsRepository)

  const kernel = new Kernel()
    .register('conversations', new ConversationService(conversations))
    .register('settings', settings)
    .register('chat', new ChatService(conversations, settings, catalogue, pool, { sandbox }))
    .register('agents', new AgentService(catalogue, pool))

  if (!sandbox.available) {
    notes.push('no sandbox image is configured, so the shell tool cannot run commands')
  }

  return { kernel, notes, persistent: opened.ok }
}
