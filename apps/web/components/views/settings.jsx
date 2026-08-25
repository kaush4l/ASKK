'use client'

import { Empty } from '@/components/ui/empty'
import { KeyField } from '@/components/ui/keyfield'
import { Panel } from '@/components/ui/panel'
import s from './views.module.css'

/**
 * @typedef {object} Entry one catalogue entry, as the broker reads it.
 * @property {string} id
 * @property {string} name
 * @property {string} model     the id that goes on the wire
 * @property {string} baseUrl   where it goes
 * @property {boolean} hasKey   WHETHER a key is set, never the key (I6)
 * @property {string} keyLabel  that same fact in words
 * @property {boolean} selected whether every call goes here
 */

/**
 * @typedef {object} SettingsData
 * @property {string} selected     which entry is in force, '' when none is
 * @property {ReadonlyArray<Entry>} entries
 * @property {string} modelLabel   what the pick means for every agent's calls
 * @property {string} searchLabel  where a web search goes
 * @property {string} storeLabel   whether this browser is keeping anything
 * @property {string} keyNote      what happens to a key that is saved here
 */

/**
 * THE ENDPOINT CATALOGUE, WHAT IT RESOLVES TO, AND WHETHER A KEY IS SET
 * (`GET /settings`).
 *
 * SAVING A KEY DOES NOT GO THROUGH THE SEAM and picking an entry does. That
 * asymmetry is the whole design of this screen: `POST /settings` carries every
 * setting EXCEPT the credential, because every request is recorded as a fact,
 * and the broker's own door carries the credential and nothing else
 * (docs/SEAM.md, the one stated exception to I4).
 *
 * @param {{data: SettingsData, onSelect?: (entry: string) => void,
 *          onSaveKey?: (apiKey: string) => void}} props both absent in the
 *   gallery, where there is no build behind the screen; each control says so
 *   for itself rather than sitting disabled with no reason given.
 */
export function Settings({ data, onSelect, onSaveKey }) {
  return (
    <div className={s.stack}>
      <Panel caption="Where turns are sent">
        <p className={s.meta}>{data.modelLabel}</p>
        {data.entries.length === 0 ? <Empty note={NO_ENTRIES} /> : (
          <ul className={s.rows}>
            {data.entries.map((entry) => (
              <li key={entry.id} className={s.row} data-status={entry.selected ? 'ok' : 'idle'}>
                <button
                  type="button" className={s.pick} disabled={!onSelect}
                  aria-pressed={entry.selected}
                  onClick={() => onSelect?.(entry.id)}
                >
                  {entry.name}
                </button>
                <span className={s.machine}>{entry.model}</span>
                <span className={s.machine}>{entry.baseUrl}</span>
                <span className={s.meta}>{entry.keyLabel}</span>
              </li>
            ))}
          </ul>
        )}
        {onSelect ? null : <p className={s.meta}>{UNPICKABLE}</p>}
      </Panel>
      <Panel caption="The key for the endpoint in force">
        <KeyField note={data.keyNote} disabledLabel={data.selected ? '' : NOTHING_PICKED} onSave={onSaveKey} />
      </Panel>
      <Panel caption="What else this browser holds">
        <p className={s.meta}>{data.searchLabel}</p>
        <p className={s.meta}>{data.storeLabel}</p>
      </Panel>
    </div>
  )
}

/* THREE SENTENCES THE PROJECTION DOES NOT CARRY, and each is about the PAGE
   rather than about the configuration: two controls saying nothing is attached
   to them, and a catalogue that read no entries. The last one is a fact the
   core holds and does not state, which is the defect I16 names — filed for the
   SPINE lane as `emptyNote` on this projection, and it moves the moment it
   arrives. */
const NO_ENTRIES = 'This build read a catalogue with no entries in it, so a turn has nowhere to go.'
const UNPICKABLE = 'Nothing pressed here takes effect — this catalogue is not attached to a running build.'
const NOTHING_PICKED = 'No entry is picked, so there is nothing for a key to belong to. Choose one above first.'
