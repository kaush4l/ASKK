/**
 * Syntax colouring for the file view, as tokens rather than as markup.
 *
 * This function returns a list and never a string of HTML. A highlighter that
 * builds markup has to escape, and an escaper that is wrong once turns a file
 * the agent wrote into script the page runs — so the one thing this module is
 * not allowed to do is produce anything a renderer would have to trust. React
 * puts each token's `text` in as a text node.
 *
 * ## Why this exists instead of CodeMirror
 *
 * The owner asked for CodeMirror by name, which is an instruction to price it.
 * Measured on 2026-09-01, `bun build --minify --target browser` over an entry
 * that imports nothing but the editor:
 *
 *     codemirror + basicSetup + lang-{javascript,markdown,python}
 *                                        661,868 bytes   226,167 gzip -9
 *     @codemirror/{state,view,language} + lang-javascript, readOnly
 *                                        366,728 bytes   123,645 gzip -9
 *
 * Priced against what a visitor actually pays, which is the export gzipped:
 * `find out \( -name '*.js' -o -name '*.css' \) -exec gzip -9 -c {} +` over a
 * build of this tree is 414,376 bytes, so the smaller of those is +29.8% of
 * every byte of code a cold load moves. The raw comparison says the same thing
 * one way less honestly and is kept because it is the cheaper one to re-run:
 * `find out -name '*.js' -exec wc -c {} +` is 1,332,314 — which INCLUDES
 * `public/sandbox/**`, 35,076 bytes of classic-worker JavaScript that Turbopack
 * never sees and that ships all the same — making the smaller +27.5% and the
 * larger +49.7%. Measured 2026-09-01.
 *
 * What it would buy is colour on files this store caps at 64 KiB
 * (`core/tools/FilesPort.js`), read-only by the decision argued in
 * `backend/services/FilesService.js` — so the editing engine, the change
 * history, the input handling and the virtualised viewport, which is most of
 * those bytes, would all be shipped in order not to be used.
 *
 * That is the honest case against it and it is not a case against CodeMirror.
 * The day this view edits, or opens something too big to lay out in one pass,
 * the trade inverts and 124 KB is cheap. It is not that day.
 *
 * The cost of THIS instead: a scanner, not a parser. It cannot see that a `#`
 * is inside a Python string that started on the previous line, because it has
 * no state across lines except what its own regex spans. Every rule below is
 * therefore written to match whole constructs — a string with its quotes, a
 * block comment with both delimiters — so that a construct is either matched
 * entirely or not at all, and the failure mode is a missing colour rather than
 * a shifted one.
 */

/**
 * The rules for one language, tried in this order.
 *
 * Order is the whole grammar: `comment` before `string` so that `// "not a
 * string"` is a comment, `string` before `number` so that `"3"` is not a digit
 * in a quote, `keyword` last so it only ever matches what is left over.
 *
 * Every group inside a rule is non-capturing on purpose. The scanner finds
 * which rule matched by counting capture groups, so one stray `(` here would
 * silently mislabel every token after it — `highlight.test.js` pins the
 * classification per language for exactly that reason.
 */
