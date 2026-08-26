/**
 * The prompt assembler — components in, one prompt string out.
 *
 *     new PromptAssembler().assemble(components)  ->  string
 *
 * The assembler is deliberately dumb. It does not know what a soul or a toolbox
 * is; it filters out components with nothing to say, sorts the rest on
 * `(SLOT, priority)`, checks the invariants, and joins the rendered parts.
 * Which components exist is the phase's decision, and what each one says is the
 * component's own — the assembler only guarantees the shape of the whole.
 *
 * Invariants, checked on every assemble and raised as errors rather than
 * silently repaired — a malformed prompt is a programming mistake, not a
 * runtime condition to paper over:
 *
 *   - exactly one RESPONSE component (the completion cue must exist, once)
 *   - at least one SOUL or SYSTEM component (an agent must be someone)
 *   - RESPONSE sorts last (guaranteed by Slot values; verified anyway)
 *
 * Rendered text is memoized per `component.key()`: a component whose fields
 * did not change renders once and is reused every turn after, which keeps the
 * expensive head of the prompt (soul, system, skills, tools, response contract)
 * byte-stable — exactly what an inference server's prefix cache wants to see.
 * CONTEXT components opt out via `CACHEABLE = false`; a cached clock is a
 * wrong clock. Parts are joined with no separator: each component carries its
 * own trailing spacing, which is what makes the output byte-identical to the
 * old engine's render.
 */

import { Slot } from "./component-base.js";

/**
 * `SLOT`, `CACHEABLE` and `NAME` are declared static on the component class —
 * the Python's `ClassVar`, which an instance could read and a JS instance
 * cannot. So the assembler reads them off the constructor, and `NAME` is what
 * the invariant messages print rather than `constructor.name`, which a minifier
 * is free to rewrite.
 *
 * @typedef {import("./component-base.js").Component} Component
 * @typedef {typeof import("./component-base.js").Component} ComponentClass
 *
 * @param {Component} component
 * @returns {ComponentClass}
 */
function meta(component) {
  return /** @type {ComponentClass} */ (/** @type {unknown} */ (component.constructor));
}

/**
 * The memo must not grow without bound across a long conversation — history
 * components get a new key every turn. Past this size it is simply dropped;
 * correctness never depended on it.
 */
export const MEMO_LIMIT = 512;

/** The component set cannot form a valid prompt. */
export class AssemblyError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    /** @type {string} */
    this.name = "AssemblyError";
  }
}

/** Python's `repr` of a list of names, which is what the message was written for.
 * @param {string[]} names
 * @returns {string}
 */
function nameList(names) {
  return names.length ? `[${names.map((n) => `'${n}'`).join(", ")}]` : "none";
}

/** Sorts, validates, memoizes and joins. Holds no opinion about content. */
export class PromptAssembler {
  constructor() {
    /** @type {Map<string, string>} */
    this._memo = new Map();
    /** @type {number} memo hits, for the efficiency check in tests */
    this.hits = 0;
    /** @type {number} */
    this.misses = 0;
  }

  /**
   * One prompt from these components. Throws `AssemblyError` on a bad set.
   *
   * @param {Component[]} components
   * @returns {string}
   */
  assemble(components) {
    const active = components
      .filter((c) => c.applies())
      .sort((a, b) => meta(a).SLOT - meta(b).SLOT || a.priority - b.priority);
    this._check(active);
    let prompt = "";
    for (const component of active) prompt += this._render(component);
    return prompt;
  }

  /**
   * @param {Component[]} ordered
   * @returns {void}
   */
  _check(ordered) {
    const responses = ordered.filter((c) => meta(c).SLOT === Slot.RESPONSE);
    if (responses.length !== 1) {
      throw new AssemblyError(
        `A prompt needs exactly one RESPONSE component, got ${responses.length}: ` +
          nameList(responses.map((c) => meta(c).NAME)),
      );
    }
    if (!ordered.some((c) => meta(c).SLOT === Slot.SOUL || meta(c).SLOT === Slot.SYSTEM)) {
      throw new AssemblyError(
        "A prompt needs a SOUL or SYSTEM component — an agent must be someone.",
      );
    }
    const last = ordered[ordered.length - 1];
    if (meta(last).SLOT !== Slot.RESPONSE) {
      throw new AssemblyError(`${meta(last).NAME} sorts after the RESPONSE component.`);
    }
  }

  /**
   * @param {Component} component
   * @returns {string}
   */
  _render(component) {
    if (!meta(component).CACHEABLE) return component.render();

    const key = component.key();
    const cached = this._memo.get(key);
    if (cached !== undefined) {
      this.hits += 1;
      return cached;
    }

    this.misses += 1;
    if (this._memo.size >= MEMO_LIMIT) this._memo.clear();
    const text = component.render();
    this._memo.set(key, text);
    return text;
  }
}
