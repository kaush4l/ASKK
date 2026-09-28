'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { createWorkbenchController } from '../workspace/controller.js'
import Icon, { IconButton } from './Icons.jsx'
import FileTree, { FileIcon } from './FileTree.jsx'
import Markdown from './Markdown.jsx'
import Modal from './Modal.jsx'
import ArtifactPreview from './ArtifactPreview.jsx'
import ToolCard from './ToolCard.jsx'
import BindingReview from './BindingReview.jsx'
import PhoneWorkspaceTabs from './PhoneWorkspaceTabs.jsx'
import DiffView from './DiffView.jsx'
import { createEditorGroup, openEditorTab, closeEditorTab, pinEditorTab, createEditorNavigation, editorGroupGeometry, isDiffTab, isPreviewTab, editorFilePath, forgetEditorFile } from './editor-layout.js'
import { acknowledgeSavedDraft, draftForConflict, saveAllDrafts } from './save-all.js'
import { reconcileMissingDocuments, readEditorDocument } from './external-files.js'

const Editor = dynamic(() => import('./Editor.jsx'), { ssr: false, loading: () => <div className="surface-loading">Opening editor…</div> })
const Terminal = dynamic(() => import('./Terminal.jsx'), { ssr: false, loading: () => <div className="surface-loading">Opening terminal…</div> })
const EMPTY = { ready: false, files: [], messages: [], commands: [], artifacts: [], agents: [], plans: [], approvals: [], activity: [], runtime: { target: 'browser', status: 'idle' }, companion: { status: 'disconnected' }, model: {} }
let singleton
let started
const activeStatus = status => ['running', 'thinking', 'calling', 'waiting', 'compacting', 'starting'].includes(status)
const textOf = value => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value, null, 2)
const lastName = path => path.split('/').pop()
const safeGet = key => { try { return localStorage.getItem(key) } catch { return null } }
const safeSet = (key, value) => { try { localStorage.setItem(key, value) } catch {} }

function useController() {
  const [controller, setController] = useState(null)
  const [snapshot, setSnapshot] = useState(EMPTY)
  useEffect(() => {
    singleton ||= createWorkbenchController({ basePath: process.env.NEXT_PUBLIC_BASE_PATH || '' })
    const current = singleton
    setController(current)
    const update = () => setSnapshot(current.getSnapshot())
    const off = current.subscribe(update)
    update()
    started ||= current.start()
    Promise.resolve(started).then(update).catch(error => setSnapshot(previous => ({ ...previous, error: error.message, ready: false })))
    return off
  }, [])
  return [controller, snapshot || EMPTY]
}

function StatusDot({ status }) { return <span className={`status-dot ${['ready', 'connected', 'done', 'completed'].includes(status) ? 'ready' : activeStatus(status) ? 'busy' : ['failed', 'error', 'disconnected'].includes(status) ? 'error' : ''}`}/> }
function ExecutionNotice({ notice }) { return notice ? <aside className="execution-notice" role="note" aria-label={notice.title}><strong>{notice.title}</strong><p>{notice.body}</p></aside> : null }

function ResizeHandle({ onResize, label, vertical = false, className = '', value, min, max }) {
  return <div role="separator" tabIndex={0} aria-label={label} aria-orientation={vertical ? 'horizontal' : 'vertical'} aria-valuenow={value} aria-valuemin={min} aria-valuemax={max} className={`resize-handle ${vertical ? 'horizontal' : ''} ${className}`}
    onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); onResize(['ArrowLeft', 'ArrowUp'].includes(event.key) ? -16 : 16) } }}
    onPointerDown={event => {
      event.preventDefault()
      const node = event.currentTarget
      node.setPointerCapture(event.pointerId)
      let previous = vertical ? event.clientY : event.clientX
      const move = moveEvent => { const next = vertical ? moveEvent.clientY : moveEvent.clientX; onResize(next - previous); previous = next }
      const stop = () => { node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', stop); node.removeEventListener('pointercancel', stop) }
      node.addEventListener('pointermove', move); node.addEventListener('pointerup', stop); node.addEventListener('pointercancel', stop)
    }}/>
}

