'use client'

import { useEffect, useState } from 'react'
import { AgentPanel } from './AgentPanel.jsx'
import { FilesPanel } from './FilesPanel.jsx'
import { PromptPanel } from './PromptPanel.jsx'
import { RunPanel } from './RunPanel.jsx'
import { SchedulePanel } from './SchedulePanel.jsx'

/**
 * Everything the app knows about itself, behind one control.
 *
 * Five views of ONE thing, so they are a segmented control inside a drawer
 * rather than five more buttons across the top of the screen. That is what
 * takes the top-level choice from six to three, and it is also what stops a
 * reader having to guess that a button called `run` holds the reasoning trace —
 * a reviewer read that word as "execute something" and never opened it, which
 * meant the only surviving record of a tool call was somewhere they never went.
 *
 * The names are what is inside them, in the words of the thing rather than the
 * mechanism.
 */
/*
 * The order is two groups, and the first item of each is what a person reaches
 * for. `work` and `prompt` are artefacts of the turn that just happened —
 * diagnostic, replaced by the next one. `agent`, `files` and `schedule` are
 * standing facts about the workspace, true between turns.
 *
 * `agent` moved from last to second because two reviewers, independently,
 * found the sentence that explains what this whole app is talking to — "the
 * assistant this app opens with… goes and finds out when a question needs a
 * real answer rather than a recalled one" — and both found it in the fifth tab,
 * after they had already given up on working it out from the first screen.
 */
const SECTIONS = [
  { id: 'run', label: 'work' },
  { id: 'agent', label: 'agent' },
  { id: 'files', label: 'files' },
  { id: 'schedule', label: 'schedule' },
  { id: 'prompt', label: 'prompt' },
]

/**
 * What this conversation is for, in the user's own words.
 *
 * Above the run and not below it, because it is the question the run is an
 * answer to. It is also the first thing in the first section of the drawer,
 * which is the only position that makes it findable by somebody who has not
 * been told it exists.
 *
 * Saved on submit rather than on every keystroke: a goal is a sentence somebody
 * composes, and a store written once per character would put half-written
 * intentions in front of the model on any turn that landed mid-typing.
 */
function GoalField({ goal, onGoal }) {
  const [draft, setDraft] = useState(goal ?? '')
  const [saved, setSaved] = useState(false)

  // The prop wins when the conversation changes underneath this field. Without
  // it, switching conversations kept the previous one's goal in the box, which
  // is the one state where a person would press save and overwrite it.
  useEffect(() => {
    setDraft(goal ?? '')
    setSaved(false)
  }, [goal])

  return (
    <form
      className="goalform"
      onSubmit={(submit) => {
        submit.preventDefault()
        onGoal?.(draft)
        setSaved(true)
      }}
    >
      <label htmlFor="goal-text">What this conversation is for</label>
      <p className="hint">
        Restated to the agent every turn, so a long run keeps answering the thing it was started
        for. Leave it empty and nothing is added to the prompt.
      </p>
      <textarea
        id="goal-text"
        data-testid="goal-text"
        value={draft}
        rows={2}
        placeholder="e.g. get the test suite passing and keep it passing"
        onChange={(change) => {
          setDraft(change.target.value)
          setSaved(false)
        }}
      />
      <div className="goalactions">
        {/* Three states, because there were two and one of them was a lie. An
            untouched empty field offered "clear the goal" — a filled button
            proposing to undo something that had never been done. The label now
            names what pressing it would actually change, and when it would
            change nothing the control says so by being unavailable. */}
        <button type="submit" data-testid="goal-save" disabled={draft === (goal ?? '')}>
          {draft.trim() ? 'save the goal' : 'clear the goal'}
        </button>
        {saved ? (
          <span className="measured" data-testid="goal-saved">
            saved
          </span>
        ) : null}
      </div>
    </form>
  )
}

export function Drawer({
  section,
  onSection,
  onClose,
  run,
  usage,
  observations,
  shown,
  prompts,
  promptAt,
  onPromptAt,
  client,
  turnsDone,
  storage,
  schedules,
  conversationId,
  ready,
  onCreateSchedule,
  onRemoveSchedule,
  agent,
  agentNotes,
  goal,
  onGoal,
}) {
  return (
    <aside className="drawer" data-testid={`${section}-panel`} aria-label="Activity">
      <header>
        <h2>activity</h2>
        <button type="button" className="iconbutton" onClick={onClose} data-testid="drawer-close">
          <span className="glyph" aria-hidden="true">
            ✕
          </span>
          <span className="word">Close</span>
        </button>
      </header>

      <div className="segmented" role="tablist" aria-label="What to look at">
        {SECTIONS.map((one) => (
          <button
            key={one.id}
            type="button"
            role="tab"
            aria-selected={section === one.id}
            onClick={() => onSection(one.id)}
            data-testid={`${one.id}-toggle`}
          >
            {one.label}
          </button>
        ))}
      </div>

      <div className="drawer-body">
        {section === 'run' ? (
          <>
            <GoalField goal={goal} onGoal={onGoal} />
            <RunPanel run={run} usage={usage} observations={observations} />
          </>
        ) : null}
        {section === 'prompt' ? (
          <>
            {prompts.length > 1 ? (
              <div className="fileview steps" style={{ border: 0 }}>
                {prompts.map((entry, index) => (
                  <button
                    key={entry.step}
                    type="button"
                    className={index === promptAt ? 'on' : ''}
                    onClick={() => onPromptAt(index)}
                    // Two bare digits, with no label and no accessible name, was
                    // the whole of this control. Nothing on screen said they
                    // chose which pass of the run you were reading.
                    aria-label={`Show the prompt sent on step ${entry.step}`}
                  >
                    step {entry.step}
                  </button>
                ))}
              </div>
            ) : null}
            <PromptPanel shown={shown} usage={usage} />
          </>
        ) : null}
        {/* Given the client rather than the values, because the workspace is the
            backend's and a component handed a list would be showing whatever
            the page last remembered. `turnsDone` is when to look again. */}
        {section === 'files' ? (
          <FilesPanel client={client} turnsDone={turnsDone} storage={storage} />
        ) : null}
        {section === 'schedule' ? (
          <SchedulePanel
            schedules={schedules}
            conversationId={conversationId}
            ready={ready && Boolean(conversationId)}
            onCreate={onCreateSchedule}
            onRemove={onRemoveSchedule}
          />
        ) : null}
        {section === 'agent' ? <AgentPanel agent={agent} notes={agentNotes} /> : null}
      </div>
    </aside>
  )
}
