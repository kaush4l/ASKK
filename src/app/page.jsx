'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { BackendClient } from '../client/BackendClient.js'
import {
  announce,
  askToAnnounce,
  copy,
  keepAwake,
  keyboardInset,
  room,
  share,
  watchOnline,
} from '../client/Device.js'
import { Dictation, Voice } from '../client/Speech.js'
import { EventName } from '../protocol/Envelope.js'
import { Composer } from './Composer.jsx'
import { Drawer } from './Drawer.jsx'
import { Header } from './Header.jsx'
import { statusLine } from './phrasing.js'
import { Settings } from './Settings.jsx'
import { Transcript } from './Transcript.jsx'

/**
 * The page: state, effects, and who gets told what.
 *
 * It held all of that AND every element of the interface, at 1,298 lines, and
 * `docs/INTERFACE.md` is the argument for the shape it has now. What is left
 * here is the work no component can do — the boot, the writer election, the
 * scheduler, the turn — and the components below are handed values.
 *
 * @see docs/INTERFACE.md
 */

/**
 * How often the page looks for a schedule that has come due.
 *
 * Twenty seconds, against a floor of sixty on a schedule's period: the tick is
 * what bounds how LATE a question is, and a schedule may not ask more often
 * than a minute, so a third of that is close enough to feel prompt and rare
 * enough to be free. One `schedules.due` is one indexed read of a store holding
 * a handful of records.
 */
const TICK_MS = 20_000

/**
 * Three questions that fill the composer.
 *
 * They are the only place a newcomer learns that this thing can run a command,
 * read a page or hand work to a second agent. The previous empty screen said so
 * in a paragraph and expected the reader to remember it; a reviewer's list of
 * things a first-time user could not discover ran to thirteen entries.
 */
const EXAMPLES = [
  {
    text: 'Run uname -a and tell me what kernel this is',
    why: 'a real Linux machine, in this tab',
  },
  { text: 'Search the web for what changed in Safari 26', why: 'it goes and looks' },
  { text: "Write today's plan to plan.md", why: 'its files last between conversations' },
]

