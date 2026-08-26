'use client'

import { Panel } from '@/components/ui/panel'
import { useSignal } from '@/components/shell/use-signal'
import { DIRECTIONS, ROOMS, chooseDirection, chooseRoom, direction, room } from '@/lib/appearance'
import s from '@/components/views/views.module.css'

/** What each room is called where a person is choosing between them. */
const ROOM_NAME = { light: 'Light', dark: 'Dark' }

/**
 * WHAT THIS SCREEN LOOKS LIKE — the only control on this page that changes
 * nothing about the system it is looking at.
 *
 * It is in Setup and not behind a gear because a direction is a decision, not a
 * preference: it moves type, space, corners and the whole palette, and a person
 * who has one wants it before they have an endpoint. It writes to
 * `localStorage` and never to the log (I2), which is why it does not go through
 * the seam and why it is the second control on this page that does not — the
 * first being the credential broker, for the opposite reason.
 *
 * TWO RADIO GROUPS AND NOT TOGGLES: within each, exactly one is true at a time,
 * and `aria-checked` on a `radiogroup` is the one thing that says so to a
 * screen reader without it having to press anything to find out.
 */
export function Appearance() {
  const here = useSignal(direction)
  const lit = useSignal(room)
  return (
    <Panel caption="What this screen looks like">
      <p className={s.meta}>
        Four directions plus the page as it ships. They change what this product
        looks and feels like — never what anything does. Switching is immediate
        and this device remembers.
      </p>
      <Choices label="Direction" current={here} options={DIRECTIONS} onPick={chooseDirection} />
      <Choices label="Room" current={lit} onPick={chooseRoom}
        options={ROOMS.map((name) => ({ slug: name, name: ROOM_NAME[/** @type {'light'|'dark'} */ (name)], what: '' }))} />
      {/* THE ROOM IS NOT A LIE UNDER THE OTHER FOUR, AND IT SAYS SO. Each of
          the four declares its own `color-scheme` and its whole palette, so the
          switch above changes nothing while one is chosen. A control that
          appears to do something and does not is the defect this project keeps
          finding; the honest fix is a sentence, not a disabled button with no
          reason given. */}
      {here ? <p className={s.meta}>The room applies to the page as it ships. {DIRECTIONS.find((d) => d.slug === here)?.name} brings its own light.</p> : null}
    </Panel>
  )
}

/**
 * ONE MUTUALLY EXCLUSIVE SET. A `radiogroup` and not a row of toggles: exactly
 * one is true at a time, and `aria-checked` inside one is what says so to a
 * screen reader without it having to press anything to find out.
 * @param {{label: string, current: string, onPick: (slug: string) => void,
 *          options: ReadonlyArray<{slug: string, name: string, what: string}>}} props
 */
function Choices({ label, current, options, onPick }) {
  return (
    <ul className={s.rows} role="radiogroup" aria-label={label}>
      {options.map((choice) => (
        <li key={choice.slug || 'shipped'} className={s.row} data-status={choice.slug === current ? 'ok' : 'idle'}>
          <button
            type="button" className={s.pick} role="radio"
            aria-checked={choice.slug === current}
            onClick={() => onPick(choice.slug)}
          >
            {choice.name}
          </button>
          {choice.what ? <span className={s.meta}>{choice.what}</span> : null}
        </li>
      ))}
    </ul>
  )
}
