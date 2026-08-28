/**
 * The port seam — the one place the environment enters the pure core.
 *
 * `src/core/**` may not reach for a clock, the network, storage or randomness.
 * Every one of those arrives here, as a function handed in at construction, so
 * that the core runs under `bun test` with no browser and a prompt can be
 * compared byte-for-byte against a recorded golden file. `scripts/checks/purity.ts`
 * is what keeps that true; this file is what makes it possible.
 *
 * ARCHITECTURE.md §5.1 is the contract. Four members. As of 2.2 exactly ONE has
 * a caller — `FetchPort`, taken by `Inference` — and `clock`, `store` and
 * `newId` still have none; they arrive at 2.6, 2.4 and 2.4.
 *
 * This sentence read "four members, each with a caller" for two waves while
 * none of them did. It is the worked example in §8.7 of what `checks/docs.ts`
 * cannot catch: well-formed, referring to nothing external, and false. Keep it
 * counted honestly, or delete the count.
 */

/** Right now, and the IANA zone it is expressed in. */
export interface ClockPort {
  now(): Date
  /**
   * The zone is part of the contract because the context block renders
   * `PDT`, which a `Date` alone cannot produce — and reading the host's zone
   * inside the core would be exactly the ambient environment this seam removes.
   */
  zone(): string
}

/** The only way out of the process; the same signature as the global, so the global can be passed directly. */
export type FetchPort = (input: string, init?: RequestInit) => Promise<Response>

/** One conversation. `nextSeq` and `nextTurnOrdinal` are allocated by the store, never by a caller (§7.2). */
export interface SessionRecord {
  id: string
  agent: string
  createdAt: number
  updatedAt: number
  status: 'idle' | 'running'
  runningTurnId: string | null
  nextSeq: number
  nextTurnOrdinal: number
}

/** A message as the caller offers it. It carries no `seq` and no `id`, because it may not compute either. */
export interface NewMessage {
  role: string
  content: string
  turnId: string
  at: number
}

/** A message as the store returns it. */
export interface MessageRecord extends NewMessage {
  id: string
  sessionId: string
  seq: number
}

/** One thing that happened inside a turn. */
export interface NewEvent {
  kind: string
  data: unknown
  at: number
}

/** Durable memory as five verbs. */
export interface StorePort {
  putSession(s: SessionRecord): Promise<void>
  readSession(id: string): Promise<SessionRecord | null>
  /**
   * Appends and **returns the sequence number it allocated**. A caller that
   * computed its own `seq` by reading the tail would lose one of two
   * overlapping turns at the first `await` between the read and the write.
   */
  appendMessage(sessionId: string, m: NewMessage): Promise<number>
  readMessages(sessionId: string, afterSeq?: number): Promise<MessageRecord[]>
  appendEvent(sessionId: string, turnOrdinal: number, e: NewEvent): Promise<void>
}

/** Ambient randomness, made explicit, so a test can produce reproducible turn ids. */
export type NewIdPort = () => string

export interface Ports {
  clock: ClockPort
  fetch: FetchPort
  store: StorePort
  newId: NewIdPort
}

/**
 * REMOVED at the wave-1 retro: `isConfigured`, its `NOT_CONFIGURED` symbol and
 * the `mark()` that applied it. They had zero callers outside their own test,
 * which is §8.6's most-repeated defect in this project shipped once more. It
 * returns with the first capability check that needs it — wave 3 — and when it
 * does, note that `docs/scratch/SALVAGE.md` item 4 is right about *why*:
 * `if (ports.store)` is **true** for a stub, so presence is not configuration
 * and a capability registered on truthiness dies at the call site.
 */

/** A function that reports the missing port instead of quietly doing nothing. */
function missing<F>(name: string): F {
  const stub = (): never => {
    throw new Error(`no ${name} port configured`)
  }
  return stub as unknown as F
}

/**
 * Ports that all fail loudly. This is the floor every real adapter is layered
 * over: a port nobody wired must announce itself at the call, because a silent
 * no-op store loses a conversation and says nothing about it.
 */
export function stubPorts(): Ports {
  return {
    clock: { now: missing<ClockPort['now']>('clock.now'), zone: missing<ClockPort['zone']>('clock.zone') },
    fetch: missing<FetchPort>('fetch'),
    store: {
      putSession: missing<StorePort['putSession']>('store.putSession'),
      readSession: missing<StorePort['readSession']>('store.readSession'),
      appendMessage: missing<StorePort['appendMessage']>('store.appendMessage'),
      readMessages: missing<StorePort['readMessages']>('store.readMessages'),
      appendEvent: missing<StorePort['appendEvent']>('store.appendEvent'),
    },
    newId: missing<NewIdPort>('newId'),
  }
}
