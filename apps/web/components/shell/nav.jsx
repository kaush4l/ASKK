import Link from 'next/link'

import { NAV } from '@/lib/destinations'
import s from './shell.module.css'

/**
 * THE LIST YOU CLICK. Three entries, and the count IS the claim: the
 * predecessor grew to seven, two of them instruments for the person building
 * the product, and had to spend a round deleting three. `nav.test.js` asserts
 * the number so an eighth cannot arrive one view at a time.
 *
 * `aria-current="page"` and not `aria-selected`: this is navigation, not a tab
 * set. Real `<a>` elements, because a static export gives one real directory
 * per destination — a reload serves the page it is on and Back needs no
 * listener. No glyphs: a label is what a person reads.
 *
 * The query string rides on every entry so a destination change keeps who the
 * screen is about, and a link copied out of the address bar shows the next
 * person what the sender was looking at.
 *
 * @param {{here: string | null, search: string}} props `here` is null where no
 *   destination is current — the 404 document, which is not one of them.
 */
export function Nav({ here, search }) {
  return (
    <nav className={s.nav} aria-label="Destinations">
      {NAV.map((to) => (
        <Link
          key={to.slug}
          href={to.path + search}
          className={s.navItem}
          aria-current={to.slug === here ? 'page' : undefined}
        >
          {to.label}
        </Link>
      ))}
    </nav>
  )
}
