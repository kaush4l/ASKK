/**
 * Counting tokens, not characters.
 *
 * Characters are a bad proxy: the same 100 characters are ~15 tokens of English
 * prose and ~40 of JSON, and every limit that matters — the context window, the
 * cache minimum, the bill — is denominated in tokens.
 *
 * There is no tokenizer here on purpose. The real one belongs to the model, it
 * differs per model, and shipping one would mean either a megabyte of vocabulary
 * for a number, or a number that is confidently wrong for whichever model the
 * user actually chose.
 *
 * So: estimate locally, then let the server correct it. Every OpenAI-compatible
 * reply carries `usage.prompt_tokens` — the exact count, by the only tokenizer
 * whose opinion counts. `TokenScale` remembers the ratio between what was
 * guessed and what was charged, and applies it to the next estimate. The
 * estimator gets better at the model in front of it and needs no updating when
 * the model changes.
 */

/**
 * Tokens, approximately.
 *
 * Tokenizers split on word pieces, so words are the unit to count, not
 * characters. English averages a little over one token per word; punctuation,
 * brackets and symbols are usually a token each, which is why structured text
 * costs so much more than prose of the same length. Long words split further,
 * charged here per five characters beyond the first eight.
 */
export function estimateTokens(text) {
  const source = String(text ?? '')
  if (!source) return 0

  let tokens = 0
  for (const word of source.split(/\s+/)) {
    if (!word) continue
    // Letters and digits form word pieces; everything else is its own token.
    const symbols = (word.match(/[^\p{L}\p{N}]/gu) ?? []).length
    const letters = word.length - symbols
    tokens += symbols
    if (letters > 0) tokens += 1 + Math.floor(Math.max(0, letters - 8) / 5)
  }
  // Newlines are tokens too, and a structured prompt is mostly newlines.
  tokens += (source.match(/\n/g) ?? []).length
  return tokens
}

/**
 * The correction factor between this estimator and one model's real tokenizer.
 *
 * Kept per model, because the ratio is a property of the vocabulary. Learned
 * slowly — a single turn is one sample, and jumping the scale to match it would
 * make the panel's numbers jitter for no reason.
 */
export class TokenScale {
  constructor(smoothing = 0.3) {
    this.smoothing = smoothing
    this._byModel = new Map()
  }

  /** What to multiply an estimate by for this model. 1 until something is known. */
  factorFor(model) {
    return this._byModel.get(model)?.factor ?? 1
  }

  /** True once a real count has been seen, so the UI can say estimated or measured. */
  knows(model) {
    return this._byModel.has(model)
  }

  /**
   * Teach it one measurement: what we guessed the whole prompt was, and what
   * the server said it actually was.
   */
  learn(model, estimated, actual) {
    if (!model || !(estimated > 0) || !(actual > 0)) return this.factorFor(model)
    const observed = actual / estimated
    const known = this._byModel.get(model)
    const factor = known ? known.factor + this.smoothing * (observed - known.factor) : observed
    this._byModel.set(model, { factor, samples: (known?.samples ?? 0) + 1 })
    return factor
  }

  /** An estimate, scaled by what has been learned about this model. */
  count(text, model = '') {
    return Math.round(estimateTokens(text) * this.factorFor(model))
  }
}
