/**
 * The transcript — the message list one conversation is made of.
 *
 * It is the History component's source (2.6) and the only thing in the core
 * that grows across turns. Durability is not here: 3.4 owns the store, and a
 * transcript that wrote through a `StorePort` in wave 2 would be the migration
 * the realm split exists to prevent.
 *
 * A class rather than an array because the live list must not be handed out —
 * the Python kept a second name for it and compaction rebound the array out
 * from under that name, so a public attribute went on describing the
 * conversation as it used to be.
 */

export type Role = 'system' | 'user' | 'assistant'

export interface Message {
  role: Role
  content: string
}

export class Transcript {
  readonly #messages: Message[] = []

  /** Seed turns are adopted, not replayed: they already happened. */
  constructor(seed: readonly Message[] = []) {
    for (const turn of seed) this.add(turn.role, turn.content)
  }

  /** The conversation, as data. A copy: a caller may read it, never extend it. */
  get messages(): readonly Message[] {
    return this.#messages.map((m) => ({ ...m }))
  }

  get length(): number {
    return this.#messages.length
  }

  /** The newest message, or `null` when nothing has been said yet. */
  get last(): Message | null {
    return this.#messages[this.#messages.length - 1] ?? null
  }

  add(role: Role, content: string): void {
    this.#messages.push({ role, content })
  }
}
