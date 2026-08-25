'use client'

import { useEffect } from 'react'

import { ALL, subjectOf } from '@/lib/destinations'
import { MISROUTE } from '@/lib/misroute'
import { searchFor } from '@/lib/agent'
import { Problem } from '@/components/views/problem'
import { Masthead } from './masthead'
import { Nav } from './nav'
import { Rail } from './rail'
import { Region } from './region'
import { followDeviceTheme } from './theme-boot'
import { useAgent } from './use-agent'
import s from './shell.module.css'

/**
 * THE FRAME AROUND EVERY DESTINATION — what is on screen whichever one is open.
 *
 * One job, and it is composition: where you are (the nav and the masthead's
 * kicker), who the screen is about (the plate, out of `?agent=`), and the region
 * the destination fills. It decides nothing about the system it is looking at
 * and reads no projection: the seam is reached from inside the region, by the
 * component that renders what it returns.
 *
 * THE STRIP OF FACTS IS GONE, and its absence is the increment. It rendered
 * `Agent · — · — · —` over a core that had not started, which is four assertions
 * the page could not make; every fact it listed is one the seam owes it
 * (`GET /panels/status`) and no build serves that route yet. A strip of em
 * dashes is not a smaller claim than a wrong number, it is the same claim made
 * quietly.
 *
 * A client component because the whole application is a state machine that runs
 * in the browser (I1): there is no server to render against, and the address is
 * a store this page reads rather than a route parameter a server resolved.
 *
 * @param {{slug: string, children?: React.ReactNode}} props `slug` is which
 *   destination this route IS — declared by the route file, never inferred, so
 *   a page cannot render a destination the table does not list. `children` is
 *   what fills the region where a destination has something to render.
 */
export function Shell({ slug, children }) {
  const { agent, misrouted } = useAgent()
  useEffect(followDeviceTheme, [])
  const to = ALL.find((d) => d.slug === slug)
  if (!to) throw new Error(`no destination is registered under the slug "${slug}"`)
  // The nav's links carry who the screen is about; they do NOT carry the
  // misroute, which is about the address a person has already left.
  const search = searchFor(agent)
  return (
    <>
      <a className={s.skip} href="#region">Skip to content</a>
      <header className={s.chrome}>
        <Masthead kicker={to.label} subject={subjectOf(to, agent)} />
      </header>
      {misrouted ? <Problem data={MISROUTE} subject={misrouted} placement="banner" /> : null}
      <div className={s.frame} data-rail={String(to.rail)}>
        <Nav here={to.slug} search={search} />
        <Region id="region" heading={to.heading} note={to.note}>
          {children}
        </Region>
        {to.rail ? <Rail subject={agent} /> : null}
      </div>
    </>
  )
}
