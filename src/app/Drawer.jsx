'use client'

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
export const SECTIONS = [
  { id: 'run', label: 'work' },
  { id: 'prompt', label: 'prompt' },
  { id: 'files', label: 'files' },
  { id: 'schedule', label: 'schedule' },
  { id: 'agent', label: 'agent' },
]

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
          <RunPanel run={run} usage={usage} observations={observations} />
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
