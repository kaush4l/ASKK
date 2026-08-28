/**
 * Where each part of a prompt sits, and the sentinel that proves this module
 * reached the worker chunk and no other.
 *
 * **The integers are the load-bearing constant.** Ordering is structural, not
 * conventional: the assembler sorts on `(SLOT, priority)`, and these values are
 * what guarantee a prompt opens with who the agent is and closes with what it
 * must reply. The gaps of ten are room for a slot nobody has needed yet,
 * without renumbering the ones that have callers.
 *
 * Its own file because both directions of the tree read it — components
 * declare a slot, the assembler compares them, and `ui/prompt/BandStack.tsx`
 * renders the number — and a shared constant living inside either end would
 * make one of them import the other (ARCHITECTURE.md §4).
 */

/** The prompt order, as integers. Ties within a slot break on `priority`. */
export const Slot = Object.freeze({
  SOUL: 0, // who the agent is — always first
  SYSTEM: 10, // system instructions
  CONTEXT: 20, // the clock and whatever else is true right now — never cached
  SKILLS: 30, // loaded SKILL.md bodies
  PHASE: 40, // the current phase's own instructions
  HISTORY: 50, // the transcript
  TOOLS: 60, // toolbox usage lines
  RESPONSE: 99, // response contract + completion cue — always last
})

/**
 * The §8.1 bundle sentinel: a string only `src/core/` contains, which
 * `checks/bundle.ts` must find in no chunk reachable from the main entry.
 *
 * It is a value `PromptAssembler.detail()` **returns** rather than an unused
 * export, because the three quieter shapes all fail: unexported it is
 * unreachable, exported-and-unimported it trips `checks/orphans.ts`, and
 * exported-imported-but-unused it is tree-shaken away — leaving the check green
 * while core is bundled into the page, which is the worst outcome available.
 */
export const CORE_MARK = 'askk/core@prompt-assembler'
