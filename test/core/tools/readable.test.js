import { describe, expect, test } from 'bun:test'
import { toReadableText } from '../../../src/core/tools/readable.js'

/**
 * The reducer exists because `DOMParser` is not in a worker, so every rule a
 * browser would have applied has to be applied by hand — and each of these
 * tests is one rule that a browser gets right and a naive `replace(/<[^>]+>/g)`
 * gets wrong in a way nothing downstream can detect.
 *
 * The failure mode this is really guarding is not an exception. It is a page
 * that reduces to something plausible with the wrong content in it: a script's
 * source read as prose, a code sample flattened onto one line, `&lt;` shown as
 * a tag. All three look like a working reduction in a diff.
 */

describe('toReadableText', () => {
  test('the contents of script and style never reach the reader', () => {
    const text = toReadableText(`<html><head>
      <style>.a { color: red } /* stylesheet-marker */</style>
      <script>const key = "script-marker"; if (a < b) { run() }</script>
      </head><body><p>The visible sentence.</p></body></html>`)

    expect(text).toContain('The visible sentence.')
    expect(text).not.toContain('script-marker')
    expect(text).not.toContain('stylesheet-marker')
    // The `<` inside the script must not have been read as the start of a tag
    // either — that is how a stripper eats the rest of the document.
    expect(text).not.toContain('run()')
  })

  test('a code sample keeps its newlines and its indentation', () => {
    const text = toReadableText(
      '<p>Example:</p><pre><code>fn main() {\n    print("hi")\n}</code></pre><p>Done.</p>',
    )

    // The whole reason this function is not four lines. A flattened code sample
    // is worse than no code sample: it still looks like code.
    expect(text).toContain('fn main() {\n    print("hi")\n}')
    expect(text).toContain('Example:')
    expect(text).toContain('Done.')
  })

  test('block elements end a line and inline elements do not add a space', () => {
    const text = toReadableText('<p>one</p><p>two</p><p><b>hyper</b>text is <i>one</i> word</p>')

    expect(text.split('\n').filter(Boolean)).toEqual(['one', 'two', 'hypertext is one word'])
  })

  test('list items become lines that read as a list', () => {
    const text = toReadableText('<ul><li>alpha</li><li>beta</li></ul>')

    expect(text).toBe('- alpha\n- beta')
  })

  test('entities are decoded, and an entity with no meaning is left alone', () => {
    const text = toReadableText('<p>a &amp; b &lt;tag&gt; &#8212; &#x2014; &nbsp;end &sigma;</p>')

    expect(text).toBe('a & b <tag> — — end &sigma;')
  })

  test('a decoded entity is not re-read as markup', () => {
    // `&lt;script&gt;` is text ABOUT a tag. Decoding before stripping would
    // turn it into a tag and delete the sentence it was part of.
    const text = toReadableText('<p>Write &lt;script&gt; to add one.</p>')

    expect(text).toBe('Write <script> to add one.')
  })

  test('the title leads, and is not repeated when the body already opens with it', () => {
    expect(toReadableText('<title>Docs</title><body><p>Body.</p></body>')).toBe('Docs\n\nBody.')
    expect(toReadableText('<title>Docs</title><body><h1>Docs</h1><p>Body.</p></body>')).toBe(
      'Docs\n\nBody.',
    )
  })

  test('a page reduces to a fraction of itself, and keeps the sentence that mattered', () => {
    // The shape of a real page: a little prose carried by a lot of machinery.
    const noise = '<div class="wrapper"><span data-x="1"></span></div>'.repeat(400)
    const page = `<!doctype html><html><head><title>Release notes</title>
      <style>${'.x{margin:0}'.repeat(400)}</style>
      <script>${'window.__DATA__=[1,2,3];'.repeat(400)}</script></head>
      <body>${noise}<p>Version 0.15.2 was released on 5 August.</p>${noise}</body></html>`

    const text = toReadableText(page)

    expect(text).toContain('Version 0.15.2 was released on 5 August.')
    // Measured, not asserted as a constant: the point is the ratio, and a
    // change that stops dropping markup will fail here long before it shows up
    // as a context window quietly spent on nothing.
    expect(text.length).toBeLessThan(page.length / 50)
  })

  test('nothing that is not a string comes back as anything but empty', () => {
    expect(toReadableText(undefined)).toBe('')
    expect(toReadableText(null)).toBe('')
    expect(toReadableText(42)).toBe('')
  })

  test('a code point outside Unicode is left as it was written, not thrown', () => {
    // `String.fromCodePoint(99999999)` is a RangeError, and a RangeError out of
    // here is a `Tool.call` that threw — the one thing a tool may never do —
    // on any page that contains a malformed numeric entity.
    const text = toReadableText('<p>&#99999999; and &#x110000; and &#8212;</p>')

    expect(text).toContain('&#99999999;')
    expect(text).toContain('&#x110000;')
    expect(text).toContain('—')
  })

  test('a line break is a line break, and a comment is not content', () => {
    const text = toReadableText(
      '<p>one<br>two<hr>three</p><!-- the note the author left for themselves -->',
    )

    // Without this, an address block or a poem arrives as one run-on line and
    // the model reads two facts as one.
    expect(text).toBe('one\ntwo\nthree')
  })
})
