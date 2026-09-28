'use client'
import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { EditorState, Compartment, Transaction } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { javascript } from '@codemirror/lang-javascript'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { editorSession, externalEditorChange } from './editor-layout.js'

const appearance = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--editor)', color: 'var(--text)' },
  '.cm-scroller': { fontFamily: 'var(--mono)', fontSize: '13px', lineHeight: '1.65', overflow: 'auto' },
  '.cm-content': { padding: '16px 0', caretColor: 'var(--accent)' },
  '.cm-gutters': { backgroundColor: 'var(--editor)', color: 'var(--muted)', border: 'none', paddingLeft: '12px' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--hover)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground': { backgroundColor: 'var(--selection) !important' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
})
function language(path) {
  if (/\.[cm]?[jt]sx?$/.test(path)) return javascript({ jsx: /x$/.test(path), typescript: /\.tsx?$/.test(path) })
  if (/\.html?$/.test(path)) return html()
  if (/\.css$/.test(path)) return css()
  if (/\.json$/.test(path)) return json()
  if (/\.mdx?$/.test(path)) return markdown()
  return []
}

export default function Editor({ path, value, theme, onChange, onSave, onFocus, onPosition, readOnly = false, cache, scope = 'default', groupId = 'primary' }) {
  const host = useRef(null)
  const view = useRef(null)
  const ownCache = useRef({})
  const shared = editorSession(cache || ownCache.current, groupId)
  shared.states ||= new Map()
  shared.themeSlot ||= new Compartment()
  shared.readSlot ||= new Compartment()
  shared.callbacks ||= { current: {} }
  const states = useRef(shared.states)
  const callbacks = shared.callbacks
  callbacks.current = { onChange, onSave, onFocus, onPosition }
  const currentPath = useRef(path)
  const themeSlot = useRef(shared.themeSlot)
  const readSlot = useRef(shared.readSlot)
  const initialValue = useRef(value)
  const key = name => `${scope}:${name}`
  function remember(name, editor) {
    states.current.set(key(name), { state: editor.state, top: editor.scrollDOM.scrollTop, left: editor.scrollDOM.scrollLeft })
  }
  function restoreScroll(editor, entry) {
    if (entry) requestAnimationFrame(() => { if (view.current === editor) { editor.scrollDOM.scrollTop = entry.top; editor.scrollDOM.scrollLeft = entry.left } })
  }
  function reportPosition(state) {
    const position = state.selection.main.head
    const line = state.doc.lineAt(position)
    callbacks.current.onPosition?.({ line: line.number, column: position - line.from + 1 })
  }
  useEffect(() => {
    function makeState(name, content) {
      return EditorState.create({ doc: content, extensions: [
        basicSetup, language(name), appearance,
        themeSlot.current.of(theme === 'dark' ? oneDark : []),
        readSlot.current.of(EditorState.readOnly.of(readOnly)),
        keymap.of([{ key: 'Mod-s', run: () => { callbacks.current.onSave?.(); return true } }]),
        EditorView.contentAttributes.of({ 'aria-label': `Editor: ${name}${groupId === 'secondary' ? ' · Group 2' : ''}`, spellcheck: 'false' }),
        EditorView.domEventHandlers({ focus: () => callbacks.current.onFocus?.() }),
        EditorView.updateListener.of(update => {
          if (update.docChanged && !update.transactions.some(t => t.annotation(Transaction.userEvent) === 'external')) callbacks.current.onChange?.(update.state.doc.toString())
          if (update.selectionSet || update.docChanged) reportPosition(update.state)
        }),
      ] })
    }
    const saved = states.current.get(key(path))
    view.current = new EditorView({ parent: host.current, state: saved?.state || makeState(path, initialValue.current || '') })
    view.current.makeState = makeState
    restoreScroll(view.current, saved)
    reportPosition(view.current.state)
    return () => { if (view.current) { remember(currentPath.current, view.current); view.current.destroy() }; view.current = null }
  }, [])
  useEffect(() => {
    const editor = view.current
    if (!editor) return
    if (path !== currentPath.current) {
      remember(currentPath.current, editor)
      const saved = states.current.get(key(path))
      editor.setState(saved?.state || editor.makeState(path, value))
      restoreScroll(editor, saved)
      currentPath.current = path
      reportPosition(editor.state)
    }
    const change = externalEditorChange(editor.state.doc.toString(), value)
    if (change) editor.dispatch({ changes: change, annotations: [Transaction.userEvent.of('external'), Transaction.addToHistory.of(false)] })
    editor.dispatch({ effects: [themeSlot.current.reconfigure(theme === 'dark' ? oneDark : []), readSlot.current.reconfigure(EditorState.readOnly.of(readOnly))] })
  }, [path, value, theme, readOnly])
  return <div className="code-editor" ref={host}/>
}
