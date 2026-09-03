'use client'

import { useEffect, useState } from 'react'

/**
 * Three zones: who and where, what is happening, what you can open.
 *
 * The rail this replaces had six controls of equal weight — `new`, `settings`,
 * `prompt`, `run`, `files`, `schedule` — which is six things to choose between
 * where there are three kinds of thing, and a status area that rendered up to
 * nine chips at once. A reviewer could not tell which of the nine was the thing
 * they were waiting for, and pressed `new` expecting a control and destroyed
 * their conversation instead.
 *
 * `new` is inside the conversation menu now, beside the list of conversations
 * it is the top of. That is a Fitts argument as much as a semantic one: the old
 * button sat at the leftmost, largest, most-hit position in the toolbar, and
 * what it did was ABANDON the conversation on screen — `conversations.create`
 * and nothing else. The record survived in the store and was re-listed at the
 * next boot; there was simply no way back to it, because the app opened
 * `conversations[0]` and only that. A reviewer pressed it, lost the transcript
 * they were reading, and had no way to tell it from deletion.
 */
export function Header({
  ready,
  title,
  conversations,
  conversationId,
  onOpen,
  onNew,
  onRename,
  onRemove,
  status,
  drawerOpen,
  onDrawer,
  onSettings,
  settingsOpen,
}) {
  const [listing, setListing] = useState(false)

  /**
   * Escape closes it, like the settings sheet beside it.
   *
   * Measured otherwise: the sheet closed on Escape and this did not, so the app
   * taught a rule with one control and broke it with the next — and on a phone
   * the open menu covers the transcript, which makes "press the trigger again"
   * the only exit from a thing sitting on top of everything.
   */
  useEffect(() => {
    if (!listing) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') setListing(false)
    }
    globalThis.addEventListener('keydown', onKey)
    return () => globalThis.removeEventListener('keydown', onKey)
  }, [listing])

  return (
    <>
      <header className="topbar">
        <div className="brand">
          {/* A `p`, not the document's heading. The `h1` used to be this 13px
              wordmark while the visible title of the page — "No model yet", or
              the conversation you are in — was an `h2` under it, so a screen
              reader's outline named the product and never the screen. */}
          <p className="wordmark" data-live={String(ready)}>
            <span className="pulse" />
            ASKK
          </p>
          {/* The heading of the working view, and it is a control. A reviewer
              found the chat screen with no visible heading at all — the `h1`
              was off-screen and the largest visible text was the assistant's
              paragraph — while the one piece of text that names what you are
              looking at sat here as a plain button. */}
          <h1 className="place-heading">
            <button
              type="button"
              className="place"
              onClick={() => setListing((open) => !open)}
              aria-expanded={listing}
              aria-haspopup="menu"
              disabled={!ready}
              data-testid="place"
            >
              {title || 'Chat'}
              <span className="caret" aria-hidden="true">
                ▾
              </span>
            </button>
          </h1>
        </div>

        {/* ONE line, present tense, in words. Everything not chosen is in the
            drawer, which is where facts live. */}
        <p className="status" data-testid="status" data-live={String(Boolean(status.live))}>
          {status.live ? <span className="status-dot" aria-hidden="true" /> : null}
          {status.text}
        </p>

        <div className="topactions">
          {/* The name is on the ELEMENT and not only in the span, because the
              span is what a narrow layout hides — measured: below 62rem these
              two buttons expose no accessible name at all, and they are the
              only two routes out of the conversation. */}
          <button
            type="button"
            className="iconbutton"
            onClick={onDrawer}
            aria-pressed={drawerOpen}
            aria-label="Activity"
            title="Activity"
            disabled={!ready}
            data-testid="drawer-toggle"
          >
            <span className="glyph" aria-hidden="true">
              ▤
            </span>
            <span className="word">Activity</span>
          </button>
          <button
            type="button"
            className="iconbutton"
            onClick={onSettings}
            aria-pressed={settingsOpen}
            aria-label="Settings"
            title="Settings"
            disabled={!ready}
            data-testid="settings-toggle"
          >
            <span className="glyph" aria-hidden="true">
              ⚙
            </span>
            <span className="word">Settings</span>
          </button>
        </div>
      </header>

      {listing ? (
        <>
          {/* A transparent sheet, so a press anywhere closes the menu. Without
              one, every open menu has to own a document listener and remember
              to remove it. */}
          <button
            type="button"
            className="scrim"
            aria-label="Close the conversation list"
            onClick={() => setListing(false)}
          />
          <div className="menu" data-testid="conversations">
            <h3>conversations</h3>
            {conversations.map((one) => (
              <div
                className="menu-row"
                key={one.id}
                data-current={String(one.id === conversationId)}
              >
                <button
                  type="button"
                  onClick={() => {
                    onOpen(one.id)
                    setListing(false)
                  }}
                >
                  {one.title || 'Chat'}
                </button>
                <span className="rowact">
                  <button
                    type="button"
                    aria-label={`Rename ${one.title || 'this conversation'}`}
                    onClick={() => onRename(one)}
                  >
                    rename
                  </button>
                  {/* Named for what it destroys, which the control it
                      replaces did not do: `new` abandoned a conversation rather
                      than removing it. This one really does remove it, so it
                      says what is lost and takes the schedules that pointed at
                      it with it. */}
                  <button
                    type="button"
                    aria-label={`Delete ${one.title || 'this conversation'}`}
                    onClick={() => onRemove(one)}
                    data-testid={`delete-${one.id}`}
                  >
                    delete
                  </button>
                </span>
              </div>
            ))}
            <button
              type="button"
              className="menu-new"
              onClick={() => {
                onNew()
                setListing(false)
              }}
              data-testid="new-chat"
            >
              + New conversation
            </button>
          </div>
        </>
      ) : null}
    </>
  )
}
