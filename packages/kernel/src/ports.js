/**
 * The port contracts. Pure packages describe I/O against these; adapters
 * implement them; the composition root injects them. They are TYPEDEFS and not
 * classes: a port is a bag of functions, `implements` buys nothing in JS, and a
 * test double should be an object literal written in the test that needs it.
 *
 * Every port is async except `ClockPort` and `RngPort`, because time and
 * randomness are values, not operations (I7 — both are injected so the core is
 * deterministic under test).
 * @module
 */

/** @typedef {import('./ids.js').Timestamp} Timestamp */
/** @typedef {import('./ids.js').EndpointName} EndpointName */

/** @typedef {{now: () => Timestamp}} ClockPort */

/** @typedef {{bytes: (n: number) => Uint8Array}} RngPort */

/**
 * Key -> string store. Narrow on purpose: prefixes ARE the namespace, so
 * `listPrefix` is the only query the system is allowed to need.
 * @typedef {{
 *   get: (key: string) => Promise<string|null>,
 *   put: (key: string, value: string) => Promise<void>,
 *   delete: (key: string) => Promise<void>,
 *   listPrefix: (prefix: string) => Promise<string[]>,
 *   replacePrefix: (prefix: string, entries: Array<[string, string]>) => Promise<void>,
 * }} KvStore
 */

/**
 * Path -> bytes, for large append-heavy payloads (log segments, exports).
 * Separate from `KvStore` so the substrate split stays an adapter decision.
 * @typedef {{
 *   read: (path: string) => Promise<Uint8Array|null>,
 *   write: (path: string, bytes: Uint8Array) => Promise<void>,
 *   delete: (path: string) => Promise<void>,
 *   listPrefix: (prefix: string) => Promise<string[]>,
 * }} BlobStore
 */

/** @typedef {{kv: KvStore, blob: BlobStore}} StorePort */

/** @typedef {{inputTokens: number, outputTokens: number, cachedInputTokens: number|null}} Usage */

/**
 * One completed model reply. `text` is the assistant's answer; `reasoning` is
 * a reasoning model's visible thinking, kept SEPARATE because it must not be
 * fed back as history (it is this turn's scratch, not the conversation).
 * `calls` are provider-native tool calls, already parsed — the port is the only
 * layer that knows the provider's wire shape.
 * `finish` is WHY THE PROVIDER STOPPED, and it is on the port because the port
 * is the one layer that sees the wire. Without it a call-less reply has to be
 * GUESSED at, and every guess reads the same: a completed answer. A truncation
 * at the output ceiling, a refusal, a content filter and a finished sentence
 * become one outcome — which is the exact failure the loop's ending vocabulary
 * exists to prevent. `'unknown'` is a legal value and it is not a synonym for
 * `'stop'`: a provider that does not say gets a turn that ends NAMING the
 * string it could not read, rather than one that claims to have been answered.
 * @typedef {'stop'|'tool_calls'|'length'|'content_filter'|'refusal'|'error'|'unknown'} FinishReason
 */

/**
 * @typedef {{
 *   text: string,
 *   reasoning: string,
 *   calls: Array<{id: string, tool: string, args: string}>,
 *   finish: FinishReason,
 *   usage: Usage|null,
 *   raw: unknown,
 * }} ModelReply
 */

/**
 * External inference (inference is external, always). Takes a SYMBOLIC endpoint
 * name — the adapter resolves it and attaches the credential, so a key can
 * never appear upstream of this contract (I6).
 *
 * `onDelta` is how streaming reaches the screen without the core learning what
 * a stream is: the port calls it with text as it arrives and still resolves
 * with the whole reply. A port that cannot stream simply never calls it (I15).
 * @typedef {{
 *   call: (
 *     endpoint: EndpointName,
 *     body: Record<string, unknown>,
 *     opts?: {signal?: AbortSignal, onDelta?: (delta: {text?: string, reasoning?: string}) => void},
 *   ) => Promise<ModelReply>,
 *   resolves: (asked: string) => {endpoint: string, model: string}|null,
 * }} ModelPort
 */

/**
 * A brokered outbound request: a path under a NAMED endpoint's base URL. There
 * is no raw-URL field, and that absence is the I6 enforcement.
 * @typedef {{method: string, path: string, headers?: Record<string,string>, body?: string}} BrokeredRequest
 */

/** @typedef {{status: number, body: string}} BrokeredResponse */

/**
 * Brokered general network. Distinct from `ModelPort` because the model path
 * adds credentials and streaming rules; this one is plain allowlisted HTTP.
 * @typedef {{fetch: (endpoint: EndpointName, req: BrokeredRequest, opts?: {signal?: AbortSignal}) => Promise<BrokeredResponse>}} NetPort
 */

/**
 * Another agent, reachable ONLY by message. The core names an agent and hands
 * it a goal; it never holds that agent's loop, its engine, or its state.
 * @typedef {{
 *   delegate: (agent: string, goal: string, opts?: {signal?: AbortSignal}) => Promise<string>,
 *   roster: () => string[],
 * }} AgentPort
 */

/** @typedef {{code: number, stdout: string, stderr: string, truncated: boolean, ms: number}} Execution */

/**
 * The place an agent can run commands and keep files. A port like any other:
 * the core knows there is somewhere to run a command and nothing about what
 * runs it, so the exec tool and its gate test on the host against a fake (I3).
 * @typedef {{
 *   exec: (command: string, opts?: {timeoutMs?: number, signal?: AbortSignal}) => Promise<Execution>,
 *   read: (path: string, opts?: {offset?: number, limit?: number}) => Promise<{text: string, truncated: boolean, lines: number}>,
 *   write: (path: string, text: string) => Promise<void>,
 *   list: (path: string) => Promise<Array<{name: string, dir: boolean, size: number}>>,
 *   interrupt: () => string,
 *   durable: () => boolean,
 * }} WorkspacePort
 */

/**
 * Everything injected at the composition root, in one bundle — a struct and not
 * nine parameters, so adding a port later touches the roots and nothing between.
 * @typedef {{
 *   clock: ClockPort, rng: RngPort, store: StorePort, model: ModelPort,
 *   net: NetPort, agents: AgentPort, workspace: WorkspacePort, spaces: KvStore,
 * }} Ports
 */

export {}
