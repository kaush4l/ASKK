/**
 * WHAT `bun test` CANNOT REACH. IndexedDB and OPFS do not exist on the host, so
 * the claims about them are executed in a real browser instead — by a page
 * `serve.js` serves and drives, run with
 * `bun --cwd packages/adapters-web run checks:browser`.
 *
 * THESE FIVE ARE NOT IN `bun run gate` AND A HUMAN RUNS THEM. The gate is the
 * whole standard for everything it can execute (I17), and it has no browser; a
 * green gate therefore says nothing about the five claims below, which is why
 * the command is named here rather than left to a commit message.
 */

import { get, post } from '@harness/kernel'
import { bootLog, freshLog, segStream } from '@harness/core'
import { attach, bootBrowser, idbKv, idbSegments, idbStore, openDb, openWorkspace } from '@harness/adapters-web'

/** @typedef {{name: string, ok: boolean, detail: string}} Result */

const CLOCK = { now: () => 1 }

/** The db, with every transaction it opens counted — I20 is a claim about the SHAPE of the access. */
function counted(/** @type {IDBDatabase} */ db) {
  let txns = 0
  const seen = () => txns
  const proxy = /** @type {IDBDatabase} */ (/** @type {unknown} */ ({
    transaction: (/** @type {string} */ store, /** @type {IDBTransactionMode} */ mode) => {
      txns += 1
      return db.transaction(store, mode)
    },
  }))
  return { db: proxy, seen }
}

/** @param {string} name @param {() => Promise<string>} body @returns {Promise<Result>} */
async function check(name, body) {
  try {
    return { name, ok: true, detail: await body() }
  } catch (err) {
    return { name, ok: false, detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err) }
  }
}

function assert(/** @type {boolean} */ ok, /** @type {string} */ said) {
  if (!ok) throw new Error(said)
}

/** @returns {Promise<Result[]>} */
export async function runSuite() {
  const name = `harness-browser-check-${Date.now()}`
  const db = await openDb(name)
  const results = [
    await check('a real IndexedDB round-trips text, bytes and a prefix listing', () => storeRoundTrip(db)),
    await check('replacePrefix swaps a whole prefix in ONE transaction', () => replaceIsOneTransaction(db)),
    await check('a cold boot over 10,000 persisted facts issues a bounded number of transactions', () => boundedBoot(db)),
    await check('durable() is true and a file survives being opened again', () => filesAreDurable()),
    await check('bootBrowser returns an App the interface can call handle on', () => theProductBoots()),
  ]
  db.close()
  indexedDB.deleteDatabase(name)
  return results
}

/**
 * THE WHOLE COMPOSITION ROOT, IN A REAL BROWSER: the real store, the real
 * catalogue, and the three things the interface is handed. `basePath` points at
 * the app's own `public/`, which is where `models.json` is served from.
 */
async function theProductBoots() {
  const app = await bootBrowser({ basePath: '/apps/web/public/' })
  const { seam, subscribe } = attach(app)
  let woken = 0
  subscribe(() => (woken += 1))
  assert(seam(get('/chat')).view === 'chat', 'the seam did not project a transcript')
  const posted = seam(post('/chat', { message: 'hello from the browser' }))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert(posted.status === 200, `posting a message answered ${posted.status}`)
  assert(woken === 1, `the log grew and subscribe fired ${woken} times`)
  assert(app.available.includes('workspace'), 'this browser has OPFS and workspace was not granted')
  assert(!app.available.includes('agents'), 'delegation was granted with no Worker behind it')
  const resolved = app.ports.model.resolves('local')
  assert(resolved !== null, 'the catalogue was read and "local" still resolved to nothing')
  return `${app.available.length} capabilities granted, "local" resolves to ${resolved?.model ?? ''}`
}

