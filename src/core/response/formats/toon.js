/**
 * The line-oriented form, and the default.
 *
 * TOON is what small local models follow far more reliably than they produce
 * valid JSON: one `name: value` per line, blank line between, no punctuation to
 * balance. The measurement behind the SIZE of the contract block is in
 * `BaseResponse` and is not repeated here — what lives in this file is the
 * shape only.
 */
export const toon = {
  name: 'toon',

  instructions(fieldDocs, example) {
    return [
      '# RESPONSE FORMAT',
      '',
      'Reply with exactly these fields, in this order, one per line as `name: value`, blank line between:',
      '',
      fieldDocs,
      '',
      `Example:\n${example}`,
    ].join('\n')
  },

  example(names, valueFor) {
    return names.map((name) => `${name}: ${valueFor(name)}`).join('\n\n')
  },
}
