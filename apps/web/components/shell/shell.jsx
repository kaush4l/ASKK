'use client'

import { ALL, subjectOf } from '@/lib/destinations'
import { MISROUTE, RAIL, REGIONS, STRIP } from '@/lib/placeholder'
import { searchFor } from '@/lib/agent'
import { Masthead } from './masthead'
import { Misroute } from './misroute'
import { Nav } from './nav'
import { Rail } from './rail'
import { Region } from './region'
import { StatusStrip } from './status-strip'
import { useAgent } from './use-agent'
import s from './shell.module.css'

/**
 * THE FRAME AROUND EVERY DESTINATION — what is on screen whichever one is open.
 *
 * One job, and it is composition: where you are (the nav and the masthead's
 * kicker), who the screen is about (the plate, out of `?agent=`), what the page
 * is doing (the strip), and the region the destination fills. It decides
 * nothing about the system it is looking at, and it will not once the seam is
 * wired either — the projections arrive as props from here downward.
 *
 * A client component because the whole application is a state machine that runs
 * in the browser (I1): there is no server to render against, and the address is
 * a store this page reads rather than a route parameter a server resolved.
 *
 * @param {{slug: string}} props which destination this route IS — declared by the
 *   route file, never inferred, so a page cannot render a destination the table
 *   does not list.
 */
export function Shell({ slug }) {
  const { agent, misrouted } = useAgent()
  const to = ALL.find((d) => d.slug === slug) ?? ALL[0]
  if (!to) throw new Error(`no destination is registered under the slug "${slug}"`)
  const region = REGIONS[to.slug] ?? REGIONS['']
  if (!region) throw new Error(`no region copy is registered for the destination "${to.slug}"`)
  // The nav's links carry who the screen is about; they do NOT carry the
  // misroute, which is about the address a person has already left.
  const search = searchFor(agent)
  return (
    <>
      <a className={s.skip} href="#region">Skip to content</a>
      <header className={s.chrome}>
        <Masthead kicker={to.label} subject={subjectOf(to, agent)} />
        <StatusStrip facts={STRIP} />
      </header>
      {misrouted ? <Misroute problem={MISROUTE} address={misrouted} /> : null}
      <div className={s.frame} data-rail={String(to.rail)}>
        <Nav here={to.slug} search={search} />
        <Region id="region" heading={region.heading} note={region.note} panes={to.panes} />
        {to.rail ? <Rail noun={RAIL.noun} subject={agent} note={RAIL.note} /> : null}
      </div>
    </>
  )
}