/** @param {IDBDatabase} db */
async function storeRoundTrip(db) {
  const store = idbStore(db)
  await store.kv.put('config/keys/model', '{"selected":"local"}')
  assert((await store.kv.get('config/keys/model')) === '{"selected":"local"}', 'the value did not come back')
  assert((await store.kv.get('config/keys/absent')) === null, 'a missing key must answer null, not undefined')
  await store.blob.write('export/log.ndjson', new Uint8Array([1, 2, 3]))
  const bytes = await store.blob.read('export/log.ndjson')
  assert(bytes?.length === 3 && bytes[2] === 3, 'the bytes did not come back')
  await store.kv.put('config/keys/search', 'https://search.test')
  const keys = await store.kv.listPrefix('config/keys/')
  assert(keys.length === 2, `a prefix listing returned ${keys.length} keys, expected 2`)
  return `${keys.length} keys under the prefix, ${bytes?.length ?? 0} bytes back`
}

/** @param {IDBDatabase} db */
async function replaceIsOneTransaction(db) {
  const { db: watched, seen } = counted(db)
  const kv = idbKv(watched)
  await kv.replacePrefix('seg/old/', [['seg/old/0', 'a'], ['seg/old/1', 'b']])
  const before = seen()
  await kv.replacePrefix('seg/old/', [['seg/old/0', 'c']])
  const spent = seen() - before
  assert(spent === 1, `replacing a prefix took ${spent} transactions, not 1`)
  const left = await kv.listPrefix('seg/old/')
  assert(left.length === 1 && (await kv.get('seg/old/0')) === 'c', 'the old prefix survived the replace')
  return `one transaction, ${left.length} record left`
}

/**
 * TEN THOUSAND FACTS, AGAINST THE REAL STORE. The predecessor issued one
 * read-only transaction per fact; the claim here is that a boot's cost does not
 * grow with the history at all.
 * @param {IDBDatabase} db
 */
async function boundedBoot(db) {
  const stream = `bounded-${Date.now()}`
  const segments = idbSegments(db)
  const writing = freshLog(segments, { clock: CLOCK, stream })
  for (let i = 0; i < 10_000; i++) writing.append({ type: 'request_handled', path: `/chat/${i}`, status: 200 }, i)
  const flushed = await writing.persist()
  assert(flushed.failure === null, `persisting 10,000 facts failed: ${flushed.failure?.message ?? ''}`)
  const { db: watched, seen } = counted(db)
  const booted = await bootLog(idbSegments(watched), { clock: CLOCK, stream })
  assert(booted.length === 10_000, `the boot read back ${booted.length} facts, not 10,000`)
  assert(seen() <= 4, `a cold boot issued ${seen()} transactions; it must not grow with the history`)
  assert(booted.resident <= 512, `${booted.resident} facts are resident; the head segment is 512`)
  const records = await segments.range(segStream(stream))
  return `${records.length} records, ${seen()} transactions, ${booted.resident} facts resident`
}

/**
 * The one thing the emulator never did. Files are written through one port and
 * read back through a SECOND one opened from scratch — which is what a reload
 * is, minus the reload.
 */
async function filesAreDurable() {
  const workspace = await openWorkspace()
  assert(workspace !== null, 'this browser offers no OPFS, so nothing here is durable')
  const port = /** @type {NonNullable<typeof workspace>} */ (workspace)
  assert(port.durable() === true, 'durable() answered false')
  const path = `notes/kept-${Date.now()}.md`
  await port.write(path, 'this survives\nthe reload\n')
  const again = /** @type {NonNullable<typeof workspace>} */ (await openWorkspace())
  const read = await again.read(path)
  assert(read.text.startsWith('this survives'), `what came back was ${JSON.stringify(read.text)}`)
  const listed = await again.list('notes')
  assert(listed.some((entry) => path.endsWith(entry.name)), 'the file was not in the listing')
  let refused = ''
  try {
    await again.exec('echo hi')
  } catch (err) {
    refused = err instanceof Error ? err.message : String(err)
  }
  assert(refused.includes('nowhere to run'), 'exec must say there is no shell, not return an empty execution')
  return `durable, ${listed.length} file(s) listed, exec refused in words`
}
