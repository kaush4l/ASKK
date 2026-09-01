import { describe, expect, test } from 'bun:test'
import { highlight, LANGUAGES, languageOf } from '../../src/client/highlight.js'

/**
 * A file the agent might plausibly have written, one per language.
 *
 * Deliberately awkward rather than tidy: a `//` inside a string, a `#` inside a
 * quoted shell word, a fence inside Markdown. A highlighter that is going to be
 * wrong is wrong on these and right on a clean sample.
 */
const SAMPLES = {
  'main.js': `// count the words\nconst re = /"[^"]*"/g // not a string\nexport function n(s) {\n  return s.split(' ').length + 0x1f\n}\n`,
  'data.json': `{"ok": true, "n": -12.5, "s": "a \\" b", "z": null}\n`,
  'tool.py': `# entry\nimport sys\n\ndef main(argv):\n    """docstring # not a comment"""\n    return len(argv) - 1\n`,
  'run.sh': `#!/bin/sh\nset -eu\nfor f in $HOME/*; do\n  echo "\${f} # still a string"\ndone\n`,
  'main.c': `#include <stdio.h>\n/* block */\nint main(void) {\n  printf("hi // not a comment\\n");\n  return 0;\n}\n`,
  'notes.md': `# Plan\n\n> quoted\n\n- one\n- two\n\n\`\`\`js\nconst x = 1\n\`\`\`\n\nSee [it](http://x/y) and \`inline\`.\n`,
}

const joined = (tokens) => tokens.map((token) => token.text).join('')
const kinds = (tokens) => new Set(tokens.map((token) => token.kind))
const of = (tokens, kind) => tokens.filter((token) => token.kind === kind).map((t) => t.text)

describe('languageOf', () => {
  test('reads the extension and nothing else', () => {
    expect(languageOf('notes.md')).toBe('md')
    expect(languageOf('src/deep/main.JS')).toBe('js')
    expect(languageOf('Makefile')).toBe('')
    expect(languageOf('archive.tar.gz')).toBe('')
    expect(languageOf(null)).toBe('')
  })

  test('every language it can name has rules behind it', () => {
    expect(LANGUAGES.length).toBeGreaterThan(0)
    for (const language of LANGUAGES) {
      // Reached through a path, because that is the only way in. A language in
      // the list that no extension maps to would be a name with no caller.
      const path = Object.keys(SAMPLES).find((name) => languageOf(name) === language)
      expect(path).toBeString()
      expect(kinds(highlight(SAMPLES[path], path)).size).toBeGreaterThan(1)
    }
  })
})

describe('highlight', () => {
  // The one thing a viewer must never do. Asserted per language rather than on
  // one sample, because each language has its own regex and only its own regex
  // can lose a byte.
  test.each(Object.keys(SAMPLES))('%s comes back byte for byte', (path) => {
    expect(joined(highlight(SAMPLES[path], path))).toBe(SAMPLES[path])
  })

  test('an unknown language is one plain token, not an empty view', () => {
    const tokens = highlight('nothing here has an extension\n', 'Makefile')
    expect(tokens).toEqual([{ kind: 'plain', text: 'nothing here has an extension\n' }])
  })

  test('empty text is no tokens at all', () => {
    expect(highlight('', 'a.js')).toEqual([])
  })

  test('javascript: a comment wins over the string inside it', () => {
    const tokens = highlight(SAMPLES['main.js'], 'main.js')
    expect(of(tokens, 'comment')).toEqual(['// count the words', '// not a string'])
    expect(of(tokens, 'keyword')).toEqual(['const', 'export', 'function', 'return'])
    expect(of(tokens, 'number')).toEqual(['0x1f'])
  })

  test('json: true and null are keywords and the escaped quote does not end the string', () => {
    const tokens = highlight(SAMPLES['data.json'], 'data.json')
    expect(of(tokens, 'string')).toContain('"a \\" b"')
    expect(of(tokens, 'keyword')).toEqual(['true', 'null'])
    expect(of(tokens, 'number')).toEqual(['-12.5'])
  })

  test('python: a triple-quoted string is one token and its hash is not a comment', () => {
    const tokens = highlight(SAMPLES['tool.py'], 'tool.py')
    expect(of(tokens, 'string')).toEqual(['"""docstring # not a comment"""'])
    expect(of(tokens, 'comment')).toEqual(['# entry'])
    expect(of(tokens, 'keyword')).toEqual(['import', 'def', 'return'])
  })

  test('shell: a bare expansion is marked, one inside a quote stays part of the string', () => {
    const tokens = highlight(SAMPLES['run.sh'], 'run.sh')
    expect(of(tokens, 'comment')).toEqual(['#!/bin/sh'])
    // `$HOME` is bare and is its own token; `${f}` is inside quotes, so the
    // string rule reached it first and it is part of that one token. That order
    // is the grammar, not an oversight — it is what keeps the `#` beside it
    // from becoming a comment.
    expect(of(tokens, 'number')).toEqual(['$HOME'])
    expect(of(tokens, 'string')).toEqual([`"\${f} # still a string"`])
    expect(of(tokens, 'keyword')).toEqual(['set', 'for', 'in', 'do', 'done'])
  })

  test('c: the preprocessor line and the block comment are both marked', () => {
    const tokens = highlight(SAMPLES['main.c'], 'main.c')
    expect(of(tokens, 'keyword')).toEqual(['#include', 'int', 'void', 'return'])
    expect(of(tokens, 'comment')).toEqual(['/* block */'])
    expect(of(tokens, 'string')).toEqual(['"hi // not a comment\\n"'])
  })

  test('markdown: a fence is one token, headings and links are marked', () => {
    const tokens = highlight(SAMPLES['notes.md'], 'notes.md')
    expect(of(tokens, 'keyword')).toEqual(['# Plan', '[it](http://x/y)'])
    expect(of(tokens, 'comment')).toEqual(['> quoted'])
    expect(of(tokens, 'string')).toEqual(['```js\nconst x = 1\n```', '`inline`'])
    expect(of(tokens, 'number')).toEqual(['- ', '- '])
  })

  test('a rule that matched nothing leaves the text plain rather than looping', () => {
    // 4,000 lines with nothing any rule can match. The guard in the scanner is
    // the only thing standing between an empty match and a page that hangs, and
    // a test that never runs a big input never waits long enough to notice.
    const text = 'zzz\n'.repeat(4000)
    const tokens = highlight(text, 'a.js')
    expect(joined(tokens)).toBe(text)
    expect(kinds(tokens)).toEqual(new Set(['plain']))
  })
})
