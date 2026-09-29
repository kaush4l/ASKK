import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseFragment } from 'parse5'
import Dashboard, { SessionBoundaryNotice } from '../src/workbench/Dashboard.jsx'

const all = (node, predicate) => [...(predicate(node) ? [node] : []), ...(node.childNodes || []).flatMap(child => all(child, predicate))]
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('')
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value
const boundary = { previousAgent: 'assistant', agent: 'bundled/starter/assistant', label: 'General assistant' }
const state = { ready: true, model: { status: 'configured' }, workflows: [{ id: 'assistant', agent: boundary.agent, label: boundary.label, workspace: false }], selectedWorkflowId: 'assistant' }

test('the shared session boundary is informational and never maps old identity to new instructions', () => {
  const markup = renderToStaticMarkup(<SessionBoundaryNotice boundary={{ ...boundary, label: '<script>new role</script>' }}/>)
  const tree = parseFragment(markup)
  expect(all(tree, node => attr(node, 'role') === 'note')).toHaveLength(1)
  expect(text(tree)).toContain('Earlier conversation remains saved for review and is not automatically transferred.')
  expect(text(tree)).toContain('<script>new role</script>')
  expect(all(tree, node => ['button', 'a', 'script'].includes(node.tagName))).toHaveLength(0)
  expect(renderToStaticMarkup(<SessionBoundaryNotice boundary={null}/>)).toBe('')
})

test('dashboard shows the session boundary before its editable goal without blocking a task or requiring approval', () => {
  const goal = 'Keep this goal exactly as written.'
  const markup = renderToStaticMarkup(<Dashboard state={{ ...state, sessionBoundary: boundary }} goal={goal}/>)
  const tree = parseFragment(markup)
  const notice = all(tree, node => attr(node, 'class') === 'session-boundary-notice')[0]
  expect(text(notice)).toContain('Agent session: General assistant')
  expect(markup.indexOf('session-boundary-notice')).toBeLessThan(markup.indexOf('dashboard-composer'))
  const textarea = all(tree, node => node.tagName === 'textarea')[0]
  expect(text(textarea)).toBe(goal)
  expect(attr(textarea, 'disabled')).toBeUndefined()
  const start = all(tree, node => node.tagName === 'button' && text(node) === 'Start task')[0]
  expect(start).toBeDefined()
  expect(attr(start, 'disabled')).toBeUndefined()
  expect(all(tree, node => attr(node, 'aria-label') === 'Actions awaiting your approval')).toHaveLength(0)
  const settled = renderToStaticMarkup(<Dashboard state={{ ...state, sessionBoundary: null }} goal={goal}/>)
  expect(settled).not.toContain('session-boundary-notice')
  expect(settled).toContain(goal)
})
