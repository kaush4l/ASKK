/**
 * The braced form, for an endpoint whose model is better at JSON than at lines.
 *
 * It is a form a file may ASK for. That is the distinction the deleted `Format`
 * enum lost and this pair of modules restores: `BaseResponse.parse` reads JSON
 * out of a TOON contract as a REPAIR whatever this file does, and a repair is
 * not a permission. Asking for it here is the permission.
 */
export const json = {
  name: 'json',

  instructions(fieldDocs, example) {
    return [
      '# RESPONSE FORMAT',
      '',
      'Reply with a single JSON object carrying exactly these keys, and nothing outside it — no prose, no code fence:',
      '',
      fieldDocs,
      '',
      `Example:\n${example}`,
    ].join('\n')
  },

  example(names, valueFor) {
    const body = names.map((name) => `  ${JSON.stringify(name)}: ${JSON.stringify(valueFor(name))}`)
    return `{\n${body.join(',\n')}\n}`
  },
}
