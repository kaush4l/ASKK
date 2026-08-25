'use client'

import s from './meter.module.css'

/**
 * THE ONE CONTROL IN THIS PRODUCT THAT DOES NOT GO THROUGH THE SEAM.
 *
 * `handle` records a `request_handled` fact for every request and the body
 * rides into the projection the interface then renders, so a key crossing the
 * seam would be a key in the log and a key on the screen. `saveEndpoint` in
 * `adapters-web` is its own door, and this is the only thing that opens it —
 * `docs/SEAM.md` calls it the single documented exception to I4, and it stays
 * single because there is exactly one component here that can send one.
 *
 * WRITE-ONLY, AND THE BOX IS EMPTY EVERY TIME. Nothing reads a key back: there
 * is no function in the broker that returns one. So the field starts blank on
 * every render and blank does not mean "no key" — `keyNote` is the projection's
 * sentence about what is stored, and it is beside the field for that reason.
 *
 * @param {{note: string, disabledLabel: string,
 *          onSave?: (apiKey: string) => void}} props `disabledLabel` is why
 *   saving would do nothing — no entry picked, or nothing attached — and '' when
 *   it would do something. A disabled control with an unstated reason is the
 *   dead switch this product keeps deleting.
 */
export function KeyField({ note, disabledLabel, onSave }) {
  const refused = disabledLabel || (onSave ? '' : NOWHERE)
  return (
    <form className={s.composer} aria-label={LABEL} onSubmit={(event) => submit(event, onSave)}>
      <label className={s.promptLabel}>
        {LABEL}
        <input
          className={s.prompt} type="password" name="apiKey" autoComplete="off"
          spellCheck={false} disabled={Boolean(refused)}
        />
      </label>
      <div className={s.send}>
        <button type="submit" className={s.sendButton} disabled={Boolean(refused)}>{SAVE}</button>
      </div>
      <p className={s.headroom}>{note}</p>
      {refused ? <p className={s.refusal}>{refused}</p> : null}
    </form>
  )
}

/** A control's own name, which is not prose about a fact (I5). */
const LABEL = 'API key'
const SAVE = 'Save the key'
const NOWHERE = 'Nothing typed here is saved — this field is not attached to a running build.'

/**
 * @param {React.FormEvent<HTMLFormElement>} event
 * @param {((apiKey: string) => void) | undefined} onSave
 */
function submit(event, onSave) {
  event.preventDefault()
  const field = event.currentTarget.elements.namedItem('apiKey')
  if (!onSave || !(field instanceof HTMLInputElement)) return
  onSave(field.value)
  // Cleared whether or not the save lands: leaving a credential in a DOM node
  // is the second copy, and the projection beside it says what is stored.
  event.currentTarget.reset()
}
