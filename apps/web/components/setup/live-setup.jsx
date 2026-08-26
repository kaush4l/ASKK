'use client'

import { useState } from 'react'

import { get, post } from '@harness/kernel'

import { Appearance } from '@/components/setup/appearance'
import { Empty } from '@/components/ui/empty'
import { View } from '@/components/views'
import { Settings } from '@/components/views/settings'
import { useSession, useProjection } from '@/components/shell/use-session'
import { BOOTING } from '@/lib/copy'
import { saveKey } from '@/lib/keys'
import s from '@/components/views/views.module.css'

/** @typedef {import('@/components/views/problem').ProblemData} ProblemData */

/**
 * THE SETUP SCREEN, OVER THE REAL SEAM — and over the ONE door that is not it.
 *
 * Picking an entry is `POST /settings`, which the log records. Saving a key is
 * `saveEndpoint`, which it must not (docs/SEAM.md, the single stated exception
 * to I4). Both land here so the asymmetry is visible in one file rather than
 * inferred from two.
 *
 * A SAVED KEY RE-PROJECTS THROUGH THE SEAM. The broker's write moves nothing in
 * the log, so `hasKey` on the screen would still say what it said before the
 * press; re-selecting the same entry is a request the log DOES record, and it
 * is what makes the row's own sentence true again.
 */
export function LiveSetup() {
  const session = useSession()
  // APPEARANCE IS OUTSIDE THE BOOT GATE, and that is the point of it living in
  // `localStorage`: it is the one control on this page that works before the
  // core has come up, and the one that still works when the core cannot.
  return (
    <div className={s.stack}>
      {!session ? <Empty note={BOOTING} />
        : session.problem ? <View view="problem" data={session.problem} />
        : <Live session={session} />}
      <Appearance />
    </div>
  )
}

/** @param {{session: import('@/lib/session').Session}} props */
function Live({ session }) {
  const catalogue = useProjection(session, get('/settings'))
  const health = useProjection(session, get('/panels/status'))
  const [refused, setRefused] = useState(/** @type {ProblemData|null} */ (null))
  const pick = (/** @type {string} */ entry) => setRefused(session.act(post('/settings', { entry })))
  return (
    <div className={s.stack}>
      {catalogue.view === 'settings' ? (
        <Settings
          data={/** @type {any} */ (catalogue.data) /* the seam types every `data` as an open record; each component declares the shape its view carries */}
          onSelect={pick}
          onSaveKey={(apiKey) => void saveKey(String(catalogue.data.selected ?? ''), apiKey)
            .then((problem) => setRefused(problem ?? session.act(post('/settings', { entry: String(catalogue.data.selected ?? '') }))))}
        />
      ) : <View view={catalogue.view} data={catalogue.data} />}
      <View view={health.view} data={health.data} />
      {refused ? <View view="problem" data={refused} /> : null}
    </div>
  )
}
