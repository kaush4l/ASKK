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
 * button sat at the leftmost, largest, most-hit position in the toolbar and its
 * effect was irreversible deletion.
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
          <h1 className="wordmark" data-live={String(ready)}>
            <span className="pulse" />
            ASKK
          </h1>
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
        </div>

        {/* ONE line, present tense, in words. Everything not chosen is in the
            drawer, which is where facts live. */}
        <p className="status" data-testid="status" data-live={String(Boolean(status.live))}>
          {status.live ? <span className="status-dot" aria-hidden="true" /> : null}
          {status.text}
        </p>

        <div className="topactions">
          <button
            type="button"
            className="iconbutton"
            onClick={onDrawer}
            aria-pressed={drawerOpen}
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
                  {/* Named for what it destroys. `new` used to do this
                      silently, from the toolbar, with no list to come back to
                      and no undo — a reviewer lost six messages to it and the
                      schedule they had made in that conversation outlived it. */}
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