export default function Workbench() {
  const [controller, raw] = useController()
  const state = { ...EMPTY, ...raw, runtime: { ...EMPTY.runtime, ...raw.runtime }, companion: { ...EMPTY.companion, ...raw.companion }, model: { ...raw.model } }
  const fileSnapshot = useRef(state)
  fileSnapshot.current = state
  const [surface, setSurface] = useState('conversation')
  const [phoneSurface, setPhoneSurface] = useState('code')
  const phoneSurfaceRef = useRef(phoneSurface)
  phoneSurfaceRef.current = phoneSurface
  const lastCodeSelection = useRef({ primary: 'welcome', secondary: 'welcome' })
  const [activity, setActivity] = useState('files')
  const [explorerOpen, setExplorerOpen] = useState(true)
  const [explorerWidth, setExplorerWidth] = useState(null)
  const [sidebarOverlay, setSidebarOverlay] = useState(false)
  const sidebarNode = useRef(null)
  const sidebarTrigger = useRef(null)
  const drawerOpen = sidebarOverlay && explorerOpen
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelTab, setPanelTab] = useState('commands')
  const [selectedCommand, setSelectedCommand] = useState(null)
  const [terminalId, setTerminalId] = useState(null)
  const [tabs, setTabs] = useState([])
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const [temporaryTab, setTemporaryTab] = useState(null)
  const temporaryTabRef = useRef(temporaryTab)
  temporaryTabRef.current = temporaryTab
  const fileNavigation = useRef(createEditorNavigation())
  const [selected, setSelected] = useState('welcome')
  const [secondaryGroup, setSecondaryGroup] = useState(() => createEditorGroup())
  const secondaryGroupRef = useRef(secondaryGroup)
  secondaryGroupRef.current = secondaryGroup
  const [activeEditorGroup, setActiveEditorGroup] = useState('primary')
  const activeEditorGroupRef = useRef(activeEditorGroup)
  activeEditorGroupRef.current = activeEditorGroup
  const [splitEditors, setSplitEditors] = useState(false)
  const [editorWidth, setEditorWidth] = useState(0)
  const [groupRatio, setGroupRatio] = useState(.5)
  const editorGroupsNode = useRef(null)
  const positions = useRef({})
  const [documents, setDocuments] = useState({})
  const docsRef = useRef(documents)
  const editorCache = useRef({})
  const savesInFlight = useRef(new Set())
  const buildInFlight = useRef(false)
  docsRef.current = documents
  const [goal, setGoal] = useState('')
  const goalRef = useRef(goal)
  goalRef.current = goal
  const [command, setCommand] = useState('')
  const [follow, setFollow] = useState(true)
  const [theme, setTheme] = useState('system')
  const [resolvedTheme, setResolvedTheme] = useState('dark')
  const [modal, setModal] = useState(null)
  const [modalValue, setModalValue] = useState('')
  const [modalError, setModalError] = useState('')
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState('')
  const [draftStorageError, setDraftStorageError] = useState('')
  const [query, setQuery] = useState('')
  const [palette, setPalette] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [position, setPosition] = useState({ line: 1, column: 1 })
  const [chatWidth, setChatWidth] = useState(null)
  const [panelHeight, setPanelHeight] = useState(230)
  const [previewSize, setPreviewSize] = useState('fit')
  const [paletteIndex, setPaletteIndex] = useState(0)
  const transcript = useRef(null)
  const composer = useRef(null)
  const atBottom = useRef(true)
  const previousFiles = useRef(new Map())
  const filesObserved = useRef(false)
  const previousArtifact = useRef(null)
  const [hydratedDrafts, setHydratedDrafts] = useState(false)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const activeSelection = activeEditorGroup === 'secondary' ? secondaryGroup.selected : selected
  const activeSelectionRef = useRef(activeSelection)
  activeSelectionRef.current = activeSelection
  const primaryGroup = { tabs, temporaryTab, selected }
  const groupGeometry = editorGroupGeometry(editorWidth, groupRatio)
  const groupsWide = splitEditors && groupGeometry.split
  useEffect(() => {
    if (!isPreviewTab(selected)) lastCodeSelection.current.primary = selected
    if (!isPreviewTab(secondaryGroup.selected)) lastCodeSelection.current.secondary = secondaryGroup.selected
  }, [selected, secondaryGroup.selected])
  useEffect(() => {
    const node = editorGroupsNode.current
    if (!node) return
    const resize = () => setEditorWidth(node.getBoundingClientRect().width)
    const observer = new ResizeObserver(resize)
    observer.observe(node); resize()
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    // Reveal just the horizontal tab strip; scrolling the whole element into view
    // can move the conversation or steal the mobile surface's scroll position.
    for (const strip of editorGroupsNode.current?.querySelectorAll('.editor-tabs') || []) {
      if (!strip.clientWidth) continue
      const selectedTab = strip.querySelector('[role="tab"][aria-selected="true"]')
      const tab = selectedTab?.closest('.file-tab') || selectedTab
      if (!tab) continue
      const bounds = strip.getBoundingClientRect(); const item = tab.getBoundingClientRect()
      if (item.right > bounds.right) strip.scrollLeft += item.right - bounds.right
      if (item.left < bounds.left) strip.scrollLeft -= bounds.left - item.left
    }
  }, [selected, secondaryGroup.selected, activeEditorGroup, editorWidth, groupRatio, splitEditors, surface, phoneSurface])
  const dirtyPaths = useMemo(() => new Set(Object.entries(documents).filter(([, doc]) => doc.content !== doc.baseContent).map(([path]) => path)), [documents])
  const selectedDoc = documents[editorFilePath(activeSelection)]
  const running = activeStatus(state.run?.status)
  const currentCommand = state.commands.find(item => item.id === selectedCommand) || state.commands.at(-1)
  const runtimeConsole = useMemo(() => state.activity
    .filter(event => event.target === state.runtime.target && event.type === 'runtime.console')
    .map(event => String(event.data ?? '')).join('').slice(-100000)
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ''), [state.activity, state.runtime.target])
  const failedCommands = state.commands.filter(item => ['failed', 'error'].includes(item.status) || Number.isInteger(item.exitCode) && item.exitCode !== 0 && !['cancelled', 'interrupted'].includes(item.status))
  const problemCount = failedCommands.length + (state.error ? 1 : 0)
  const currentPlan = state.plans.at(-1)

  function readGroup(id) { return id === 'secondary' ? secondaryGroupRef.current : { tabs: tabsRef.current, temporaryTab: temporaryTabRef.current, selected: selectedRef.current } }
  function writeGroup(id, next) {
    if (id === 'secondary') { secondaryGroupRef.current = next; setSecondaryGroup(next) }
    else { tabsRef.current = next.tabs; temporaryTabRef.current = next.temporaryTab; selectedRef.current = next.selected; setTabs(next.tabs); setTemporaryTab(next.temporaryTab); setSelected(next.selected) }
    if (activeEditorGroupRef.current === id) activeSelectionRef.current = next.selected
  }
  function activateGroup(id, reveal = false) {
    activeEditorGroupRef.current = id; setActiveEditorGroup(id)
    const selection = readGroup(id).selected
    activeSelectionRef.current = selection
    if (positions.current[id]) setPosition(positions.current[id])
    if (reveal) setPhoneSurface(isPreviewTab(selection) ? 'preview' : 'code')
  }
  function selectPhoneSurface(next) {
    fileNavigation.current.invalidate(activeEditorGroupRef.current)
    setPhoneSurface(next)
    if (next === 'files') { setActivity('files'); setExplorerOpen(true) }
    else if (next === 'commands') { setPanelOpen(true); setExplorerOpen(false) }
    else {
      setExplorerOpen(false)
      const groupId = activeEditorGroupRef.current; const group = readGroup(groupId); const previous = lastCodeSelection.current[groupId]
      const code = group.tabs.includes(previous) ? previous : group.tabs.at(-1) || 'welcome'
      writeGroup(groupId, openEditorTab(group, next === 'preview' ? 'preview' : code))
      setFollow(false)
    }
  }
  function selectEditor(next, groupId = activeEditorGroupRef.current) {
    fileNavigation.current.invalidate(groupId)
    if (!isPreviewTab(next)) lastCodeSelection.current[groupId] = next
    writeGroup(groupId, openEditorTab(readGroup(groupId), next, { pin: isDiffTab(next) }))
    activateGroup(groupId); setPhoneSurface(isPreviewTab(next) ? 'preview' : 'code'); setFollow(false)
    if (innerWidth < 1280) setExplorerOpen(false)
  }
  async function splitGroup(preview = false) {
    if (!editorGroupGeometry(editorGroupsNode.current?.getBoundingClientRect().width || 0).split && explorerOpen) {
      setExplorerOpen(false)
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    }
    const width = editorGroupsNode.current?.getBoundingClientRect().width || 0
    if (!editorGroupGeometry(width).split) { setToast('Two editor groups need at least 760 px of workspace width. Widen the workspace to split it.'); return }
    const current = activeSelectionRef.current
    const next = preview ? 'preview' : isPreviewTab(current) || current === 'welcome' ? tabsRef.current.find(path => !isDiffTab(path)) || 'welcome' : current
    const destination = activeEditorGroupRef.current === 'primary' ? 'secondary' : 'primary'
    fileNavigation.current.invalidate(destination)
    writeGroup(destination, openEditorTab(readGroup(destination), next, { pin: true }))
    setEditorWidth(width); setSplitEditors(true)
  }
  function closeSecondGroup() { fileNavigation.current.invalidate('secondary'); activateGroup('primary', true); setSplitEditors(false) }
  async function openDiff(path) {
    const groupId = activeEditorGroupRef.current
    const accepted = await openFile(path, false, { pin: true, groupId })
    if (accepted && activeEditorGroupRef.current === groupId && docsRef.current[path]) selectEditor(`diff:${path}`, groupId)
  }
  function showConversation(focus = false) {
    fileNavigation.current.invalidate('primary'); fileNavigation.current.invalidate('secondary'); setSurface('conversation')
    if (focus) requestAnimationFrame(() => composer.current?.focus())
  }
  function rememberSidebarTrigger(trigger) {
    if (innerWidth > 600 && innerWidth < 1280) sidebarTrigger.current = trigger || document.activeElement
  }
  function closeExplorer() {
    const restore = drawerOpen && document.activeElement?.closest('.workspace-main')
    const trigger = sidebarTrigger.current?.isConnected ? sidebarTrigger.current : document.querySelector('.activity-bar [aria-expanded="true"]')
    setExplorerOpen(false)
    if (innerWidth <= 600 && phoneSurfaceRef.current === 'files') selectPhoneSurface('code')
    // Closing from the conversation must not take focus away from its composer.
    if (restore && trigger?.isConnected) requestAnimationFrame(() => {
      if (document.activeElement === document.body || document.activeElement?.closest('.workspace-main')) trigger.focus({ preventScroll: true })
    })
  }
  function toggleExplorer(next = activity, trigger) {
    const opening = activity !== next || !explorerOpen || innerWidth <= 600 && phoneSurfaceRef.current !== 'files'
    if (opening) rememberSidebarTrigger(trigger)
    else if (drawerOpen) { closeExplorer(); return }
    setActivity(next); setExplorerOpen(opening)
    if (innerWidth <= 600) { setSurface('workspace'); if (opening) setPhoneSurface('files'); else selectPhoneSurface('code') }
  }
  function closePanel() { setPanelOpen(false); if (innerWidth <= 600 && phoneSurfaceRef.current === 'commands') selectPhoneSurface('code') }
  function togglePanel() {
    if (innerWidth <= 600) { if (phoneSurfaceRef.current === 'commands') closePanel(); else { setPanelOpen(true); setPhoneSurface('commands'); setSurface('workspace'); setExplorerOpen(false) } }
    else setPanelOpen(value => !value)
  }
  function showAgents(event) { rememberSidebarTrigger(event?.currentTarget); setActivity('agents'); setExplorerOpen(true); setSurface('workspace'); setPhoneSurface('files') }
  function showCommand(id) { setPanelOpen(true); setPanelTab('commands'); setSelectedCommand(id); setSurface('workspace'); setPhoneSurface('commands') }
  function showProblems() { setPanelOpen(true); setPanelTab('problems'); setSurface('workspace'); setPhoneSurface('commands') }

  const preserveDrafts = useCallback(() => {
    try {
      localStorage.setItem('askk:goal-draft', composer.current?.value ?? goalRef.current)
      localStorage.setItem('askk:editor-drafts', JSON.stringify(Object.fromEntries(Object.entries(docsRef.current).filter(([, doc]) => doc.content !== doc.baseContent))))
      setDraftStorageError('')
      return true
    } catch (error) {
      setDraftStorageError(`Draft recovery could not be saved: ${error.message}. Keep this tab open and save or copy your work before reloading.`)
      return false
    }
  }, [])

  useEffect(() => {
    const preserve = event => {
      if (!preserveDrafts()) event.preventDefault?.()
    }
    window.addEventListener('askk:before-isolation', preserve)
    window.addEventListener('pagehide', preserve)
    return () => { window.removeEventListener('askk:before-isolation', preserve); window.removeEventListener('pagehide', preserve) }
  }, [preserveDrafts])

  function changeDocument(path, content) {
    pinTab(path)
    const next = { ...docsRef.current, [path]: { ...docsRef.current[path], content } }
    docsRef.current = next
    setDocuments(next)
  }

  useEffect(() => {
    setTheme(safeGet('askk:theme') || 'system')
    setGoal(safeGet('askk:goal-draft') || '')
    const media = matchMedia('(prefers-color-scheme: dark)')
    let narrow = innerWidth < 1280
    let phone = innerWidth <= 600
    const resize = () => {
      const next = innerWidth < 1280
      setSidebarOverlay(next && innerWidth > 600)
      if (next && !narrow) setExplorerOpen(false)
      if (innerWidth <= 600 && !phone) setPhoneSurface(isPreviewTab(activeSelectionRef.current) ? 'preview' : 'code')
      narrow = next; phone = innerWidth <= 600
    }
    if (narrow) setExplorerOpen(false)
    window.addEventListener('resize', resize)
    resize()
    try {
      const layout = JSON.parse(safeGet('askk:layout') || '{}')
      const restoredTabs = createEditorGroup(layout).tabs
      setTabs(restoredTabs)
      if (restoredTabs.includes(layout.temporaryTab)) setTemporaryTab(layout.temporaryTab)
      if (typeof layout.selected === 'string') setSelected(createEditorGroup(layout).selected)
      const second = createEditorGroup(layout.secondaryGroup)
      secondaryGroupRef.current = second; setSecondaryGroup(second)
      const restoredActive = layout.splitEditors && layout.activeEditorGroup === 'secondary' ? 'secondary' : 'primary'
      activeEditorGroupRef.current = restoredActive; setActiveEditorGroup(restoredActive); setSplitEditors(!!layout.splitEditors)
      if (Number.isFinite(layout.groupRatio)) setGroupRatio(Math.max(.1, Math.min(.9, layout.groupRatio)))
      setPhoneSurface(isPreviewTab(restoredActive === 'secondary' ? second.selected : layout.selected) ? 'preview' : 'code')
      if (Number.isFinite(layout.explorerWidth)) setExplorerWidth(Math.max(160, Math.min(360, layout.explorerWidth)))
      if (innerWidth >= 1280 && typeof layout.explorerOpen === 'boolean') setExplorerOpen(layout.explorerOpen)
      const draft = JSON.parse(safeGet('askk:editor-drafts') || '{}')
      if (Object.keys(draft).length) {
        docsRef.current = draft; setDocuments(draft)
        if (draft[second.temporaryTab]) { const pinned = pinEditorTab(second, second.temporaryTab); secondaryGroupRef.current = pinned; setSecondaryGroup(pinned) }
        const represented = new Set([...restoredTabs, ...second.tabs].map(editorFilePath))
        setTabs([...new Set([...restoredTabs, ...Object.keys(draft).filter(path => !represented.has(path))])])
        if (!layout.selected) setSelected(Object.keys(draft)[0])
        if (draft[layout.temporaryTab]) setTemporaryTab(null)
      }
    } catch {}
    setHydratedDrafts(true)
    const changed = () => setResolvedTheme((safeGet('askk:theme') || 'system') === 'system' ? media.matches ? 'dark' : 'light' : safeGet('askk:theme'))
    media.addEventListener('change', changed)
    changed()
    return () => { media.removeEventListener('change', changed); window.removeEventListener('resize', resize) }
  }, [])
  useEffect(() => {
    if (!drawerOpen || sidebarNode.current?.contains(document.activeElement)) return
    // This is a nonmodal workspace drawer; the conversation remains available.
    // Search keeps its native autoFocus, other views start at the close control.
    sidebarNode.current?.querySelector('input, [data-sidebar-close]')?.focus({ preventScroll: true })
  }, [drawerOpen, activity])
  useEffect(() => {
    if (!hydratedDrafts) return
    safeSet('askk:theme', theme)
    const resolved = theme === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' : theme
    setResolvedTheme(resolved)
    document.documentElement.dataset.theme = resolved
  }, [theme, resolvedTheme, hydratedDrafts])
  useEffect(() => { if (hydratedDrafts) safeSet('askk:layout', JSON.stringify({ tabs, temporaryTab, selected, secondaryGroup, activeEditorGroup, splitEditors, groupRatio, explorerOpen, explorerWidth })) }, [tabs, temporaryTab, selected, secondaryGroup, activeEditorGroup, splitEditors, groupRatio, explorerOpen, explorerWidth, hydratedDrafts])
  useEffect(() => { setPaletteIndex(0) }, [paletteQuery])
  useEffect(() => {
    if (!hydratedDrafts) return
    const timer = setTimeout(preserveDrafts, 200)
    return () => clearTimeout(timer)
  }, [documents, goal, hydratedDrafts, preserveDrafts])
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 6000); return () => clearTimeout(timer) } }, [toast])
  useEffect(() => { if (atBottom.current && transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight }, [state.messages, state.run])

  const perform = useCallback(async (name, ...args) => {
    if (!controller?.[name]) throw new Error(`${name} is not available in this runtime yet.`)
    return controller[name](...args)
  }, [controller])
  const action = useCallback((name, ...args) => perform(name, ...args).catch(error => setToast(error?.message || String(error))), [perform])

  function pinTab(path, groupId) {
    for (const id of groupId ? [groupId] : ['primary', 'secondary']) writeGroup(id, pinEditorTab(readGroup(id), path))
  }

  const openFile = useCallback(async (path, automatic = false, { pin = false, groupId = activeEditorGroupRef.current, keepSelection = false } = {}) => {
    const navigation = fileNavigation.current.begin(groupId)
    if (!automatic) setFollow(false)
    try {
      if (!docsRef.current[path]) {
        const accepted = await readEditorDocument({
          path, read: name => perform('readFile', name),
          snapshot: () => ({ documents: docsRef.current, files: fileSnapshot.current.files, ready: fileSnapshot.current.ready }),
          isCurrent: () => fileNavigation.current.isCurrent(groupId, navigation),
          install: file => {
            if (!fileNavigation.current.isCurrent(groupId, navigation)) return false
            if (!docsRef.current[path]) {
              const next = { ...docsRef.current, [path]: { content: file.content, baseContent: file.content, baseRev: file.rev } }
              docsRef.current = next; setDocuments(next)
            }
            return true
          },
        })
        if (!accepted) return false
      }
      if (!fileNavigation.current.isCurrent(groupId, navigation)) return false
      const dirty = new Set(Object.entries(docsRef.current).filter(([, doc]) => doc.content !== doc.baseContent).map(([name]) => name))
      const reveal = !automatic || innerWidth > 600 || phoneSurfaceRef.current === 'code'
      writeGroup(groupId, openEditorTab(readGroup(groupId), path, { pin, dirtyPaths: dirty, select: reveal && !keepSelection }))
      lastCodeSelection.current[groupId] = path
      if (!automatic && activeEditorGroupRef.current === groupId) { activateGroup(groupId); setSurface('workspace'); setPhoneSurface('code'); if (innerWidth < 1280) setExplorerOpen(false) }
      return true
    } catch (error) { setToast(error.message); return false }
  }, [perform])

  useEffect(() => {
    if (!controller || !state.ready) return
    for (const id of ['primary', 'secondary']) {
      const selection = readGroup(id).selected; const path = editorFilePath(selection)
      if (selection !== 'welcome' && !isPreviewTab(selection) && !docsRef.current[path]) openFile(path, true, { groupId: id, pin: isDiffTab(selection), keepSelection: isDiffTab(selection) })
    }
  }, [controller, state.ready, selected, secondaryGroup.selected, openFile])

  useEffect(() => {
    const openPaths = [...readGroup('primary').tabs, ...readGroup('secondary').tabs].map(editorFilePath)
    const reconciled = reconcileMissingDocuments(docsRef.current, state.files, { ready: state.ready, hydrated: hydratedDrafts, saving: savesInFlight.current, openPaths })
    if (reconciled.documents !== docsRef.current) { docsRef.current = reconciled.documents; setDocuments(reconciled.documents) }
    for (const path of reconciled.closedPaths) { removeFileTabs(path); forgetEditorFile(editorCache.current, state.project?.id, path) }
  }, [state.files, state.ready, hydratedDrafts, documents])

  useEffect(() => {
    if (!controller || !state.ready) return
    let live = true
    const before = previousFiles.current
    const after = new Map(state.files.map(file => [file.path, file.rev]))
    for (const file of state.files) {
      const doc = docsRef.current[file.path]
      if (doc && (file.rev !== doc.baseRev || doc.incoming?.deleted)) controller.readFile(file.path).then(latest => {
        if (!live || !latest) return
        setDocuments(previous => {
          const current = previous[file.path]
          if (!current || current.baseRev === latest.rev && !current.incoming?.deleted) return previous
          if (current.incoming?.deleted && current.baseRev === latest.rev && current.baseContent === latest.content) return { ...previous, [file.path]: { ...current, incoming: null } }
          return { ...previous, [file.path]: current.content !== current.baseContent ? { ...current, incoming: latest } : { content: latest.content, baseContent: latest.content, baseRev: latest.rev } }
        })
      }).catch(error => setToast(error.message))
    }
    const changed = state.files.filter(file => before.has(file.path) ? before.get(file.path) !== file.rev : filesObserved.current)
    previousFiles.current = after
    filesObserved.current = true
    if (follow && running && changed.length) openFile(changed.at(-1).path, true)
    return () => { live = false }
  }, [state.files, state.ready, controller, follow, running, openFile])

  useEffect(() => {
    const artifact = state.artifacts.at(-1)
    if (!artifact || artifact.status !== 'ready' || previousArtifact.current === artifact.id) return
    previousArtifact.current = artifact.id
    if (follow && artifact.status === 'ready' && (innerWidth > 600 || phoneSurfaceRef.current === 'preview')) { const id = activeEditorGroupRef.current; writeGroup(id, openEditorTab(readGroup(id), 'preview')) }
  }, [state.artifacts, follow])

  async function save(path = editorFilePath(activeSelectionRef.current), override) {
    const doc = override || docsRef.current[path]
    if (!doc || savesInFlight.current.has(path)) return false
    const contentAtAdmission = docsRef.current[path]?.content
    savesInFlight.current.add(path)
    try {
      const result = await perform('saveFile', { path, content: doc.content, expect: doc.baseRev })
      if (result.conflict) {
        const latest = result.current || await perform('readFile', path)
        const draft = draftForConflict(docsRef.current[path], doc, contentAtAdmission)
        setModal({ type: 'conflict', path, base: doc.baseContent, latest, draft, deleted: !latest })
        setModalValue(draft)
        return false
      }
      const next = { ...docsRef.current, [path]: acknowledgeSavedDraft(docsRef.current[path] || doc, doc, result.rev) }
      docsRef.current = next
      setDocuments(next)
      return true
    } catch (error) { setToast(error.message); return false }
    finally { savesInFlight.current.delete(path) }
  }
  function closeTab(id, groupId = activeEditorGroupRef.current) {
    const path = editorFilePath(id)
    if (!isDiffTab(id) && dirtyPaths.has(path)) { setModal({ type: 'close', path, groupId }); return }
    removeTab(id, groupId)
  }
  function removeTab(id, groupId = activeEditorGroupRef.current) { fileNavigation.current.invalidate(groupId); writeGroup(groupId, closeEditorTab(readGroup(groupId), id)) }
  function removeFileTabs(path) {
    for (const id of ['primary', 'secondary']) { fileNavigation.current.invalidate(id); let group = readGroup(id); for (const tab of group.tabs) if (editorFilePath(tab) === path) group = closeEditorTab(group, tab); writeGroup(id, group) }
  }
  function discardDeletedDraft(path) {
    const next = { ...docsRef.current }; delete next[path]
    docsRef.current = next; setDocuments(next)
    removeFileTabs(path); forgetEditorFile(editorCache.current, fileSnapshot.current.project?.id, path)
    setModal(null)
  }
  async function saveAndClose() {
    const path = modal.path
    const submitted = { ...docsRef.current[path] }
    setBusy('save-close')
    try {
      if (!await save(path, submitted)) return
      const current = docsRef.current[path]
      if (current.content !== submitted.content || current.incoming) { setToast('The draft changed during saving. Review it before closing.'); return }
      removeTab(path, modal.groupId); setModal(null)
    } finally { setBusy('') }
  }
  async function resolveDraftConflict() {
    const { path, latest } = modal
    const content = modalValue
    const previousContent = docsRef.current[path]?.content
    setBusy('resolve')
    try {
      if (!await save(path, { content, baseContent: latest?.content || '', baseRev: latest?.rev || 0 })) return
      const current = docsRef.current[path]
      if (current.content !== previousContent) { setToast('The editor changed during resolution. Your new draft has been preserved.'); return }
      const next = { ...docsRef.current, [path]: { ...current, content } }
      docsRef.current = next; setDocuments(next); setModal(null)
    } finally { setBusy('') }
  }
  async function send(event) {
    event?.preventDefault()
    if (!goal.trim() || !controller || !state.ready) return
    if (!state.model.id && !state.model.model) { setModal({ type: 'settings', tab: 'model' }); return }
    const text = goal.trim()
    setGoal(''); setFollow(true); atBottom.current = true
    try { await perform('sendGoal', text) } catch (error) { setGoal(text); setToast(error.message) }
  }
  async function build() {
    if (buildInFlight.current) return
    buildInFlight.current = true
    setBusy('build')
    try {
      await saveAllDrafts(() => docsRef.current, save)
      selectEditor('preview'); setSurface('workspace')
      await perform('buildPreview')
    } catch (error) { setToast(error.message) }
    finally { buildInFlight.current = false; setBusy('') }
  }
  function openSettings(tab = 'model') { setModalError(''); setModal({ type: 'settings', tab }) }
  function showCreate() { setModalValue(''); setModalError(''); setModal({ type: 'create' }) }

  useEffect(() => {
    const shortcut = event => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape' && innerWidth < 1280 && !modal && !palette) closeExplorer()
      if ((event.metaKey || event.ctrlKey) && ['p', 'k'].includes(event.key.toLowerCase())) { event.preventDefault(); setPaletteQuery(event.shiftKey || event.key.toLowerCase() === 'k' ? '>' : ''); setPalette(true) }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(editorFilePath(activeSelectionRef.current)) }
      if ((event.metaKey || event.ctrlKey) && event.key === '`') { event.preventDefault(); togglePanel() }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  })

  async function submitFileAction(event) {
    event.preventDefault(); setModalError(''); setBusy('file')
    try {
      const path = modalValue.trim().replace(/^\/+/, '')
      if (!path || path.split('/').some(segment => !segment || segment === '..' || segment === '.')) throw new Error('Choose a relative file path without empty or parent segments.')
      if (modal.type === 'create') {
        const result = await perform('createFile', path, '')
        if (result?.conflict) throw new Error('A file already exists at that path. Choose another name.')
      }
      else {
        if (dirtyPaths.has(modal.path) && !(await save(modal.path))) return
        const latest = await perform('readFile', modal.path)
        const result = await perform('renameFile', modal.path, path, latest?.rev)
        if (result?.conflict) throw new Error('The file changed while renaming. Try again with the latest version.')
        removeFileTabs(modal.path)
      }
      setModal(null); await openFile(path, false, { pin: true })
    } catch (error) { setModalError(error.message) } finally { setBusy('') }
  }

  const activeTemporaryTab = activeEditorGroup === 'secondary' ? secondaryGroup.temporaryTab : temporaryTab
  const paletteActions = [
    ...(activeTemporaryTab ? [{ label: 'Keep preview file open', icon: 'pin', run: () => pinTab(activeTemporaryTab, activeEditorGroup) }] : []),
    { label: 'New file', icon: 'plus', run: showCreate },
    { label: 'Build and preview', icon: 'play', run: build },
    { label: 'Toggle command panel', icon: 'terminal', run: togglePanel },
    { label: 'Show problems', icon: 'warning', run: showProblems },
    { label: 'Show agents and task plans', icon: 'agents', run: showAgents },
    { label: 'Connect a model', icon: 'spark', run: () => openSettings('model') },
    { label: 'Configure execution', icon: 'box', run: () => openSettings('runtime') },
    { label: 'Toggle file explorer', icon: 'panel', run: () => toggleExplorer() },
    { label: 'Switch color theme', icon: 'sun', run: () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark') },
    { label: 'Focus conversation', icon: 'chat', run: () => { showConversation(true) } },
  ]
  const paletteItems = paletteQuery.startsWith('>') ? paletteActions.filter(item => item.label.toLowerCase().includes(paletteQuery.slice(1).trim().toLowerCase())) : state.files.filter(file => file.path.toLowerCase().includes(paletteQuery.toLowerCase())).map(file => ({ label: file.path, icon: 'files', run: () => openFile(file.path) }))

  function toolCard(tool) {
    return <ToolCard key={tool.id || tool.name} tool={tool}
      fileAvailable={!!tool.path && state.files.some(file => file.path === tool.path)}
      commandAvailable={!!tool.commandId && state.commands.some(command => command.id === tool.commandId)}
      artifactAvailable={!!tool.artifactId && state.artifacts.some(artifact => artifact.id === tool.artifactId)}
      onFile={() => openFile(tool.path)} onCommand={() => showCommand(tool.commandId)}
      onArtifact={() => { selectEditor(`artifact:${tool.artifactId}`); setSurface('workspace') }}/>
  }

  function renderEditorGroup(groupId) {
    const group = groupId === 'secondary' ? secondaryGroup : primaryGroup
    const selection = group.selected
    const path = editorFilePath(selection)
    const doc = documents[path]
    const artifact = state.artifacts.find(item => selection === `artifact:${item.id}`) || state.artifacts.find(item => item.id === state.activeArtifactId) || state.artifacts.at(-1)
    const active = activeEditorGroup === groupId
    const number = groupId === 'primary' ? 1 : 2
    return <section key={groupId} className={`editor-group ${groupId} ${active ? 'active' : ''}`} aria-label={`Editor group ${number}`} onPointerDownCapture={() => activateGroup(groupId)} onFocusCapture={() => activateGroup(groupId)} style={groupsWide ? { flexBasis: `${(groupId === 'primary' ? groupGeometry.ratio : 1 - groupGeometry.ratio) * 100}%` } : undefined}>
      <div className="editor-group-heading"><button aria-pressed={active} onClick={() => activateGroup(groupId, true)}>Group {number}</button><span>{isPreviewTab(selection) ? 'Preview' : selection === 'welcome' ? 'Getting started' : lastName(path)}</span><div><IconButton icon="panel" label={`Split code from group ${number}`} disabled={!doc || splitEditors} onClick={() => { activateGroup(groupId); splitGroup() }}/><IconButton icon="globe" label={`Open preview beside group ${number}`} disabled={!doc} onClick={() => { activateGroup(groupId); splitGroup(true) }}/>{groupId === 'secondary' && <IconButton icon="close" label="Close second editor group" onClick={closeSecondGroup}/>}</div></div>
      <div className="editor-tabs" role="tablist" aria-label={`Open editors in group ${number}`}>
        <button role="tab" className={selection === 'welcome' ? 'active' : ''} aria-selected={selection === 'welcome'} onClick={() => selectEditor('welcome', groupId)}><Icon name="spark" size={13}/><span>Getting started</span></button>
        {group.tabs.map(tab => <div className={`file-tab ${selection === tab ? 'active' : ''} ${group.temporaryTab === tab ? 'temporary-tab' : ''}`} key={tab}><button role="tab" aria-selected={selection === tab} title={isDiffTab(tab) ? `${editorFilePath(tab)} · Saved base versus current draft` : group.temporaryTab === tab ? `${tab} · Temporary preview. Double-click to keep open.` : tab} onDoubleClick={() => pinTab(tab, groupId)} onClick={() => selectEditor(tab, groupId)}>{isDiffTab(tab) ? <Icon name="changes" size={13}/> : <FileIcon path={tab}/>}<span>{lastName(editorFilePath(tab))}{isDiffTab(tab) ? ' · Changes' : ''}</span>{!isDiffTab(tab) && dirtyPaths.has(tab) && <span className="dirty-dot"/>}</button>{group.temporaryTab === tab && <IconButton icon="pin" label={`Keep ${lastName(tab)} open in group ${number}`} onClick={() => pinTab(tab, groupId)}/>}<IconButton icon="close" label={`Close ${lastName(editorFilePath(tab))}${isDiffTab(tab) ? ' changes' : ''} in group ${number}`} onClick={() => closeTab(tab, groupId)}/></div>)}
        <button role="tab" className={isPreviewTab(selection) ? 'active preview-tab' : 'preview-tab'} aria-selected={isPreviewTab(selection)} onClick={() => selectEditor('preview', groupId)}><Icon name="globe" size={13}/><span>Preview</span>{artifact?.status === 'ready' && <span className="ready-tab-dot"/>}</button><div className="tabs-spacer"/><IconButton icon="terminal" label="Toggle terminal panel" onClick={togglePanel}/>
      </div>
      <div className="editor-surface"><div className="primary-editor">
        {selection === 'welcome' ? <Welcome state={state} onModel={() => openSettings('model')} onRuntime={() => openSettings('runtime')} onCreate={showCreate} onCompose={() => { showConversation(true) }}/>
        : isPreviewTab(selection) ? <div className="preview-surface"><div className="preview-toolbar"><div className="preview-address"><Icon name="globe" size={13}/><span>{artifact?.name || 'Application preview'}</span></div><select aria-label={`Preview viewport in group ${number}`} value={previewSize} onChange={event => setPreviewSize(event.target.value)}><option value="fit">Fit</option><option value="390">Phone · 390</option><option value="768">Tablet · 768</option></select><IconButton icon="refresh" label="Refresh preview" disabled={!artifact?.html} onClick={() => action('refreshPreview')}/></div>{artifact?.html ? <ArtifactPreview artifact={artifact} projectId={state.project?.id} size={previewSize}/> : <div className="empty-preview"><div className="preview-illustration"><Icon name="globe" size={38}/></div><h2>A place for your creation.</h2><p>{artifact?.error || 'Build your project to see it running here. Your files, commands, and preview stay together.'}</p><button className="button primary" onClick={build} disabled={!!busy || !state.files.length || activeStatus(artifact?.status)}><Icon name="play" size={14}/>{busy === 'build' || activeStatus(artifact?.status) ? 'Building…' : dirtyPaths.size ? 'Save all & build' : 'Build preview'}</button></div>}</div>
        : isDiffTab(selection) && doc ? <><div className="editor-breadcrumb"><span>{path} · Changes</span><div><button className="text-button" onClick={() => selectEditor(path, groupId)}>Open file</button><button className="text-button" disabled={!dirtyPaths.has(path)} onClick={() => save(path)}><Icon name="save" size={13}/>Save</button></div></div><DiffView path={path} base={doc.baseContent} draft={doc.content} baseLabel="Saved base" draftLabel="Your draft"/></>
        : doc ? <><div className="editor-breadcrumb"><span>{path.split('/').join('  /  ')}</span><div>{doc.incoming && <button className="incoming-button" onClick={() => { setModal({ type: 'conflict', path, base: doc.baseContent, latest: doc.incoming.deleted ? null : doc.incoming, deleted: !!doc.incoming.deleted }); setModalValue(doc.content) }}>{doc.incoming.deleted ? 'File deleted · Review' : 'New committed version'}</button>}<button className="text-button" disabled={!dirtyPaths.has(path)} onClick={() => save(path)}><Icon name="save" size={13}/>{dirtyPaths.has(path) ? 'Save' : 'Saved'}</button><IconButton icon="changes" label={`Compare draft for ${lastName(path)}`} disabled={!dirtyPaths.has(path)} onClick={() => openDiff(path)}/><IconButton icon="more" label="File actions" onClick={() => { setModalValue(path); setModal({ type: 'fileMenu', path, groupId }) }}/></div></div><Editor key={`${state.project?.id || 'default'}:${groupId}`} cache={editorCache.current} groupId={groupId} scope={state.project?.id} path={path} value={doc.content} theme={resolvedTheme} onChange={content => changeDocument(path, content)} onSave={() => save(path)} onFocus={() => { activateGroup(groupId); setFollow(false) }} onPosition={next => { positions.current[groupId] = next; if (activeEditorGroupRef.current === groupId) setPosition(next) }}/></> : <div className="surface-loading">Opening file…</div>}
      </div></div>
    </section>
  }

  return <div className={`workbench surface-${surface} phone-surface-${phoneSurface}`} style={{ '--chat-width': chatWidth ? `${chatWidth}px` : undefined, '--panel-height': `${panelHeight}px`, '--explorer-width': explorerWidth ? `${explorerWidth}px` : undefined }}>
    <a className="skip-link" href="#conversation-input">Skip to conversation</a>
    <header className="app-header">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); showConversation(true) }} aria-label="ASKK home"><span className="brand-mark"><span/><span/><span/></span><span>askk<span className="brand-period">.</span></span></a>
      <span className="header-divider"/><span className="project-title">{state.project?.name || 'Personal workspace'}</span>
      <button aria-label="Search files and commands" className="command-search" onClick={() => { setPaletteQuery(''); setPalette(true) }}><Icon name="search" size={14}/><span>Search files and commands</span><kbd>⌘ K</kbd></button>
      <div className="header-actions"><span className="local-badge"><span/>Browser owned</span><IconButton icon={resolvedTheme === 'dark' ? 'sun' : 'moon'} label="Switch color theme" onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}/><IconButton icon="settings" label="Settings" onClick={() => openSettings()}/><span className="avatar" aria-label="Your workspace">K</span></div>
    </header>
    <div className="compact-switch" role="tablist" aria-label="Main surface"><button role="tab" aria-selected={surface === 'conversation'} onClick={() => showConversation()}><Icon name="chat" size={16}/>Conversation</button><button role="tab" aria-selected={surface === 'workspace'} onClick={() => setSurface('workspace')}><Icon name="code" size={16}/>Workspace{state.files.length > 0 && <span>{state.files.length}</span>}</button></div>
    <main className="workbench-body">
      <section className="conversation-pane" aria-label="Agent conversation">
        <div className="conversation-heading"><div><span className="eyebrow">YOUR BUILD PARTNER</span><h1>Let’s make something.</h1></div><IconButton icon="more" label="Conversation options" onClick={() => { setModalValue(state.goal || ''); setModal({ type: 'goal', revision: state.goalRevision }) }}/></div>
        <div className="transcript" ref={transcript} onScroll={() => { const node = transcript.current; atBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64 }}>
          {!state.messages.length ? <div className="conversation-welcome"><div className="welcome-orbit"><Icon name="spark" size={27}/></div><h2>A thought to start.<br/>A working thing to finish.</h2><p>Describe what you want to build. Your agents will work through the files, run the commands, and bring it to life.</p><div className="starter-prompts">{[
            ['globe', 'Build a personal website', 'Build a polished personal portfolio website with a projects section and a contact page.'],
            ['box', 'Make a useful little tool', 'Build a beautiful habit tracker that saves my progress in the browser.'],
            ['code', 'Start with my own idea', ''],
          ].map(([icon, title, prompt]) => <button key={title} onClick={() => { setGoal(prompt); composer.current?.focus() }}><Icon name={icon} size={16}/><span>{title}</span><Icon name="right" size={14}/></button>)}</div></div> : state.messages.map((message, index) => <article key={message.id || index} className={`message message-${message.role || 'assistant'}`}>
            <div className="message-meta"><span className={`message-avatar ${message.role === 'user' ? 'user' : ''}`}>{message.role === 'user' ? 'Y' : <Icon name="spark" size={13}/>}</span><strong>{message.role === 'user' ? 'You' : message.agent || 'ASKK'}</strong>{message.at && <time>{new Date(message.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>}</div>
            <Markdown text={textOf(message.content)}/>{message.tools?.length > 0 && <div className="tool-cards">{message.tools.map(toolCard)}</div>}
          </article>)}
          {state.approvals.map(approval => <div className="approval-card" key={approval.id}><div><Icon name="warning" size={16}/><strong>Your approval is needed</strong></div><p>{approval.description || approval.name || approval.tool || 'This action needs your approval.'}</p>{approval.args && <pre>{textOf(approval.args)}</pre>}<div className="button-row"><button className="button primary small" onClick={() => action('approve', approval.id, true)}>Allow once</button><button className="button subtle small" onClick={() => action('approve', approval.id, false)}>Deny</button></div></div>)}
          {running && <div className="thinking-line"><span className="thinking-dots"><i/><i/><i/></span><span>{state.run?.agent || 'Agent'} {state.run?.status || 'working'}{state.run?.step ? ` · loop ${state.run.step}` : ''}</span></div>}
        </div>
        <div className="composer-wrap">{state.goal && <button className="current-plan-link" onClick={() => { setModalValue(state.goal); setModal({ type: 'goal', revision: state.goalRevision }) }}><Icon name="chat" size={14}/><span><strong>Conversation goal</strong><small>{state.goal}</small></span><Icon name="right" size={12}/></button>}{currentPlan?.items?.length > 0 && <button className="current-plan-link" onClick={showAgents}><Icon name="changes" size={14}/><span><strong>Task plan · {currentPlan.items.filter(item => item.status === 'done').length}/{currentPlan.items.length}</strong><small>{currentPlan.items.find(item => item.status === 'doing')?.text || 'View recorded steps and progress'}</small></span><Icon name="right" size={12}/></button>}{state.error && <div className="inline-error"><Icon name="warning" size={14}/><span>{state.error}</span></div>}
          <form className="composer" onSubmit={send}><textarea ref={composer} id="conversation-input" value={goal} onChange={event => setGoal(event.target.value)} placeholder={running ? 'Steer this task…' : 'What would you like to create?'} rows={3} aria-label="Your goal" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send() } }}/><div className="composer-actions"><button type="button" className="model-picker" onClick={() => openSettings('model')}><Icon name="spark" size={13}/><span>{state.model.id || state.model.model || 'Connect a model'}</span><Icon name="down" size={12}/></button>{running ? <IconButton icon="stop" label="Stop current task" className="stop-button" onClick={() => action('stopRun')}/> : null}<button type="submit" className="send-button" aria-label={running ? 'Send note' : 'Send goal'} disabled={!goal.trim() || !controller || !state.ready}><Icon name="arrow" size={18}/></button></div></form>
          <div className="composer-foot"><span><Icon name="changes" size={12}/> {state.agents.length ? `${state.agents.length} agents` : 'Your agents, your tools'}</span><span>Shift ↵ for a new line</span></div>
        </div>
      </section>
      <ResizeHandle label="Resize conversation" onResize={delta => setChatWidth(previous => Math.max(300, Math.min(window.innerWidth - 560, (previous || (innerWidth >= 1440 ? 400 : innerWidth >= 1280 ? 360 : 320)) + delta)))}/>
      <section className="workspace-pane" aria-label="Project workspace">
        <div className="workspace-toolbar"><div className="workspace-label"><Icon name="box" size={16}/><strong title={state.project?.name || 'Workspace'}>{state.project?.name || 'Workspace'}</strong><span className="workspace-private">{state.runtime.target === 'local' ? 'Companion workspace' : 'Saved in this browser'}</span></div><div className="workspace-actions"><button className="button subtle small build-action" aria-label="Save all and build" title="Save every open draft, then build the committed workspace" onClick={build} disabled={!!busy || running || !state.files.length}><Icon name="play" size={12}/><span>{busy === 'build' ? 'Building…' : 'Save all & build'}</span></button><button className={`follow-button ${follow ? 'active' : ''}`} onClick={() => setFollow(value => !value)} title="Follow committed agent changes"><Icon name="bolt" size={13}/><span>{follow ? 'Following' : 'Follow agent'}</span></button><button className="runtime-pill" onClick={() => openSettings('runtime')}><StatusDot status={state.runtime.status}/><span>{state.runtime.target === 'local' ? 'Local Bun' : 'Browser Linux'}</span><Icon name="down" size={12}/></button></div></div>
        <PhoneWorkspaceTabs selected={phoneSurface} onSelect={selectPhoneSurface}/>
        <div className="workspace-main" id="phone-workspace-panel" role="tabpanel" aria-labelledby={`phone-tab-${phoneSurface}`}><nav className="activity-bar" aria-label="Workspace views">{[['files','files','Files'], ['search','search','Search files'], ['changes','changes','Changes'], ['agents','agents','Agents'], ['artifacts','box','Artifacts']].map(([key, icon, label]) => <IconButton key={key} icon={icon} label={label} className={activity === key && explorerOpen ? 'active' : ''} aria-expanded={activity === key && explorerOpen} aria-controls="workspace-sidebar" onClick={event => toggleExplorer(key, event.currentTarget)}/>) }<div className="activity-spacer"/><IconButton icon="terminal" label="Toggle terminal panel" className={panelOpen ? 'active' : ''} onClick={togglePanel}/><IconButton icon="settings" label="Runtime settings" onClick={() => openSettings('runtime')}/></nav>
          {drawerOpen && <button className="workspace-drawer-scrim" aria-label="Dismiss sidebar overlay" tabIndex={-1} onClick={closeExplorer}/>}
          {explorerOpen && <aside id="workspace-sidebar" ref={sidebarNode} className="explorer" aria-label={`${activity} sidebar`}><div className="explorer-heading"><span>{({files:'EXPLORER',search:'SEARCH',changes:'CHANGES',agents:'AGENTS',artifacts:'ARTIFACTS'})[activity]}</span><div>{activity === 'files' && <IconButton icon="plus" label="New file" onClick={showCreate}/>}<IconButton icon={drawerOpen ? "close" : "panel"} label={drawerOpen ? "Close sidebar" : "Collapse sidebar"} data-sidebar-close onClick={closeExplorer}/></div></div>
            {(activity === 'files' || activity === 'search') && <>{activity === 'search' && <div className="sidebar-search"><Icon name="search" size={13}/><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a file…" aria-label="Find a file"/></div>}<div className="project-root"><Icon name="down" size={12}/><strong>{state.project?.name || 'YOUR PROJECT'}</strong><span>{state.files.length}</span></div>{state.files.length ? <FileTree files={state.files} selected={editorFilePath(activeSelection)} dirtyPaths={dirtyPaths} query={activity === 'search' ? query : ''} onOpen={openFile} onPin={path => openFile(path, false, { pin: true })} onMenu={path => { setModalValue(path); setModal({ type: 'fileMenu', path }) }}/>:<div className="sidebar-empty"><Icon name="folder" size={26}/><p>Your files will appear here as you build.</p><button className="text-button" onClick={showCreate}>Create a file <Icon name="plus" size={13}/></button></div>}</>}
            {activity === 'changes' && <div className="sidebar-list">{dirtyPaths.size ? [...dirtyPaths].map(path => <button className="sidebar-item" key={path} onClick={() => openDiff(path)}><FileIcon path={path}/><span>{lastName(path)}<small>Unsaved draft</small></span><span className="change-badge">M</span></button>) : <div className="sidebar-empty"><Icon name="check" size={25}/><p>All open files are saved.</p></div>}<p className="sidebar-note">Human drafts stay separate from committed agent changes.</p></div>}
            {activity === 'agents' && <div className="sidebar-list">{state.agents.map(agent => <div className="agent-item" key={agent.id || agent.name}><span className="agent-mark"><Icon name="spark" size={15}/></span><span><strong title={agent.name || agent.id}>{agent.name || agent.id}</strong><small title={agent.description}>{agent.status || agent.description || 'Available'}</small></span>{agent.id && activeStatus(agent.status) ? <IconButton icon="stop" label={`Stop ${agent.name || agent.id} and its subagents`} onClick={() => action('stopAgent', agent.id)}/> : <StatusDot status={agent.status}/>}</div>)}{!state.agents.length && <div className="sidebar-empty"><p>{state.ready ? 'Agents will appear when a task starts.' : 'Loading agent definitions…'}</p></div>}{state.plans.length === 0 && <section className="task-plans"><h3>Task plan</h3><p className="sidebar-empty">No plan recorded for this conversation.</p></section>}{state.plans.length > 0 && <section className="task-plans" aria-label="Recorded task plans"><h3>Task plans</h3>{[...state.plans].reverse().map((plan, index) => <details key={plan.runId} open={index === 0}><summary><span>{plan.agent || 'Agent'}</span><small>{(plan.items || []).filter(item => item.status === 'done').length}/{plan.items?.length || 0}</small><Icon name="down" size={12}/></summary><ol>{(plan.items || []).map((item, index) => <li key={index} className={`plan-${item.status}`}><span className="plan-mark" aria-hidden="true">{item.status === 'done' ? <Icon name="check" size={11}/> : item.status === 'doing' ? <Icon name="play" size={10}/> : item.status === 'dropped' ? '–' : index + 1}</span><span>{item.text}<small>{({todo:'Pending',doing:'In progress',done:'Completed',dropped:'Dropped'})[item.status] || item.status}</small></span></li>)}</ol></details>)}</section>}</div>}
            {activity === 'artifacts' && <div className="sidebar-list">{state.artifacts.map(artifact => <button className="sidebar-item" key={artifact.id} onClick={() => selectEditor(`artifact:${artifact.id}`)}><Icon name={artifact.type === 'app' || artifact.type === 'html' ? 'globe' : 'box'} size={16}/><span>{artifact.name || 'Application'}<small>{artifact.status || 'Created'}{artifact.buildId ? ` · ${artifact.buildId}` : ''}</small></span></button>)}{!state.artifacts.length && <div className="sidebar-empty"><Icon name="box" size={26}/><p>Built pages and generated artifacts will collect here.</p></div>}</div>}
          </aside>}
          {explorerOpen && <ResizeHandle className="explorer-divider" label="Resize file explorer" value={explorerWidth ?? undefined} min={160} max={360} onResize={delta => setExplorerWidth(previous => Math.max(160, Math.min(360, (previous || document.querySelector('.explorer')?.clientWidth || 184) + delta)))}/>}
          <div inert={drawerOpen} className={`editor-stack ${splitEditors ? 'has-two-groups' : ''} ${groupsWide ? 'groups-wide' : 'groups-collapsed'}`}>
            {splitEditors && <div className="editor-group-switcher" aria-label="Editor groups">{['primary', 'secondary'].map((id, index) => <button key={id} aria-pressed={activeEditorGroup === id} onClick={() => { activateGroup(id, true); setFollow(false) }}>Group {index + 1}<span>{lastName(editorFilePath(readGroup(id).selected))}</span></button>)}<span className="group-width-hint">One group at a time at this width</span></div>}
            <div ref={editorGroupsNode} className="editor-groups" style={{ '--group-split': `${groupGeometry.ratio * 100}%` }}>
              {renderEditorGroup('primary')}
              {(splitEditors || secondaryGroup.tabs.length > 0 || isPreviewTab(secondaryGroup.selected)) && renderEditorGroup('secondary')}
              {groupsWide && <ResizeHandle className="editor-group-divider" label="Resize editor groups" value={Math.round(groupGeometry.ratio * 100)} min={Math.round(380 / editorWidth * 100)} max={Math.round((1 - 380 / editorWidth) * 100)} onResize={delta => setGroupRatio(previous => editorGroupGeometry(editorWidth, editorGroupGeometry(editorWidth, previous).ratio + delta / editorWidth).ratio)}/>}
            </div>
            {panelOpen && <><ResizeHandle vertical label="Resize terminal panel" onResize={delta => setPanelHeight(previous => Math.max(130, Math.min(innerHeight * .6, previous - delta)))}/><section className="bottom-panel" aria-label="Commands, terminal, problems, and output"><div className="panel-toolbar"><div className="panel-tabs">{['commands', 'terminal', 'problems', 'output'].map(tab => <button key={tab} className={panelTab === tab ? 'active' : ''} onClick={() => setPanelTab(tab)}>{tab}{tab === 'commands' && state.commands.length > 0 && <span>{state.commands.length}</span>}{tab === 'problems' && problemCount > 0 && <span>{problemCount}</span>}</button>)}</div><div>{panelTab === 'terminal' && terminalId && <IconButton icon="stop" label="Close terminal session" onClick={async () => { try { await perform('closeTerminal', terminalId); setTerminalId(null) } catch (error) { setToast(error.message) } }}/>} {panelTab === 'commands' && currentCommand && activeStatus(currentCommand.status) && <IconButton icon="stop" label="Stop selected command" onClick={() => action('stopCommand', currentCommand.id)}/>}<IconButton icon="close" label="Close terminal panel" onClick={closePanel}/></div></div>
              {panelTab === 'commands' ? <>{state.commands.length > 0 && <div className="command-session-row"><select aria-label="Command session" value={currentCommand?.id || ''} onChange={event => setSelectedCommand(event.target.value)}>{state.commands.map(item => <option key={item.id} value={item.id}>{item.command} · {item.status}{item.exitCode != null ? ` (${item.exitCode})` : ''}</option>)}</select><span>{currentCommand?.cwd || 'project'}</span></div>}{currentCommand ? <Terminal controller={controller} sessionId={currentCommand.id} output={currentCommand.output || [currentCommand.stdout,currentCommand.stderr].filter(Boolean).join('\n')} outputLength={currentCommand.outputLength} theme={resolvedTheme}/> : <div className="command-empty"><Icon name="terminal" size={20}/><span>Run a command in your selected environment.</span></div>}<form className="command-input" onSubmit={event => { event.preventDefault(); if (command.trim()) { const value = command; setCommand(''); action('runCommand', value) } }}><span>❯</span><input aria-label="Shell command" placeholder="Enter a command…" value={command} onChange={event => setCommand(event.target.value)}/><button type="submit" className="text-button" disabled={!command.trim()}>Run <Icon name="play" size={11}/></button></form></>
              : panelTab === 'terminal' ? terminalId ? <Terminal controller={controller} sessionId={terminalId} interactive theme={resolvedTheme}/> : <div className="command-empty terminal-empty"><Icon name="terminal" size={22}/><p>Open an interactive terminal in {state.runtime.target === 'local' ? 'Local Bun' : 'Browser Linux'}.</p><button className="button subtle small" onClick={async () => { try { const terminal = await perform('openTerminal', { cols: 80, rows: 24 }); setTerminalId(terminal.id) } catch (error) { setToast(error.message) } }}>Open terminal</button></div>
              : panelTab === 'problems' ? <div className="problems-list" aria-label="Reported problems">{state.error && <div className="problem-item"><Icon name="warning" size={15}/><div><strong>Workspace needs attention</strong><p>{state.error}</p><button className="text-button" onClick={() => setPanelTab('output')}>View output <Icon name="right" size={11}/></button></div></div>}{[...failedCommands].reverse().map(item => <button className="problem-item" key={item.id} onClick={() => showCommand(item.id)}><Icon name="warning" size={15}/><span><strong>{item.command || 'Command failed'}</strong><small>{item.error ? textOf(item.error) : item.exitCode != null ? `Exited with code ${item.exitCode}` : 'Command failed'} · View command output</small></span><Icon name="right" size={12}/></button>)}{!problemCount && <div className="command-empty"><Icon name="check" size={18}/><span>No reported problems.</span></div>}</div>
              : <div className="runtime-output"><button className="button subtle small" disabled={!state.run} onClick={async () => { try { const evidence = await perform('exportRunEvidence'); const url = URL.createObjectURL(new Blob([JSON.stringify(evidence, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'askk-run-evidence.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) } catch (error) { setToast(error.message) } }}>Export run evidence</button><strong>{state.runtime.phase || state.runtime.status}</strong><pre>{textOf(state.runtime.detail || state.runtime.error || 'Runtime diagnostics will appear here when execution starts.')}</pre>{runtimeConsole && <><strong>Recent environment output</strong><pre aria-label="Environment console">{runtimeConsole}</pre></>}</div>}
            </section></>}
          </div>
        </div>
      </section>
    </main>
    {draftStorageError && <div className="draft-storage-error" role="alert"><Icon name="warning" size={16}/><span>{draftStorageError}</span><button className="text-button" onClick={preserveDrafts}>Retry draft save</button></div>}
    <footer className="status-bar"><div><span className="status-brand"><Icon name="code" size={13}/></span><button onClick={() => openSettings('runtime')}><StatusDot status={state.runtime.status}/>{state.runtime.target === 'local' ? 'Local Bun' : 'Browser Linux'} · {state.runtime.phase || state.runtime.status || 'not started'}</button></div><div><span>{draftStorageError ? 'Draft recovery unavailable' : dirtyPaths.size ? `${dirtyPaths.size} unsaved` : state.storageDurable === false ? 'Storage unavailable' : state.ready ? 'Changes saved locally' : 'Opening workspace…'}</span>{selectedDoc && !isDiffTab(activeSelection) && <><span>Ln {position.line}, Col {position.column}</span><span>{editorFilePath(activeSelection).split('.').pop().toUpperCase()}</span><span>UTF-8</span></>}<button onClick={() => openSettings('model')}><StatusDot status={state.model.status}/>{state.model.id || state.model.model ? ['connected', 'ready'].includes(state.model.status) ? 'Model connected' : state.model.status === 'failed' ? 'Model unavailable' : 'Model configured' : 'No model'}</button></div></footer>
    {toast && <div className="toast" role="status"><Icon name="warning" size={16}/><span>{toast}</span><IconButton icon="close" label="Dismiss notification" onClick={() => setToast('')}/></div>}
    {palette && <Modal title="Go anywhere" onClose={() => setPalette(false)}><div className="palette-input"><Icon name="search" size={18}/><input autoFocus placeholder="Search files, or type > for commands" aria-label="Search files and commands" value={paletteQuery} onChange={event => setPaletteQuery(event.target.value)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setPaletteIndex(index => Math.min(index + 1, paletteItems.length - 1)) } else if (event.key === 'ArrowUp') { event.preventDefault(); setPaletteIndex(index => Math.max(0, index - 1)) } else if (event.key === 'Enter' && paletteItems[paletteIndex]) { setPalette(false); paletteItems[paletteIndex].run() } }}/><kbd>esc</kbd></div><div className="palette-results">{paletteItems.slice(0, 30).map((item, index) => <button className={index === paletteIndex ? 'highlighted' : ''} key={item.label} onClick={() => { setPalette(false); item.run() }}><Icon name={item.icon} size={16}/><span>{item.label}</span><Icon name="right" size={13}/></button>)}{!paletteItems.length && <p>{paletteQuery.startsWith('>') ? 'No matching commands.' : 'No matching files. Type > to find a command.'}</p>}</div><div className="palette-hint"><kbd>↵</kbd> open selected result <span>Files and commands, one place.</span></div></Modal>}
    {modal?.type === 'goal' && <Modal title="Conversation goal" onClose={() => setModal(null)}><p className="modal-description">Keep a goal in context across messages and agent runs. Saving updates the next prompt; the composer remains available for individual requests.</p><label className="field-label" htmlFor="saved-goal">Saved goal</label><textarea id="saved-goal" className="form-input" rows={6} maxLength={12000} value={modalValue} onChange={event => setModalValue(event.target.value)}/><div className="modal-footer"><button className="button subtle" onClick={() => setModal(null)}>Cancel</button><button className="button subtle" disabled={!!busy || !state.goal} onClick={async () => { try { await perform('setConversationGoal', '', modal.revision); setModal(null) } catch (error) { setToast(error.message) } }}>Clear goal</button><button className="button primary" disabled={!!busy || modalValue.trim() === state.goal} onClick={async () => { try { await perform('setConversationGoal', modalValue, modal.revision); setModal(null) } catch (error) { setToast(error.message) } }}>Save goal</button></div></Modal>}
    {modal?.type === 'settings' && <Settings state={state} initialTab={modal.tab} theme={theme} setTheme={setTheme} perform={perform} onClose={() => setModal(null)} onError={setToast}/>}
    {(modal?.type === 'create' || modal?.type === 'rename') && <Modal title={modal.type === 'create' ? 'Create a file' : 'Rename file'} onClose={() => setModal(null)}><form onSubmit={submitFileAction}><label className="field-label" htmlFor="file-path">Path relative to your project</label><input id="file-path" className="form-input" autoFocus placeholder="src/app.js" value={modalValue} onChange={event => setModalValue(event.target.value)}/>{modalError && <p className="form-error">{modalError}</p>}<div className="modal-footer"><button type="button" className="button subtle" onClick={() => setModal(null)}>Cancel</button><button className="button primary" disabled={!!busy}>{modal.type === 'create' ? 'Create file' : 'Rename'}</button></div></form></Modal>}
    {modal?.type === 'fileMenu' && <Modal title={lastName(modal.path)} onClose={() => setModal(null)}><p className="modal-description mono">{modal.path}</p><div className="menu-actions">{readGroup(modal.groupId || activeEditorGroupRef.current).temporaryTab === modal.path && <button onClick={() => { pinTab(modal.path, modal.groupId || activeEditorGroupRef.current); setModal(null) }}><Icon name="pin"/>Keep file open</button>}<button onClick={() => setModal({ ...modal, type: 'rename' })}><Icon name="files"/>Rename file</button><button onClick={() => { navigator.clipboard?.writeText(modal.path).then(() => setToast('Path copied.')); setModal(null) }}><Icon name="code"/>Copy path</button><button className="danger-text" onClick={() => setModal({ ...modal, type: 'delete' })}><Icon name="close"/>Delete file</button></div></Modal>}
    {modal?.type === 'delete' && <Modal title="Delete this file?" onClose={() => setModal(null)}><p className="modal-description">{modal.path}{dirtyPaths.has(modal.path) ? ' has an unsaved draft. Deleting removes the file and this draft.' : ' will be removed from this project.'}</p><div className="modal-footer"><button className="button subtle" onClick={() => setModal(null)}>Cancel</button><button className="button danger" onClick={async () => { try { await perform('deleteFile', modal.path, documents[modal.path]?.baseRev); removeFileTabs(modal.path); setDocuments(previous => { const next = { ...previous }; delete next[modal.path]; return next }); setModal(null) } catch (error) { setToast(error.message) } }}>Delete file</button></div></Modal>}
    {modal?.type === 'close' && <Modal title="Save your changes?" onClose={() => { if (!busy) setModal(null) }}><p className="modal-description">Your changes to {lastName(modal.path)} haven’t been committed to the workspace.</p><div className="modal-footer"><button className="button subtle" disabled={!!busy} onClick={() => setModal(null)}>Cancel</button><button className="button subtle" disabled={!!busy} onClick={() => { const path = modal.path; if (docsRef.current[path]?.incoming?.deleted) { discardDeletedDraft(path); return }; setDocuments(previous => ({ ...previous, [path]: { ...previous[path], content: previous[path].baseContent } })); removeTab(path, modal.groupId); setModal(null) }}>Discard</button><button className="button primary" disabled={!!busy} onClick={saveAndClose}>Save & close</button></div></Modal>}
    {modal?.type === 'conflict' && <Modal wide title={modal.deleted ? 'This file was deleted' : 'Keep both changes in view'} onClose={() => { if (!busy) setModal(null) }}><p className="modal-description">{modal.path}{modal.deleted ? ' was deleted from the workspace. Your draft is preserved. Recreate the file explicitly, discard the draft, or keep editing.' : ' changed after your draft began. Compare the versions, edit your resolution, then save against the latest revision.'}</p><div className="conflict-grid"><label>Original base<textarea readOnly value={modal.base || ''}/></label><label>{modal.deleted ? 'Deleted from workspace' : `Latest committed · r${modal.latest?.rev}`}<textarea readOnly value={modal.latest?.content || ''}/></label><label>Your resolution<textarea disabled={!!busy} value={modalValue} onChange={event => setModalValue(event.target.value)}/></label></div><div className="modal-footer"><button className="button subtle" disabled={!!busy} onClick={() => setModal(null)}>Keep editing later</button>{modal.deleted && <button className="button subtle" disabled={!!busy} onClick={() => discardDeletedDraft(modal.path)}>Discard draft</button>}<button className="button primary" disabled={!!busy} onClick={resolveDraftConflict}>{modal.deleted ? 'Recreate file' : 'Save resolved draft'}</button></div></Modal>}
  </div>
}

function Welcome({ state, onModel, onRuntime, onCreate, onCompose }) {
  const hasModel = !!(state.model.id || state.model.model)
  const modelConnected = ['connected', 'ready'].includes(state.model.status)
  const runtimeReady = state.runtime.status === 'ready'
  return <div className="getting-started"><div className="workspace-watermark"><Icon name="code" size={48}/></div><div className="welcome-heading"><span className="eyebrow">A LITTLE SPACE. ENDLESS POSSIBILITIES.</span><h2>Your next idea<br/>starts here<span>.</span></h2><p>A real workspace for the things you imagine.<br/>{' '}Files, a terminal, and a live preview—right beside your conversation.</p></div><div className="setup-list"><div className="setup-item complete"><span className="setup-number"><Icon name="check" size={14}/></span><div><strong>Make yourself at home</strong><p>{state.runtime.target === 'local' ? 'Your workspace is set to use Local Bun.' : 'Your project lives in this browser.'}</p></div><span className="setup-state">{state.ready ? 'Ready' : 'Opening…'}</span></div><button className={`setup-item ${hasModel ? 'complete' : ''}`} onClick={onModel}><span className="setup-number">{hasModel ? <Icon name="check" size={14}/> : '2'}</span><div><strong>{hasModel ? modelConnected ? 'Your model is connected' : state.model.status === 'failed' ? 'Check your model connection' : 'Your model is configured' : 'Bring your favorite model'}</strong><p>{hasModel ? state.model.id || state.model.model : 'Connect a local or hosted model to get going.'}</p></div><Icon name="right" size={15}/></button><button className={`setup-item ${runtimeReady ? 'complete' : ''}`} onClick={onRuntime}><span className="setup-number">{runtimeReady ? <Icon name="check" size={14}/> : '3'}</span><div><strong>{runtimeReady ? 'Your environment is ready' : 'Choose where things run'}</strong><p>{runtimeReady ? `${state.runtime.target === 'local' ? 'Local Bun' : 'Browser Linux'} · ready for commands` : 'Browser Linux, or your own machine with Bun.'}</p></div><Icon name="right" size={15}/></button></div><div className="welcome-links"><button onClick={onCompose}><Icon name="chat" size={15}/>Start with a goal</button><span/><button onClick={onCreate}><Icon name="plus" size={15}/>Create a file</button></div><div className="workspace-footnote"><span className="tiny-spark">✳</span>Built around you. Powered by your agents.</div></div>
}

function Settings({ state, initialTab, theme, setTheme, perform, onClose, onError }) {
  const [tab, setTab] = useState(initialTab || 'model')
  const [baseUrl, setBaseUrl] = useState(state.model.baseUrl || 'http://127.0.0.1:8873/v1')
  const [model, setModel] = useState(state.model.id || state.model.model || '')
  const [key, setKey] = useState('')
  const [bridgeUrl, setBridgeUrl] = useState(state.companion.url || 'https://127.0.0.1:7717')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [transferTo, setTransferTo] = useState(null)
  const [review, setReview] = useState(null)
  const [resolution, setResolution] = useState('')
  async function run(label, fn) { setBusy(label); setError(''); setSuccess(''); try { await fn(); setSuccess(`${label} complete.`) } catch (error) { setError(error.message) } finally { setBusy('') } }
  const progress = state.runtime.progress
  const relayAvailable = state.companion.status === 'connected' && state.companion.capabilities?.includes('network-relay')
  const networkBusy = !!busy || activeStatus(state.run?.status) || state.commands.some(command => activeStatus(command.status))
  if (review) return <Modal wide title="Resolve saved workspace changes" onClose={() => setReview(null)}><p className="modal-description">{review.path} differs between the saved browser copy and the execution environment. Review both versions, then choose what the next startup should use.</p><div className="conflict-grid"><label>Saved browser copy<textarea readOnly value={review.saved?.content ?? '(deleted)'}/></label><label>Runtime copy<textarea readOnly value={review.runtime?.content ?? '(deleted)'}/></label><label>Merged text<textarea aria-label="Merged offline conflict" disabled={!!busy} value={resolution} onChange={event => setResolution(event.target.value)}/></label></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-footer">{[['runtime', 'Use runtime copy'], ['saved', 'Keep saved copy'], ['merge', 'Save merged text']].map(([choice, label]) => <button key={choice} className={`button ${choice === 'merge' ? 'primary' : 'subtle'}`} disabled={!!busy} onClick={() => run('Conflict resolution', async () => { await perform('resolveOfflineConflict', { path: review.path, journalRevision: review.journalRevision, runtimeRevision: review.runtime?.rev ?? 0, choice, content: resolution }); setReview(null) })}>{label}</button>)}</div><p className="form-help">The choice is saved first. Start the environment again to apply it against the reviewed runtime revision.</p></Modal>
  if (transferTo) return <Modal title="Transfer workspace snapshot" onClose={() => setTransferTo(null)}><p className="modal-description">Copy the current committed workspace to {transferTo === 'local' ? 'Local Bun' : 'Browser Linux'}. The original stays intact. Future changes happen in the selected environment; this is not a two-way sync.</p><ExecutionNotice notice={state.executionNotices?.[transferTo]}/><div className="transfer-summary"><span>From<strong>{state.runtime.target === 'local' ? 'Local Bun' : 'Browser Linux'}</strong></span><Icon name="right"/><span>To<strong>{transferTo === 'local' ? 'Local Bun' : 'Browser Linux'}</strong></span></div><p className="form-help">{state.files.length} committed files · destination must be empty · unsaved drafts stay in the editor</p>{error && <p className="form-error">{error}</p>}<div className="modal-footer"><button className="button subtle" disabled={!!busy} onClick={() => setTransferTo(null)}>Cancel</button><button className="button primary" disabled={!!busy} onClick={() => run('Workspace transfer', async () => { await perform('setExecutionTarget', transferTo, { transfer: true }); setTransferTo(null) })}>{busy || 'Transfer snapshot'}</button></div></Modal>
  return <Modal title="Make it yours" onClose={onClose} focusInput={tab === 'model'}><div className="settings-tabs">{['model','runtime','appearance'].map(item => <button key={item} className={tab === item ? 'active' : ''} onClick={() => { setTab(item); setError(''); setSuccess('') }}>{item === 'model' ? 'Model' : item === 'runtime' ? 'Execution' : 'Appearance'}</button>)}</div>
    {tab === 'model' && <form className="settings-form" onSubmit={event => { event.preventDefault(); run('Model settings', async () => { await perform('setModel', { baseUrl, model, ...(key ? { apiKey: key } : {}) }); setKey('') }) }}><p className="modal-description">Your agents use the model you choose. Local inference and command execution are configured separately.</p><label>API base URL<input className="form-input" type="url" required value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1"/></label><label>Model ID<input className="form-input" required value={model} onChange={event => setModel(event.target.value)} placeholder="Model name from your provider"/></label><label>API key <span className="optional">optional for local models</span><input className="form-input" type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} placeholder="Provider key, if required"/></label><div className="connection-help"><Icon name="laptop" size={16}/><span>For local models from this HTTPS page, pair the HTTPS companion in Execution settings.</span></div><button className="button primary" disabled={!!busy}>{busy || 'Save model'}</button><button type="button" className="button subtle" disabled={!!busy || !!key || baseUrl !== state.model.baseUrl || model !== (state.model.id || state.model.model)} onClick={() => run('Connection check', () => perform('testModel'))}>Test connection</button></form>}
    {tab === 'runtime' && <div className="settings-form"><p className="modal-description">Your agent lives in the browser. Choose where its commands execute.</p><div className="runtime-options">{[['browser','box','Browser Linux','A Linux environment inside this tab.'],['local','laptop','Local Bun','Commands on your computer through the companion.']].map(([value,icon,name,description]) => <button key={value} className={`runtime-option ${state.runtime.target === value ? 'selected' : ''}`} disabled={!!busy || activeStatus(state.run?.status)} onClick={() => { if (value === state.runtime.target) return; if (state.files.length) setTransferTo(value); else run('Runtime selection', () => perform('setExecutionTarget', value)) }}><Icon name={icon} size={20}/><span><strong>{name}</strong><small>{description}</small></span><span className="radio-mark"/></button>)}</div><ExecutionNotice notice={state.executionNotices?.[state.runtime.target]}/><div className="runtime-stage"><div><StatusDot status={state.runtime.status}/><strong>{state.runtime.phase || state.runtime.status || 'Not started'}</strong></div>{state.runtime.detail && <p>{textOf(state.runtime.detail)}</p>}{progress && <><progress max={progress.total || undefined} value={progress.total ? progress.received : undefined}/><small>{Math.round((progress.received || 0) / 1048576)} MiB{progress.total ? ` of ${Math.round(progress.total / 1048576)} MiB` : ' received'}</small></>}{state.runtime.conflicts?.map(conflict => <button key={conflict.path} className="button subtle small" disabled={!!busy} onClick={() => run('Review saved change', async () => { const detail = await perform('reviewOfflineConflict', conflict.path); setReview(detail); setResolution(detail.saved?.content ?? detail.runtime?.content ?? '') })}>Review {conflict.path}</button>)}{state.runtime.capabilities?.length > 0 && <div className="capability-chips">{state.runtime.capabilities.map(capability => <span key={capability}>{capability}</span>)}</div>}<button className="button subtle small" disabled={!!busy} onClick={() => run('Runtime startup', () => perform('startRuntime'))}><Icon name="play" size={12}/>{state.runtime.status === 'ready' ? 'Check workspace binding' : 'Start environment'}</button></div><div className="settings-divider"/><div className="settings-subheading"><h3>Guest networking</h3><span>{state.runtime.networkRelay ? 'Companion relay' : 'Browser Fetch'}</span></div><div className="network-options" role="radiogroup" aria-label="Guest networking" onKeyDown={event => { if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return; event.preventDefault(); const choices = [...event.currentTarget.querySelectorAll('[role=radio]:not(:disabled)')]; const index = choices.indexOf(document.activeElement); const next = choices[(index + (['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : 1) + choices.length) % choices.length]; next?.focus(); next?.click() }}>{[[false, 'Browser Fetch', 'Uses browser networking and its CORS rules.'], [true, 'Companion relay', 'Routes guest network requests through your paired companion.']].map(([enabled, label, description]) => <button type="button" role="radio" aria-checked={!!state.runtime.networkRelay === enabled} key={label} className={`runtime-option ${!!state.runtime.networkRelay === enabled ? 'selected' : ''}`} disabled={networkBusy || enabled && !relayAvailable} onClick={() => { if (!!state.runtime.networkRelay !== enabled) run('Guest networking', () => perform('setGuestNetworkRelay', enabled)) }}><Icon name={enabled ? 'laptop' : 'globe'} size={18}/><span><strong>{label}</strong><small>{description}</small></span><span className="radio-mark"/></button>)}</div><p className="form-help">This changes networking for Browser Linux. Commands still execute inside Browser Linux; native command execution is selected separately above.{!relayAvailable && ' Pair a companion with the network-relay capability to enable its relay.'}{state.runtime.networkRelay && !relayAvailable && ' The selected relay is unavailable; reconnect it or choose Browser Fetch.'}</p><div className="settings-divider"/><div className="settings-subheading"><h3>Optional local companion</h3><span><StatusDot status={state.companion.status}/>{state.companion.status}</span></div><p className="form-help">Connect local models, relay networking, or run native commands. Pairing does not change your selected execution target.</p><label>Companion URL<input className="form-input" disabled={!!busy} value={bridgeUrl} onChange={event => setBridgeUrl(event.target.value)} type="url"/></label><label>Pairing token<input className="form-input" disabled={!!busy} value={token} onChange={event => setToken(event.target.value)} type="password" autoComplete="off" placeholder="Token from your companion terminal"/></label><button className="button primary" disabled={!!busy || !token.trim()} onClick={() => run('Companion connection', () => perform('connectCompanion', { url: bridgeUrl, token }))}>{busy || 'Connect companion'}</button><BindingReview review={state.runtime.bindingReview} busy={!!busy} tokenAvailable={!!token.trim()} onConfirm={() => run('Workspace location', () => { const review = state.runtime.bindingReview; return perform('connectCompanion', { url: review.proposed.endpoint, token, [review.kind === 'legacy' ? 'rebind' : 'transfer']: true, expectedProposal: review.proposed }) })}/></div>}
    {tab === 'appearance' && <div className="settings-form"><p className="modal-description">A workspace that feels right, in any light.</p><div className="theme-options">{['light','dark','system'].map(option => <button key={option} className={`theme-option theme-${option} ${theme === option ? 'selected' : ''}`} onClick={() => setTheme(option)}><span className="theme-preview"><i/><i/><i/></span><strong>{option[0].toUpperCase() + option.slice(1)}</strong>{theme === option && <Icon name="check" size={14}/>}</button>)}</div><p className="form-help">Motion follows your device’s reduced-motion preference. Font sizes and keyboard focus stay readable in every theme.</p></div>}
    {error && <div className="settings-result error" role="alert"><Icon name="warning" size={16}/>{error}</div>}{success && <div className="settings-result success" role="status"><Icon name="check" size={16}/>{success}</div>}
  </Modal>
}