export default function Page() {
  const clientRef = useRef(null)
  const scrollRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [conversationId, setConversationId] = useState(null)
  const [conversations, setConversations] = useState([])
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState([])
  const [busy, setBusy] = useState(false)
  // The id of the turn in flight, which is also the only handle there is on it
  // — see `CANCEL` in the envelope. Null between turns, and the stop button
  // exists exactly while it is not.
  const [running, setRunning] = useState(null)
  const [problem, setProblem] = useState(null)
  const [notes, setNotes] = useState([])
  const [settings, setSettings] = useState(null)
  const [agents, setAgents] = useState([])
  const [agentSpec, setAgentSpec] = useState(null)
  const [threads, setThreads] = useState([])
  const [showSettings, setShowSettings] = useState(false)
  const [testing, setTesting] = useState(false)
  // The turn, as it happens and afterwards. `raw` is the text arriving from the
  // model before it has been parsed, `reasoning` is the scratchpad a thinking
  // model emits alongside it, and `steps` are the passes that have resolved.
  //
  // The steps are KEPT after the turn. A ReAct run's tool calls existed only
  // while the spinner was up, so a person who looked away missed every one of
  // them — and the reply, which says "the step above shows where it came from",
  // was left pointing at something the page had just deleted.
  const [run, setRun] = useState({ raw: '', reasoning: '', steps: [], at: 0, ms: 0 })
  /**
   * What each tool ANSWERED, keyed by the step that called it.
   *
   * The other half of a pass, and until `EventName.OBSERVATION` existed there
   * was no way to see it: the page could say what the agent tried and never
   * what came back, which is the half a person actually reads.
   */
  const [observations, setObservations] = useState({})
  // Bumped when a turn finishes. The workspace is the one thing on this page a
  // turn can change behind the reader's back, so this is what tells the file
  // view to look again — a trigger, not a value anything reads.
  const [turnsDone, setTurnsDone] = useState(0)
  // Every prompt this turn sent, in order. A ReAct run is several calls, so one
  // slot would show the last one and quietly hide the rest.
  const [prompts, setPrompts] = useState([])
  const [usage, setUsage] = useState(null)
  /**
   * The sub-agents working right now, keyed by name.
   *
   * A map and not one slot: calls written on ONE line run at the same time, so
   * two delegations are two threads reporting at once, and a single slot showed
   * whichever reported last while claiming to be the state of the run.
   */
  const [delegates, setDelegates] = useState({})
  const [elapsed, setElapsed] = useState(0)
  /**
   * The user pressed stop, and the turn has not finished reacting to it yet.
   *
   * Kept because a stopped run comes back SUCCESSFUL with no assistant message
   * — which is correct, and left nothing whatsoever on screen.
   */
  const [stopping, setStopping] = useState(false)
  // Which section of the drawer is showing, and whether the drawer is open at
  // all. Two slots and not one, so closing it and reopening it returns a person
  // to what they were reading.
  const [drawer, setDrawer] = useState(false)
  const [section, setSection] = useState('run')
  const [promptAt, setPromptAt] = useState(0)
  /**
   * Whether the model this app was told to call actually answers.
   *
   * `ready` has always meant "the app started", and a first visit reads it as
   * "ask me something" — then meets a transport failure, because there is no
   * model until somebody names one.
   */
  const [modelHealth, setModelHealth] = useState(null)
  /** Work handed to another agent that no turn is waiting for. */
  const [tasks, setTasks] = useState([])
  /** What is scheduled, so the drawer can list it. */
  const [schedules, setSchedules] = useState([])
  /**
   * Whether THIS tab is the one that may write to the open conversation.
   *
   * `null` until the question has been asked, so "still deciding" and "another
   * tab has it" are different things on screen.
   */
  const [writer, setWriter] = useState(null)
  const [listening, setListening] = useState(false)
  const [level, setLevel] = useState(0)
  const [download, setDownload] = useState(null)
  const [speaking, setSpeaking] = useState('')
  const [copied, setCopied] = useState('')
  /**
   * Whether this machine has a network, and how much room this origin has.
   *
   * Both are facts nothing else on this page can see, and both change what a
   * person should do: a remote model cannot answer offline, and a browser that
   * is nearly full starts evicting the conversations and the downloaded weights
   * this app keeps.
   */
  const [online, setOnline] = useState(true)
  const [storage, setStorage] = useState(null)
  /**
   * The question whose turn failed, kept so it can be sent again.
   *
   * Measured: a first visit types a question, the turn fails because no model
   * is configured, the person fixes the settings — and the error silently
   * vanishes while the question sits in the transcript with no reply, no error
   * and no way to retry. The transcript then reads as though the assistant
   * ignored them.
   */
  const [failed, setFailed] = useState(null)
  const dictationRef = useRef(null)
  const voiceRef = useRef(null)

  useEffect(() => {
    // Spawned in an effect, not at module scope: this component is executed in
    // Node during the static prerender, where Worker does not exist.
    const client = BackendClient.spawn()
    clientRef.current = client

    client.ready().then(async (boot) => {
      if (!boot.ok) {
        setProblem({ message: 'The backend did not start.', hint: 'Reload the page.' })
        return
      }
      const collected = [...boot.notes]
      if (!boot.persistent)
        collected.push('Storage is unavailable — this conversation ends with the tab.')

      const [existing, loaded, roster, model] = await Promise.all([
        client.call('conversations.list'),
        client.call('settings.get'),
        client.call('agents.list'),
        // Whether a question can be answered at all, asked once at boot. Every
        // other boot note is about THIS app — storage, the worker, the machine
        // in the tab — and the app can be perfectly ready while the model it
        // was told to call is not there, which is what a first visit hits.
        client.call('health.model'),
      ])
      collected.push(...existing.notes, ...loaded.notes, ...roster.notes)
      if (loaded.ok) setSettings(loaded.value)
      if (roster.ok) setAgents(roster.value)
      if (model.ok) setModelHealth(model.value)
      const planned = await client.call('schedules.list')
      if (planned.ok) setSchedules(planned.value)

      const listed = existing.ok ? existing.value : []
      setConversations(listed)
      let conversation = listed[0] ?? null
      if (!conversation) {
        const made = await client.call('conversations.create', { title: 'Chat' })
        collected.push(...made.notes)
        conversation = made.ok ? made.value : null
        if (conversation) setConversations([conversation])
      }
      if (conversation) {
        setConversationId(conversation.id)
        setMessages(conversation.messages ?? [])
      }
      setNotes(collected)
      setReady(true)
    })

    return () => client.terminate()
  }, [])

  // Follow the conversation as it grows, including while a reply is pending.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll-on-change
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  /**
   * How much of the window the on-screen keyboard is covering.
   *
   * The composer sits against the bottom edge and the layout viewport does not
   * move when a phone's keyboard opens, so without this the field being typed
   * into is underneath the keyboard. It is handed to the stylesheet as a
   * variable rather than to a component, because the padding it changes belongs
   * to the dock and nothing renders differently.
   */
  useEffect(() => {
    return keyboardInset((px) => {
      document.documentElement.style.setProperty('--keyboard', `${px}px`)
    })
  }, [])

  /** The network, reported at once and on every change. */
  useEffect(() => watchOnline(setOnline), [])

  /**
   * How much room this origin has, re-measured after every turn.
   *
   * After a turn, because a turn is what fills it: a written file, a downloaded
   * model, another conversation. Measured rather than guessed — a browser that
   * will not answer says so, and the drawer shows nothing rather than a zero.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `turnsDone` is the trigger, not a value the body reads
  useEffect(() => {
    if (!ready) return
    room().then((measured) => setStorage(measured.ok ? measured : null))
  }, [ready, turnsDone])

  /**
   * Whether a turn is running, readable from inside a timer.
   *
   * The scheduler's interval closes over the state at the moment it was
   * created; reading `busy` there would read whatever it was when the effect
   * last ran, and a schedule would start a second turn on top of a live one.
   */
  const writerRef = useRef(null)
  writerRef.current = writer

  const busyRef = useRef(false)
  useEffect(() => {
    busyRef.current = busy
  }, [busy])

  /**
   * The turn function, reachable from the timer.
   *
   * `ask` is a new function on every render, so naming it as a dependency would
   * tear down and rebuild the scheduler's interval on every keystroke — and a
   * timer that restarts constantly is a timer that never fires.
   */
  const askRef = useRef(null)
  askRef.current = ask

  /**
   * One writer per conversation, elected with a Web Lock.
   *
   * Two tabs open the same transcript by construction — this page opens the
   * first conversation it lists — and each worker's append queue only
   * serialises its own realm. So a scheduled turn in one tab while the other is
   * being typed in is last-write-wins over the record, and the half that loses
   * leaves nothing behind saying it existed.
   *
   * The lock is held by a promise that NEVER SETTLES on its own. That is the
   * whole mechanism and it is easy to get wrong in the direction that looks
   * fine: `navigator.locks` releases when the callback's promise settles, not
   * when the tab closes, so a callback that returns — or an `async` one with
   * nothing to await — holds the lock for a microtask and hands it to everyone.
   * The resolver is kept and called by the cleanup below; a tab that crashes or
   * is closed releases it the way locks are meant to be released, by going
   * away.
   *
   * The request does NOT pass `ifAvailable`. A second tab QUEUES, and becomes
   * the writer the moment the first one lets go — which is what a person
   * expects when they close the tab they were typing in. `ifAvailable` would
   * answer "no" once and leave the second tab read-only until it was reloaded.
   */
  useEffect(() => {
    if (!ready || !conversationId) return undefined
    const locks = globalThis.navigator?.locks
    if (!locks?.request) {
      // No Web Locks. One tab is still correct and two would interleave, which
      // is exactly the state this app was in before this effect existed.
      setWriter(true)
      return undefined
    }

    const name = `askk-conversation:${conversationId}`
    let controller = new AbortController()
    let release = null
    let won = false

    /** Hold it, and keep holding it until this tab lets go. */
    const hold = () => {
      won = true
      setWriter(true)
      return new Promise((resolve) => {
        release = resolve
      })
    }

    /**
     * Ask, and find out which of the two answers this tab got.
     *
     * TWO requests, and the first one is why there is no timer here. A queued
     * request alone cannot tell "granted in a microtask because nobody else
     * wanted it" from "waiting behind another tab", so a page that only ever
     * learns it WON leaves a losing tab sitting at `null` — believing it may
     * write, which is the whole thing this election exists to prevent and
     * exactly what shipped in the first draft of it.
     *
     * No `signal` on the first request: Web Locks REFUSES `ifAvailable`
     * together with an abort signal and rejects the call outright. That
     * rejection landed in the catch below, left `writer` at `null` forever, and
     * took the scheduler — which is gated on this election — down with it in
     * every tab.
     */
    const elect = () => {
      setWriter(null)
      won = false
      locks
        .request(name, { ifAvailable: true }, (held) => (held ? hold() : undefined))
        .then(() => {
          if (won || controller.signal.aborted) return
          setWriter(false)
          // Queued, deliberately without `ifAvailable`: this is the request
          // that makes a reader tab become the writer when the tab holding it
          // goes away, with no reload and nothing to poll.
          return locks.request(name, { signal: controller.signal }, hold)
        })
        .catch(() => {
          // An aborted request is the ordinary way this ends — the conversation
          // changed, or the page went away, while still queued behind another
          // tab. It is not a fault and there is nobody to tell.
        })
    }

    const letGo = () => {
      controller.abort()
      release?.()
      release = null
      won = false
      setWriter(null)
    }

    /**
     * A page in the back/forward cache is still holding the lock.
     *
     * Measured, and it is the reason this pair of listeners exists rather than
     * a tidiness argument: with the holder navigated away to another URL, the
     * second tab sat at `reader` with the lock still recorded as held by the
     * first tab's client id, and it stayed that way. A person who navigates
     * away rather than closing the tab would have left their other tab
     * read-only with nothing on screen explaining why and no way to fix it
     * except a reload.
     *
     * `pagehide` is the last thing that runs before a document is frozen, and
     * `pageshow` with `persisted` is how it comes back. Releasing there is what
     * every long-held web lock has to do; nothing else in this tree holds one
     * long enough for it to matter.
     */
    const onHide = () => letGo()
    const onShow = (event) => {
      if (!event.persisted) return
      controller = new AbortController()
      elect()
    }

    globalThis.addEventListener('pagehide', onHide)
    globalThis.addEventListener('pageshow', onShow)
    elect()

    return () => {
      globalThis.removeEventListener('pagehide', onHide)
      globalThis.removeEventListener('pageshow', onShow)
      letGo()
    }
  }, [ready, conversationId])

  /**
   * The scheduler: look for a question that has come due, and ask it.
   *
   * Only in the tab that won the conversation above, which is the whole of the
   * multi-tab story and is no longer a second lock. This ticked under its own
   * `askk-schedule` lease for one wave, and that lease was both too weak and
   * too strong: too weak because it guarded the scheduled turn and not the
   * transcript the turn appends to, and too strong because it is one lock for
   * the whole app, so two tabs on DIFFERENT conversations took turns to ask
   * questions that could not possibly have collided.
   *
   * A schedule runs in the conversation it was made in, and only while that
   * conversation is open. The alternative — sending into a transcript that is
   * not on screen — is a turn a person cannot see happening, in an app whose
   * whole live view is what makes a run legible.
   */
  useEffect(() => {
    if (!ready || !conversationId || !writer) return undefined
    let stopped = false

    const runOne = async () => {
      if (stopped || busyRef.current) return
      const due = await clientRef.current.call('schedules.due', { now: Date.now() })
      if (!due.ok) return
      const mine = due.value.filter((one) => one.conversationId === conversationId)
      if (!mine.length) return

      // ONE per tick, and the most overdue first. A tab that has been closed
      // for a week must not open into every missed question at once.
      const next = mine[0]

      // Checked AGAIN, here, and this is a race rather than belt and braces:
      // three awaits have passed since the check at the top of this function,
      // and a person can press send in any of them. `ask` has no guard of its
      // own guard against a ref and `send` reads React state, so without this
      // line two `chat.send` calls could run at once in one conversation and
      // their appends interleave.
      if (stopped || busyRef.current) return

      // Recorded BEFORE the turn, not after: a question that takes four minutes
      // would otherwise still be due at the next tick and be asked again on top
      // of itself. A run that fails is a run that happened.
      //
      // And the outcome is READ. `ran` answers NOT_FOUND for a schedule that
      // was removed while this tick was deciding, and asking it anyway would be
      // this page running a question the person deleted.
      const recorded = await clientRef.current.call('schedules.ran', {
        id: next.id,
        at: Date.now(),
      })
      const listed = await clientRef.current.call('schedules.list')
      if (listed.ok && !stopped) setSchedules(listed.value)
      if (!recorded.ok) return

      // NOT guarded by `stopped` any more. The cleanup runs when the
      // conversation changes, and a schedule already marked as run that is then
      // skipped loses a whole period in silence.
      //
      // The conversation is named explicitly rather than taken from the
      // closure: `askRef` holds the LATEST `ask`, whose default is whatever
      // conversation is open now, so a schedule that survived a switch would
      // otherwise ask its question in the wrong transcript.
      await askRef.current?.(next.text, next.conversationId)
    }

    const tick = async () => {
      if (stopped) return
      await runOne()
    }

    const timer = setInterval(tick, TICK_MS)
    tick()
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [ready, conversationId, writer])

  /**
   * Watch handed-over work, and SAY when it finishes.
   *
   * The assistant answers "I have started the researcher on that" and then,
   * without this, nothing else ever happens: the answer waits for the next
   * message the person sends, and a helper you have to remember to ask about is
   * a helper you assume dropped your question.
   */
  useEffect(() => {
    if (!ready) return undefined
    if (!tasks.some((task) => task.state === 'running')) return undefined
    let stopped = false

    const look = async () => {
      const handed = await clientRef.current.call('agents.tasks')
      if (stopped || !handed.ok) return
      const before = new Map(tasks.map((task) => [task.id, task.state]))
      const finished = handed.value.filter(
        (task) =>
          task.owner === conversationId &&
          task.state !== 'running' &&
          before.get(task.id) === 'running',
      )
      setTasks(handed.value)
      for (const task of finished) {
        const said =
          task.state === 'failed'
            ? `${task.agent} could not finish what you handed over.`
            : `${task.agent} has finished. Send anything and it will read the answer back to you.`
        setNotes((current) => (current.includes(said) ? current : [...current, said]))
        // And in the operating system, when the tab is not the one being
        // looked at. `announce` says nothing when the page is visible and
        // never asks for permission on its own — a permission dialog that
        // appears because a background task finished is one nobody asked for.
        announce({ title: `${task.agent} has finished`, body: said })
      }
    }

    const timer = setInterval(look, 3000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [ready, tasks, conversationId])

  // One interval for the whole turn, torn down when it ends. `busy` is the only
  // dependency: a timer that outlives the run it is timing is a clock counting
  // up on a finished answer.
  useEffect(() => {
    if (!busy) return undefined
    const started = Date.now()
    setElapsed(0)
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(tick)
  }, [busy])

  /**
   * Keep the screen on while a turn is running.
   *
   * A turn here can be minutes — a 50 MB Linux machine arriving, a model
   * downloading into the tab, a second agent reading pages — and a phone that
   * sleeps mid-run suspends the timers the run is made of. Taken for the length
   * of the turn and released with it, never held while nothing is happening.
   */
  useEffect(() => {
    if (!busy) return undefined
    let release = null
    let dropped = false
    keepAwake().then((held) => {
      if (dropped) held.release()
      else release = held.release
    })
    return () => {
      dropped = true
      release?.()
    }
  }, [busy])

  /**
   * Which agent is answering, and everything it declares.
   *
   * `agents.get` has existed since `AgentService` was written and had no
   * callers: an agent's tools, its budget and the programs it connects to were
   * invisible in the running app.
   */
  useEffect(() => {
    if (!ready || !settings?.agent) return
    clientRef.current?.call('agents.get', { name: settings.agent }).then((found) => {
      if (found.ok) setAgentSpec(found.value)
    })
  }, [ready, settings?.agent])

  async function send() {
    const text = draft.trim()
    if ((!text && !attachments.length) || busy || !conversationId) return
    const sending = attachments.map((one) => one.url)
    setDraft('')
    setAttachments([])
    await ask(text, conversationId, sending)
  }

  /**
   * One turn, from wherever the question came from.
   *
   * Split out of `send` so a schedule can use it. That is the whole of what
   * makes a scheduled question the same thing as a typed one: same route, same
   * conversation, same streaming, same transcript.
   */
  async function ask(text, into = conversationId, files = []) {
    // The guard belongs here as well as at the two call sites, because this is
    // the function that starts a turn and a second turn started on top of a
    // live one interleaves two transcripts.
    if (busyRef.current || !into) return
    // And the same argument one realm out: a turn appends to a record another
    // tab may be appending to.
    if (writerRef.current === false) return
    setProblem(null)
    setFailed(null)
    setBusy(true)
    setStopping(false)
    const startedAt = Date.now()
    setRun({ raw: '', reasoning: '', steps: [], at: startedAt, ms: 0 })
    setObservations({})
    setPrompts([])
    setPromptAt(0)
    setUsage(null)
    // Shown immediately rather than after the round trip. The backend has
    // already been told to persist it first, so this is not an optimistic lie.
    setMessages((current) => [
      ...current,
      { id: `local-${Date.now()}`, role: 'user', text, attachments: files },
    ])

    let startedAtStep = startedAt
    const turn = clientRef.current.begin(
      'chat.send',
      { id: into, text, attachments: files },
      (name, data) => {
        if (name === EventName.PROMPT) {
          setPrompts((current) => [...current, data])
          // Follow the run: a panel pinned to step 1 while step 4 is being sent
          // is showing history, not what is happening.
          setPromptAt(data.step - 1)
          return
        }
        if (name === EventName.DELTA) {
          // The first token is proof the model is up, so it is also what
          // retires the download bar — a cached model reports a start and then
          // nothing at all.
          setDownload(null)
          // Two channels, kept apart. A thinking model can emit pages of
          // scratchpad before its first word of answer.
          const field = data.kind === 'reasoning' ? 'reasoning' : 'raw'
          setRun((current) => ({ ...current, [field]: current[field] + data.chunk }))
          return
        }
        if (name === EventName.USAGE) {
          setUsage(data)
          return
        }
        if (name === EventName.PROGRESS) {
          // Weights arriving for a model that runs in this tab, or the Linux
          // machine arriving for the first command. The same bar for both,
          // because it is the same fact: a first load is minutes of a file, and
          // an app that says nothing for minutes is indistinguishable from one
          // that has hung.
          setDownload(data)
          return
        }
        if (name === EventName.DELEGATE) {
          setDelegates((current) => ({ ...current, [data.agent]: data }))
          return
        }
        if (name === EventName.OBSERVATION) {
          // What the tool answered, against the step that called it. The clock
          // is this realm's: the engine reports what happened, not how long the
          // page had been waiting to hear it.
          const took = Date.now() - startedAtStep
          startedAtStep = Date.now()
          setObservations((current) => ({ ...current, [data.step]: { ...data, ms: took } }))
          return
        }
        if (name === EventName.STEP) {
          startedAtStep = Date.now()
          // The raw text is dropped here on purpose. It has just been parsed,
          // and showing both the contract and the answer it contains is how a
          // reader ends up reading the scaffolding.
          setRun((current) => ({
            ...current,
            raw: '',
            reasoning: '',
            steps: [...current.steps, data],
          }))
        }
      },
    )
    setRunning(turn.id)
    const result = await turn.done
    // A stopped run answers ok with no assistant message, and said nothing at
    // all about it. The sentence is written here rather than in the backend
    // because only this realm knows the stop came from a person.
    const ended =
      stopping && !result.value?.assistant
        ? [
            'stopped — the turn ended where it was, and nothing was added to the conversation',
            ...result.notes,
          ]
        : result.notes
    setNotes(ended)
    const spawned = await clientRef.current.call('agents.threads')
    if (spawned.ok) setThreads(spawned.value)
    const handed = await clientRef.current.call('agents.tasks')
    if (handed.ok) setTasks(handed.value)
    if (result.ok) {
      // `.filter(Boolean)` is not tidiness here. A stopped run answers ok with
      // no assistant message at all, and this is what keeps the transcript
      // exactly as it was rather than growing an empty turn.
      setMessages((current) => [...current, result.value.assistant].filter(Boolean))
      // Not awaited. Reading a reply aloud takes as long as the reply is long.
      if (settings?.speakReplies && result.value.assistant?.text) say(result.value.assistant.text)
    } else {
      // The turn failed, and the question is HELD so it can be sent again. The
      // user's message was saved before the model was called, so without this
      // the transcript reads as though the assistant simply ignored them.
      setProblem({ message: result.error.message, hint: result.error.hint })
      setFailed({ text, files })
    }
    setRun((current) => ({ ...current, raw: '', reasoning: '', ms: Date.now() - current.at }))
    setDelegates({})
    setDownload(null)
    // After the steps, so a file view that reloads on this reads a workspace the
    // turn has finished writing to.
    setTurnsDone((count) => count + 1)
    setRunning(null)
    setBusy(false)
  }

  /**
   * Start or end a dictation.
   *
   * The partial goes straight into the composer rather than into a preview of
   * its own: the point of dictating is to send the words. It is still shown
   * separately while listening, because the partial is REVISED — words already
   * typed change as more audio arrives.
   */
  async function dictate() {
    if (listening) {
      setListening(false)
      const done = await dictationRef.current?.stop()
      dictationRef.current = null
      setDownload(null)
      setLevel(0)
      if (done?.text) setDraft(done.text)
      if (done && !done.ok) setProblem({ message: done.error.message, hint: done.error.hint })
      if (done?.notes?.length) setNotes(done.notes)
      return
    }

    const dictation = new Dictation(settings ?? {})
    dictation.onPartial = (text) => {
      setDownload(null)
      setDraft(text)
      // A partial arriving is the only proof this page has that the microphone
      // is live, so it is what moves the meter. A level driven by the audio
      // thread would be truer and would cost a message per block.
      setLevel(0.35 + Math.random() * 0.4)
    }
    dictation.onProgress = (progress) => setDownload(progress)
    dictation.onEnded = (result) => {
      setListening(false)
      setDownload(null)
      setLevel(0)
      dictationRef.current = null
      if (!result.ok) setProblem({ message: result.error.message, hint: result.error.hint })
    }
    dictationRef.current = dictation

    setProblem(null)
    setListening(true)
    const started = await dictation.start()
    if (started.notes?.length) setNotes(started.notes)
    if (!started.ok) {
      setListening(false)
      dictationRef.current = null
      setProblem({ message: started.error.message, hint: started.error.hint })
      return
    }
    setDownload(null)
  }

  /**
   * Read a reply aloud, or stop reading it.
   *
   * One voice object for the tab, not one per message. `Voice.stop` has existed
   * since the class was written and had no caller anywhere: a long reply, once
   * started, could not be interrupted, and the control said "speaking…" while
   * doing nothing at all.
   */
  async function say(text) {
    if (!voiceRef.current) voiceRef.current = new Voice(settings ?? {})
    voiceRef.current.settings = settings ?? {}
    if (speaking === text) {
      await voiceRef.current.stop()
      setSpeaking('')
      return
    }
    if (speaking) await voiceRef.current.stop()
    voiceRef.current.onProgress = (progress) => setDownload(progress)
    setSpeaking(text)
    const spoken = await voiceRef.current.say(text)
    setSpeaking('')
    setDownload(null)
    if (spoken.notes?.length) setNotes(spoken.notes)
    if (!spoken.ok) setProblem({ message: spoken.error.message, hint: spoken.error.hint })
  }

  /**
   * Hand a reply to whatever this device shares with.
   *
   * Only offered where there IS something to share with — `navigator.share` is
   * on Safari and on Android and not on desktop Firefox — so the control is
   * absent rather than dead. A share the person cancelled says nothing: closing
   * the sheet is a decision, not a fault.
   */
  const hand = useCallback(async (text) => {
    const sent = await share({ title: 'ASKK', text })
    if (!sent.ok && sent.note) {
      setNotes((current) => (current.includes(sent.note) ? current : [...current, sent.note]))
    }
  }, [])

  const remember = useCallback(async (text) => {
    const done = await copy(text)
    if (done.ok) {
      setCopied(text)
      setTimeout(() => setCopied(''), 1400)
    } else if (done.note) {
      setNotes((current) => (current.includes(done.note) ? current : [...current, done.note]))
    }
  }, [])

  async function saveSettings(event) {
    event.preventDefault()
    setProblem(null)
    const result = await clientRef.current.call('settings.save', settings)
    setNotes(result.notes)
    if (!result.ok) {
      setProblem({ message: result.error.message, hint: result.error.hint })
      return
    }
    // Whatever came back is authoritative — the backend may have corrected a
    // field, and the form must show what was actually kept.
    setSettings(result.value)
    setShowSettings(false)
    // Asked again, because the reason to open settings was usually this.
    const rechecked = await clientRef.current.call('health.model')
    if (rechecked.ok) setModelHealth(rechecked.value)
    // Notifications are asked for HERE, after a deliberate save, and never from
    // a background task finishing. This is the one moment a person is looking
    // at the app and has just told it what to do.
    if (globalThis.Notification?.permission === 'default') askToAnnounce()
  }

  /** Check the address before leaving the form, not four actions later. */
  async function testConnection() {
    setTesting(true)
    // Cleared first, so what is on screen while the check runs is the check
    // running and not the previous answer. A stale "✓ answered" beside a
    // freshly typed address is the form agreeing with something nobody asked.
    setModelHealth(null)
    const saved = await clientRef.current.call('settings.save', settings)
    if (saved.ok) setSettings(saved.value)
    const found = await clientRef.current.call('health.model')
    if (found.ok) setModelHealth(found.value)
    setTesting(false)
  }

  async function addSchedule({ text, everySeconds, atMinutes }) {
    const made = await clientRef.current.call('schedules.create', {
      text,
      everySeconds,
      atMinutes,
      conversationId,
    })
    setNotes(made.notes)
    if (!made.ok) {
      setProblem({ message: made.error.message, hint: made.error.hint })
      return
    }
    const listed = await clientRef.current.call('schedules.list')
    if (listed.ok) setSchedules(listed.value)
  }

  async function removeSchedule(id) {
    const gone = await clientRef.current.call('schedules.remove', { id })
    setNotes(gone.notes)
    const listed = await clientRef.current.call('schedules.list')
    if (listed.ok) setSchedules(listed.value)
  }

  async function openConversation(id) {
    const found = await clientRef.current.call('conversations.get', { id })
    if (!found.ok) {
      setProblem({ message: found.error.message, hint: found.error.hint })
      return
    }
    setConversationId(id)
    setMessages(found.value.messages ?? [])
    setRun({ raw: '', reasoning: '', steps: [], at: 0, ms: 0 })
    setObservations({})
    setProblem(null)
    setFailed(null)
  }

  async function newChat() {
    const result = await clientRef.current.call('conversations.create', { title: 'Chat' })
    setNotes(result.notes)
    if (!result.ok) {
      setProblem({ message: result.error.message, hint: result.error.hint })
      return
    }
    setConversations((current) => [result.value, ...current])
    setConversationId(result.value.id)
    setMessages([])
    setProblem(null)
    setFailed(null)
  }

  async function renameConversation(one) {
    const title = globalThis.prompt?.('What should this conversation be called?', one.title ?? '')
    if (title === null || title === undefined) return
    const done = await clientRef.current.call('conversations.rename', { id: one.id, title })
    setNotes(done.notes)
    if (done.ok)
      setConversations((current) =>
        current.map((row) => (row.id === one.id ? { ...row, title: done.value.title } : row)),
      )
  }

  /**
   * Delete a conversation, having said what is being deleted.
   *
   * The control this replaces was called `new`, sat at the most-hit position in
   * the toolbar, destroyed the open conversation with no confirmation and left
   * no way back to it — a reviewer lost six messages to it, and a schedule made
   * in that conversation outlived it, pointed at a transcript nobody could
   * open.
   */
  async function removeConversation(one) {
    const count = one.id === conversationId ? messages.length : (one.messages?.length ?? 0)
    const said = count
      ? `Delete “${one.title || 'Chat'}” and its ${count} message${count === 1 ? '' : 's'}? This cannot be undone.`
      : `Delete “${one.title || 'Chat'}”?`
    if (!globalThis.confirm?.(said)) return

    const gone = await clientRef.current.call('conversations.remove', { id: one.id })
    setNotes(gone.notes)
    if (!gone.ok) {
      setProblem({ message: gone.error.message, hint: gone.error.hint })
      return
    }
    // A schedule that fired into the deleted conversation can no longer reach
    // anyone, so it goes with it rather than surviving as a promise nothing can
    // keep.
    for (const plan of schedules.filter((row) => row.conversationId === one.id)) {
      await clientRef.current.call('schedules.remove', { id: plan.id })
    }
    const listed = await clientRef.current.call('conversations.list')
    const rows = listed.ok ? listed.value : []
    setConversations(rows)
    const plans = await clientRef.current.call('schedules.list')
    if (plans.ok) setSchedules(plans.value)
    if (one.id === conversationId) {
      if (rows[0]) await openConversation(rows[0].id)
      else await newChat()
    }
  }

  /** A file the person chose, read into the data URL the model can be sent. */
  async function take(files) {
    const read = await Promise.all(
      files.slice(0, 4).map(
        (file) =>
          new Promise((resolve) => {
            const reader = new FileReader()
            reader.onload = () => resolve({ name: file.name, url: String(reader.result) })
            // A file that cannot be read is not an attachment and is not a
            // failed turn either. It is reported and dropped.
            reader.onerror = () => resolve(null)
            reader.readAsDataURL(file)
          }),
      ),
    )
    const kept = read.filter(Boolean)
    if (kept.length !== files.length) {
      setNotes((current) => [...current, 'some of those files could not be read and were skipped'])
    }
    setAttachments((current) => [...current, ...kept].slice(0, 4))
  }

  const shown = prompts[promptAt] ?? null
  const mine = conversationId
  const status = statusLine({
    ready,
    busy,
    stopping,
    elapsed,
    listening,
    speaking: Boolean(speaking),
    download,
    delegates: Object.values(delegates),
    tasks: tasks.filter((one) => one.owner === mine),
    agent: settings?.agent,
    online,
    // A model running in this tab needs no network, so being offline is not a
    // fault to report at somebody whose setup works.
    local: settings?.kind === 'transformers',
  })

  return (
    <div className="shell">
      <Header
        ready={ready}
        title={conversations.find((one) => one.id === conversationId)?.title}
        conversations={conversations}
        conversationId={conversationId}
        onOpen={openConversation}
        onNew={newChat}
        onRename={renameConversation}
        onRemove={removeConversation}
        status={status}
        drawerOpen={drawer}
        onDrawer={() => setDrawer((open) => !open)}
        onSettings={() => setShowSettings((open) => !open)}
        settingsOpen={showSettings}
      />

      {showSettings && settings ? (
        <Settings
          settings={settings}
          agents={agents}
          onChange={setSettings}
          onSave={saveSettings}
          onClose={() => setShowSettings(false)}
          onTest={testConnection}
          testing={testing}
          health={modelHealth}
        />
      ) : null}

      <div className={`panes${drawer ? ' docked' : ''}`}>
        <main className="stage">
          {messages.length === 0 && ready ? (
            <div className="transcript emptyframe">
              <section className="empty">
                {modelHealth && !modelHealth.reachable ? (
                  <>
                    <h2>No model yet</h2>
                    <p data-testid="no-model">{modelHealth.detail}</p>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => setShowSettings(true)}
                      data-testid="connect-model"
                    >
                      Connect a model
                    </button>
                  </>
                ) : (
                  <>
                    <h2>Ask it something</h2>
                    <p>
                      It can search the web, run commands on a Linux machine inside this tab, keep
                      files of its own, and hand a question to a second agent when the answer is
                      something to go and find out.
                    </p>
                  </>
                )}

                <ul className="examples">
                  <li className="label">Or try one of these:</li>
                  {EXAMPLES.map((one) => (
                    <li key={one.text}>
                      <button
                        type="button"
                        onClick={() => setDraft(one.text)}
                        data-testid="example"
                      >
                        {one.text}
                        <span className="why">{one.why}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          ) : (
            <Transcript
              scrollRef={scrollRef}
              messages={messages}
              busy={busy}
              run={run}
              observations={observations}
              onSay={say}
              onCopy={remember}
              onShare={hand}
              speaking={speaking}
              copied={copied}
            />
          )}

          <div className="tray">
            {download ? (
              <p className="loading" data-testid="download">
                <span className="who">{download.file || 'model'}</span>
                {/* Driven by a width, not an animation. A first load is minutes
                    of a file arriving, and an indeterminate spinner cannot tell
                    "downloading" from "hung". */}
                <span className="bar">
                  <span style={{ width: `${download.percent}%` }} />
                </span>
                {download.percent}%
              </p>
            ) : null}

            {listening ? (
              <p className="hearing" data-testid="hearing">
                <span className="who">hearing</span>
                {draft || '…'}
              </p>
            ) : null}

            {problem ? (
              <p className="problem" data-testid="error">
                {problem.message}
                {problem.hint ? <span className="hint-line">{problem.hint}</span> : null}
                {/* Every error carries its own way out. The one a first visit
                    meets used to REPLACE the empty screen, which held the only
                    link to settings there was. */}
                <span className="msg-actions" style={{ opacity: 1 }}>
                  <button type="button" onClick={() => setShowSettings(true)}>
                    open settings
                  </button>
                  {failed ? (
                    <button
                      type="button"
                      onClick={() => ask(failed.text, conversationId, failed.files)}
                      data-testid="retry"
                    >
                      try that again
                    </button>
                  ) : null}
                </span>
              </p>
            ) : null}

            {notes.length ? (
              <ul className="notes" data-testid="notes">
                {notes.map((note) => (
                  <li key={note}>
                    {note}
                    <button
                      type="button"
                      aria-label="Dismiss"
                      onClick={() => setNotes((current) => current.filter((one) => one !== note))}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <Composer
            draft={draft}
            onDraft={setDraft}
            onSend={send}
            ready={ready}
            busy={busy}
            writer={writer}
            listening={listening}
            level={level}
            onDictate={dictate}
            onStop={() => {
              setStopping(true)
              clientRef.current?.stop(running)
            }}
            attachments={attachments}
            onAttach={setAttachments}
            onDrop={take}
          />
        </main>

        {drawer ? (
          <Drawer
            section={section}
            onSection={setSection}
            onClose={() => setDrawer(false)}
            run={run}
            usage={usage}
            observations={observations}
            shown={shown}
            prompts={prompts}
            promptAt={promptAt}
            onPromptAt={setPromptAt}
            client={clientRef.current}
            turnsDone={turnsDone}
            storage={storage}
            schedules={schedules}
            conversationId={conversationId}
            ready={ready}
            onCreateSchedule={addSchedule}
            onRemoveSchedule={removeSchedule}
            agent={agentSpec}
            agentNotes={notes}
          />
        ) : null}
      </div>

      {threads.length ? <span data-testid="threads" hidden /> : null}
    </div>
  )
}
