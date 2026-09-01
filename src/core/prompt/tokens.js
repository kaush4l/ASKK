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
 * So: estimate locally, and spend the server's number where there is one. Every
 * reply carries `usage.prompt_tokens` — the exact count, by the only tokenizer
 * whose opinion counts — and `Budget` counts from that rather than from this.
 * The estimate is uncalibrated on purpose: a per-model correction factor sat
 * beside this function for six waves with no caller, and a calibration nothing
 * feeds is a number the panel would show as learned when it was not.
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
