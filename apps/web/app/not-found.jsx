'use client'

import { useEffect } from 'react'

import { BASE } from '@/lib/base'
import { land } from '@/lib/destinations'
import { MISROUTE } from '@/lib/placeholder'
import { Problem } from '@/components/views/problem'
import { Nav } from '@/components/shell/nav'
import { Masthead } from '@/components/shell/masthead'
import s from '@/components/shell/shell.module.css'

/**
 * WHERE AN UNKNOWN ADDRESS ACTUALLY ARRIVES. GitHub Pages has no rewrites, so
 * anything that is not a real directory is served this document — which means
 * this file, and not a router, is the whole of the predecessor's misroute path.
 *
 * It does two different things for two different arrivals, and keeping them
 * apart is the point (`lib/destinations.js`, `land`): a name the product SHIPPED
 * is a redirect and is silent, because that link used to work; a name nobody
 * shipped lands on Work carrying `?misrouted=`, and the shell there says so.
 *
 * The note is ALSO rendered here, underneath the frame, so the page says what
 * happened even in the frame before the correction runs and even if scripting
 * never starts. A person who reads only this document has still been told.
 */
export default function NotFound() {
  useEffect(() => {
    const landing = land(window.location.pathname, BASE)
    const query = new URLSearchParams(window.location.search)
    if (landing.kind !== 'unknown') {
      // A name the product shipped keeps everything the address carried,
      // including who the screen was about.
      const kept = query.toString()
      window.location.replace(BASE + landing.to.path + (kept ? '?' + kept : ''))
      return
    }
    query.set('misrouted', landing.was)
    // `replace`, not `assign`: the address that named nothing does not deserve
    // a history entry, and Back should reach wherever the person came from.
    window.location.replace(BASE + landing.to.path + '?' + query)
  }, [])
  return (
    <>
      <header className={s.chrome}>
        <Masthead kicker="No such destination" subject="HARNESS" />
      </header>
      <Problem data={MISROUTE} placement="banner" />
      <div className={s.frame}>
        <Nav here={null} search="" />
      </div>
    </>
  )
}
