/**
 * The only way the UI makes elements. Text goes in through `textContent`, never `innerHTML`,
 * so a model's reply or a folder's file can never become markup.
 *
 *     h('button', { class: 'link', onclick: go, testid: 'reload-agents' }, 'Reload agents')
 */

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue
    if (key === 'class') el.className = value
    else if (key === 'testid') el.dataset.testid = value
    else if (key === 'text') el.textContent = value
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value)
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value)
    else if (key === 'dataset') Object.assign(el.dataset, value)
    else if (key in el && typeof value !== 'string') el[key] = value
    else el.setAttribute(key, value === true ? '' : String(value))
  }
  append(el, children)
  return el
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === '') continue
    el.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return el
}

/** Replace an element's children. */
export function fill(el, ...children) {
  el.replaceChildren()
  return append(el, children)
}

/** A status dot: the word is always printed beside it; the dot never carries meaning alone. */
export function dot(kind) {
  return kind ? h('span', { class: `dot dot-${kind}`, 'aria-hidden': 'true' }) : null
}

/** A mono block that scrolls sideways inside itself, folded at `lines` with "Show all n lines". */
export function mono(text, { lines = 12, open = null, onOpen = null, wrap = false, testid } = {}) {
  const all = String(text ?? '').split('\n')
  const box = h('pre', { class: `mono-block${wrap ? ' wrap' : ''}`, testid })
  const folded = all.length > lines && !open?.value
  box.textContent = folded ? all.slice(0, lines).join('\n') : all.join('\n')
  if (!folded) return box
  const more = h('button', { class: 'link small', type: 'button' }, `Show all ${all.length} lines`)
  more.addEventListener('click', () => {
    box.textContent = all.join('\n')
    more.remove()
    if (open) open.value = true
    onOpen?.()
  })
  return h('div', { class: 'fold' }, box, more)
}

/**
 * A two-press control: the first press relabels it, a second within 4s acts; otherwise it
 * reverts to its label and keeps focus.
 */
export function twoPress(label, armedLabel, act, attrs = {}) {
  const button = h('button', { type: 'button', ...attrs }, label)
  let timer = null
  button.addEventListener('click', () => {
    if (button.dataset.armed === '1') {
      clearTimeout(timer)
      button.dataset.armed = ''
      act()
      return
    }
    button.dataset.armed = '1'
    button.textContent = typeof armedLabel === 'function' ? armedLabel() : armedLabel
    button.classList.add('armed')
    timer = setTimeout(() => {
      button.dataset.armed = ''
      button.classList.remove('armed')
      button.textContent = label
    }, 4000)
  })
  return button
}

/** Save a JSON value as a file the browser downloads. */
export function download(name, content, type = 'application/json') {
  const blob = new Blob([typeof content === 'string' ? content : JSON.stringify(content, null, 2)], { type })
  const url = URL.createObjectURL(blob)
  const link = h('a', { href: url, download: name })
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** A collapsible section whose open state survives re-renders, keyed by name. */
const opened = new Map()
export function details(key, summary, build, { open = false, testid, class: cls } = {}) {
  const el = h('details', { class: cls ?? 'section', testid })
  el.open = opened.has(key) ? opened.get(key) : open
  const head = h('summary', {}, summary)
  el.append(head)
  let built = false
  const ensure = () => {
    if (built || !el.open) return
    built = true
    append(el, [build()])
  }
  el.addEventListener('toggle', () => {
    opened.set(key, el.open)
    ensure()
  })
  ensure()
  return el
}

export const isTouch = () => matchMedia('(hover: none) and (pointer: coarse)').matches

/** `el.append(...)` that skips null, false and '' instead of printing them. */
export const add = (el, ...children) => append(el, children)