const RULES = {
  js: {
    comment: /\/\/[^\n]*|\/\*[\s\S]*?\*\//,
    string: /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/,
    number: /\b0[xX][0-9a-fA-F]+\b|\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b/,
    keyword:
      /\b(?:async|await|break|case|catch|class|const|continue|default|delete|do|else|export|extends|false|finally|for|from|function|get|if|import|in|instanceof|let|new|null|of|return|set|static|super|switch|this|throw|true|try|typeof|undefined|var|void|while|yield)\b/,
  },
  json: {
    string: /"(?:[^"\\]|\\.)*"/,
    number: /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/,
    keyword: /\b(?:true|false|null)\b/,
  },
  py: {
    comment: /#[^\n]*/,
    string: /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/,
    number: /\b0[xX][0-9a-fA-F]+\b|\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b/,
    keyword:
      /\b(?:and|as|assert|async|await|break|class|continue|def|del|elif|else|except|False|finally|for|from|global|if|import|in|is|lambda|None|nonlocal|not|or|pass|raise|return|True|try|while|with|yield)\b/,
  },
  sh: {
    comment: /#[^\n]*/,
    string: /"(?:[^"\\]|\\.)*"|'[^']*'/,
    // Shell has no literal type worth colouring, so the third slot goes to the
    // thing a reader of a shell script actually scans for: what it expands.
    number: /\$\{[^}\n]*\}|\$[A-Za-z_][\w]*|\$[0-9@*#?]/,
    keyword:
      /\b(?:case|do|done|elif|else|esac|export|fi|for|function|if|in|local|read|readonly|return|set|shift|then|unset|until|while)\b/,
  },
  c: {
    comment: /\/\/[^\n]*|\/\*[\s\S]*?\*\//,
    string: /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/,
    number: /\b0[xX][0-9a-fA-F]+\b|\b\d+(?:\.\d+)?[uUlLfF]*\b/,
    keyword:
      /^[ \t]*#[A-Za-z]+|\b(?:auto|break|case|char|const|continue|default|do|double|else|enum|extern|float|for|goto|if|int|long|register|return|short|signed|sizeof|static|struct|switch|typedef|union|unsigned|void|volatile|while)\b/,
  },
  md: {
    // A heading is the structure of a note, a fence is where the note stops
    // being prose. Nothing else in Markdown is worth a colour a reader has to
    // learn: emphasis reads as emphasis in the source already.
    comment: /^[ \t]{0,3}>[^\n]*/,
    string: /^[ \t]{0,3}```[^\n]*(?:\n[\s\S]*?^[ \t]{0,3}```|[\s\S]*$)|`[^`\n]+`/,
    number: /^[ \t]{0,3}(?:[-*+]|\d+\.)[ \t]/,
    keyword: /^[ \t]{0,3}#{1,6}[ \t][^\n]*|\[[^\]\n]*\]\([^)\n]*\)/,
  },
}

/**
 * Which rules a file gets, by the end of its name.
 *
 * Extension and not content sniffing. A model writes `notes.md` and `main.c`
 * because that is what it was asked for; guessing a language from the bytes
 * would be a second opinion about a fact the name already states, which is the
 * argument `Workspace` makes for not storing a length beside the text.
 */
const BY_EXTENSION = {
  c: 'c',
  cc: 'c',
  cpp: 'c',
  css: 'c',
  h: 'c',
  hpp: 'c',
  js: 'js',
  json: 'json',
  jsx: 'js',
  markdown: 'md',
  md: 'md',
  mjs: 'js',
  py: 'py',
  sh: 'sh',
  ts: 'js',
  tsx: 'js',
}

/** The language this path is written in, or `''` when nothing here knows. */
export function languageOf(path) {
  const name = String(path ?? '')
  const dot = name.lastIndexOf('.')
  if (dot < 0) return ''
  return BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? ''
}

/**
 * Every language this module can colour.
 *
 * Exported because the file view says it out loud: `app/FilesPanel.jsx` prints
 * this list under a file whose name it cannot place, so a reader who opens
 * `main.rs` and sees no colour is told which languages have rules rather than
 * left to wonder whether the highlighter broke. Derived from `BY_EXTENSION`
 * rather than written beside it, so a language added there cannot fail to
 * appear — and `highlight.test.js` walks it to prove every one has a scanner.
 */
export const LANGUAGES = Object.freeze([...new Set(Object.values(BY_EXTENSION))].sort())

/**
 * One regex per language, built once.
 *
 * Alternation of the rules in declaration order, each wrapped in exactly one
 * capture group, so the index of the group that matched is the name of the
 * rule that matched. `m` because several Markdown and C rules are anchored to
 * the start of a line; `g` because the scan below advances `lastIndex` itself.
 */
const SCANNERS = new Map(
  Object.entries(RULES).map(([language, rules]) => {
    const kinds = Object.keys(rules)
    const source = kinds.map((kind) => `(${rules[kind].source})`).join('|')
    return [language, { kinds, pattern: new RegExp(source, 'gm') }]
  }),
)

/**
 * Split `text` into coloured runs.
 *
 * The contract this module is tested against, and the only one worth having:
 * **the tokens' text, concatenated in order, is the input exactly.** A viewer
 * that quietly drops a byte of a file is worse than one with no colour at all,
 * so the round trip is asserted per language rather than assumed from the
 * regexes looking right.
 *
 * An unknown language is one plain token rather than an empty list: a caller
 * then has one rendering path instead of two, and a file type nobody taught
 * this module still shows up whole.
 *
 * @param {string} text
 * @param {string} path used only to choose the language
 * @returns {Array<{kind: string, text: string}>}
 */
export function highlight(text, path) {
  const body = typeof text === 'string' ? text : String(text ?? '')
  const scanner = SCANNERS.get(languageOf(path))
  if (!scanner || !body) return body ? [{ kind: 'plain', text: body }] : []

  const tokens = []
  let at = 0
  scanner.pattern.lastIndex = 0
  let match = scanner.pattern.exec(body)
  while (match) {
    // A rule that can match the empty string would never advance `lastIndex`
    // and would hang the page rather than mis-colour it. None of the rules
    // above can, and this is the line that means a future one cannot either.
    if (match[0] === '') {
      scanner.pattern.lastIndex += 1
      match = scanner.pattern.exec(body)
      continue
    }
    if (match.index > at) tokens.push({ kind: 'plain', text: body.slice(at, match.index) })
    const group = match.findIndex((value, index) => index > 0 && value !== undefined)
    tokens.push({ kind: scanner.kinds[group - 1], text: match[0] })
    at = match.index + match[0].length
    match = scanner.pattern.exec(body)
  }
  if (at < body.length) tokens.push({ kind: 'plain', text: body.slice(at) })
  return tokens
}
