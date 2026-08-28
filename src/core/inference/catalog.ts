/**
 * The catalogue — a kind string to a transport.
 *
 * 2.2 deliberately did not write this: a factory with one entry is a knob with
 * one caller. With `OpenAiInference` beside `ScriptedInference` it has a
 * decision to make, and `models.json`'s `kind` field (`SALVAGE.md` item 12) is
 * the string it makes it from, so a new server is a catalogue row rather than
 * a code change.
 *
 * There is no registry and no `register()` seam. Two entries do not need one,
 * and a plugin point with no plugin is the speculative generality CLAUDE.md
 * forbids. The old tree's `anthropic` and `claude` kinds are not here: nothing
 * implements them, and an entry for a class that does not exist is exactly the
 * lie `LESSONS.md` defect 3 records.
 */

import type { Inference, InferenceConfig } from '@/core/inference/base'
import { OpenAiInference } from '@/core/inference/openai'
import { ScriptedInference } from '@/core/inference/scripted'
import type { FetchPort } from '@/core/ports'

/** Every kind this build can actually construct, in the spelling `models.json` uses. */
export const KINDS = ['openai', 'scripted'] as const

export type InferenceKind = (typeof KINDS)[number]

/**
 * Build the transport a kind names.
 *
 * `scripted` is constructed with an **empty** fixture, because the signature
 * §5.2 declares carries a config and a way out and no place to put a script.
 * That is not a silent hole: a scripted transport with no fixture refuses its
 * first call with `scripted inference has no reply 1 — the fixture holds 0`,
 * naming what is missing. A test that wants a fixture constructs
 * `ScriptedInference` directly, which is what `tests/inference.test.ts` does.
 */
export function inferenceFor(kind: string, config: InferenceConfig, fetchPort: FetchPort): Inference {
  if (kind === 'openai') return new OpenAiInference(config, fetchPort)
  if (kind === 'scripted') return new ScriptedInference(config, fetchPort, [])
  throw new Error(`Unknown model kind '${kind}'. Known: ${KINDS.join(', ')}`)
}
