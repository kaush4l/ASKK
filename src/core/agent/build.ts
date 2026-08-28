/**
 * The composition root — the one place `promptFor` meets `new Agent`.
 *
 *     const agent = buildAgent({ recipe, inference, ports })
 *     const reply = await react(agent, 'please echo hey')
 *
 * Everything this file does is fit two things that already exist to each other.
 * That is a small job and it is the whole point: until 2.8 the assembler and
 * the loop had each been proven and had **never run in the same process**
 * (`docs/scratch/FLOW.md`), the agent tests filled the prompt seam with a
 * one-line double, and every check in the gate had a file for its subject and
 * none had a relationship.
 *
 * Two fittings, and nothing else:
 *
 * - `recipe` → `RenderPrompt`, via `promptFor`, with the real assembler. There
 *   is no second path to prompt bytes; `tests/turn.test.ts` compares what the
 *   **transport received** against `tests/golden/render-*.prompt`, so a double
 *   put back here is a red test rather than a silent one.
 * - `recipe.model` → `ReplyModel`, which is the `BaseResponse` → loop adapter.
 *   The recipe already declares the response class because the prompt's
 *   contract instructions come from the same table that parses the reply — one
 *   declaration, both halves — so taking the class a second time as its own
 *   option would be two places holding one fact.
 *
 * Everything else passes straight to the `Agent` untouched, which is why it is
 * spread rather than enumerated: a field this file names is a field it can get
 * wrong, and it has no opinion about any of them.
 *
 * Its second caller is `engine/build-agent.ts` at 4.1 — the thin thing that
 * reads a config record and an `agent.md` and calls this. Until then its only
 * caller is a test, which is the shape FLOW indicted, so it holds an entry in
 * `checks/reach.ts`'s allowlist (2.9) expiring at the **end of wave 4**.
 */

import { Agent, PLAIN_TEXT } from '@/core/agent/agent'
import type { AgentOptions, ReplyModel } from '@/core/agent/agent'
import { promptFor } from '@/core/prompt/recipe'
import type { Recipe } from '@/core/prompt/recipe'
import { PromptAssembler } from '@/core/prompt/assembler'
import { DEFAULT_FORMAT } from '@/core/response/base'
import type { BaseResponse, Format, ResponseClass } from '@/core/response/base'

/**
 * A recipe, plus everything `Agent` takes that this file does not compute.
 *
 * `prompt` and `model` are omitted rather than optional: they are what the
 * recipe decides, and a caller who could still pass a `prompt` would have the
 * double back.
 */
export type BuildAgentOptions = Omit<AgentOptions, 'prompt' | 'model'> & {
  recipe: Recipe
  /**
   * The assembler, when one must outlive a single agent. It holds the memo, so
   * a shared one keeps the expensive head of the prompt byte-stable across
   * every agent that shares it; the default is one per agent.
   */
  assembler?: PromptAssembler
}

/**
 * A response class read as the two things the loop needs of a reply.
 *
 * The cast is the one place the recipe's `typeof BaseResponse` — abstract, so
 * TypeScript will not hand it to `parse`, whose `this` must be constructible —
 * meets the `ResponseClass` view that `parse` and `answerOf` declare. Every
 * value that arrives here is a concrete subclass; the abstractness is in the
 * type and never in the value.
 *
 * `format` is the recipe's, because the prompt told the model which format to
 * reply in and parsing in the other one first would be reading the reply
 * against instructions we did not send.
 */
function replyModel(model: typeof BaseResponse | null | undefined, format: Format): ReplyModel {
  if (model === null || model === undefined) return PLAIN_TEXT
  const cls = model as typeof BaseResponse & ResponseClass<BaseResponse>
  return {
    parse: (raw) => cls.parse(raw, format),
    answerOf: (text) => cls.answerOf(text),
  }
}

/** An agent whose prompt is the real one. */
export function buildAgent(options: BuildAgentOptions): Agent {
  const { recipe, assembler, ...rest } = options
  return new Agent({
    ...rest,
    prompt: promptFor(recipe, assembler ?? new PromptAssembler()),
    model: replyModel(recipe.model, recipe.format ?? DEFAULT_FORMAT),
  })
}
