import s from './ui.module.css'

/**
 * @typedef {object} Span one run of text inside a block.
 * @property {'text'|'code'|'strong'|'emphasis'} kind
 * @property {string} text
 */

/**
 * @typedef {{kind: 'paragraph'|'heading'|'quote', spans: ReadonlyArray<Span>}
 *         | {kind: 'bullets', items: ReadonlyArray<ReadonlyArray<Span>>}
 *         | {kind: 'code', text: string, langLabel: string}} Block
 */

/**
 * A MODEL'S REPLY, RENDERED FROM TYPED NODES — never from a string, and never
 * through `innerHTML`.
 *
 * This is the structural half of the ruling that markdown is parsed in the core
 * (STATUS.md, ruling 6): the interface is handed a tree and turns each node
 * into an element, so there is no point in the path where markup a model wrote
 * could become markup the page runs. Not a sanitizer — a sanitizer is a list of
 * what to remove, and this is a list of what can exist.
 *
 * `dangerouslySetInnerHTML` does not appear in this tree and the gate refuses
 * it by name, which is what makes the sentence above checkable rather than a
 * promise (I17).
 *
 * The keys are indices because a node has no identity of its own: its position
 * IS what it is, and re-parsing the same reply produces the same tree.
 *
 * @param {{blocks: ReadonlyArray<Block>}} props
 */
export function Markdown({ blocks }) {
  return (
    <div className={s.prose}>
      {blocks.map((block, i) => <Node key={i} block={block} />)}
    </div>
  )
}

/** @param {{block: Block}} props */
function Node({ block }) {
  if (block.kind === 'code') {
    return (
      <pre className={s.code} data-node="code">
        <span className={s.codeLang}>{block.langLabel}</span>
        <code>{block.text}</code>
      </pre>
    )
  }
  if (block.kind === 'bullets') {
    return (
      <ul className={s.bullets} data-node="bullets">
        {block.items.map((item, i) => <li key={i}><Runs spans={item} /></li>)}
      </ul>
    )
  }
  if (block.kind === 'heading') return <h3 data-node="heading"><Runs spans={block.spans} /></h3>
  if (block.kind === 'quote') {
    return <blockquote className={s.quote} data-node="quote"><Runs spans={block.spans} /></blockquote>
  }
  return <p data-node="paragraph"><Runs spans={block.spans} /></p>
}

/**
 * The runs inside one block. Every run stamps the node kind it came from, plain
 * text included: the claim this component makes is that a reply is a TREE and
 * not a string, and `data-span` is what makes that visible to a probe, to a
 * reader of the DOM, and to the test that renders a fixture and looks for it.
 *
 * @param {{spans: ReadonlyArray<Span>}} props
 */
function Runs({ spans }) {
  return spans.map((span, i) => {
    if (span.kind === 'code') return <code key={i} data-span="code">{span.text}</code>
    if (span.kind === 'strong') return <strong key={i} data-span="strong">{span.text}</strong>
    if (span.kind === 'emphasis') return <em key={i} data-span="emphasis">{span.text}</em>
    return <span key={i} data-span="text">{span.text}</span>
  })
}
