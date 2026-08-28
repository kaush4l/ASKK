// REALM: main
/**
 * THE dispatch surface (§5.8): one named function per **intent**, each building
 * its `ToEngine` message and handing it to `worker-client.request()`.
 *
 * Two of §5.8's eight functions do not exist yet — six of them name a session,
 * a turn, a config record or an agent file, none of which the engine can serve
 * before 3.4 — and a function that builds a message no handler answers is the
 * same dead declaration one layer up. They arrive with their handlers.
 *
 * Why this is a seam and not a passthrough: the UI imports `probeEndpoint`, not
 * `{ type: 'config/probe' }`, so it never names a message type and a message
 * can be renamed or split without touching a component. `checks/protocol.ts`
 * rule 2 holds that in both directions — every `ToEngine` member is constructed
 * under `src/client/**`, and none is constructed under `src/ui/**` or
 * `src/app/**`.
 *
 * And dispatch is not a hook. These are plain async functions, callable from a
 * component handler, from a route effect, or from a test with no DOM — the
 * Door's on-load probe fires before any surface has mounted, which a hook
 * cannot serve. `use-store.ts` is the read side.
 */

import { request } from '@/client/worker-client'
import type { ProbeResult } from '@/protocol/shapes'

/**
 * Ask the worker what is at an endpoint (§6.2). The main realm cannot fetch, so
 * this is the only way the Door learns anything.
 *
 * It rejects when the request could not be served at all — a `baseUrl` that is
 * not an address — and resolves with an outcome when it could. That split is
 * the point: "you typed something that is not an address" and "nothing answered
 * at that address" are different problems with different remedies.
 */
export async function probeEndpoint(baseUrl: string, apiKey?: string): Promise<ProbeResult> {
  const reply = await request({ type: 'config/probe', baseUrl, apiKey })
  return reply.result
}
