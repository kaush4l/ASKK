import { Fragment } from 'react'

import { Shell } from '@/components/shell/shell'
import { VIEWS, View } from '@/components/views'
import { EMPTY, FIXTURES } from '@/fixtures'
import { COMPONENTS } from './specimens'
import s from './gallery.module.css'

/**
 * THE DESIGN SYSTEM, at `/design-system/`. Deliberately not in the nav and not
 * linked from the product: an internal gallery reached by address, carrying a
 * crumb back. It is a real route because the address has to resolve.
 *
 * EVERY VIEW THE SEAM CAN RETURN, AGAINST A REALISTIC PROJECTION, IN BOTH
 * ROOMS. A critic can reject a state here without running an agent, which is
 * the whole point — the predecessor's gallery was a region toggled by a header
 * switch, it listed six components that did not exist, and the one artifact
 * whose job was to catch drift was itself the drift.
 *
 * A server component: these render from data alone, so the static export paints
 * the whole gallery and no script has to run for a critic to read it. The
 * client half is the `Shell` around it, which reads the address.
 */
export default function Page() {
  const names = Object.keys(VIEWS)
  return (
    <Shell slug="design-system">
      <div className={s.gallery}>
        {names.map((name) => (
          <Fragment key={name}>
            <Specimen name={name} data={FIXTURES[name]} />
            {/* AND THE SAME VIEW HOLDING NOTHING, next to it. Every list in
                `fixtures/` is populated, so the sentence a region says when it
                is empty — the one place this product refuses to draw a blank
                box — had never been rendered anywhere a person could read it.
                Files and processes carry two, because 'the reload took them'
                and 'it never held any' are the distinction those notes exist
                to make and one specimen cannot show it. */}
            {(EMPTY[name] ?? []).map((data, i) => (
              <Specimen key={i} name={`${name} — holding nothing`} data={data} view={name} />
            ))}
          </Fragment>
        ))}
        {/* AND THE PARTS THE VIEWS ARE BUILT FROM, IN EVERY STATE. A view's
            fixture is one realistic projection, so it shows each component in
            the one state that projection happens to carry; these are the rest
            of them (`specimens.jsx`). */}
        {COMPONENTS.map((component) => (
          <Specimen key={component.name} name={component.name}>{component.node}</Specimen>
        ))}
        {/* THE STRUCTURAL REFUSAL, AS A SPECIMEN. A name the route table does
            not list cannot be produced; this is what the page does if one ever
            is, and it is here so that behaviour is something a critic can look
            at rather than something a comment claims. */}
        <Specimen name="wharrgarbl — a name docs/SEAM.md does not list" data={undefined} view="wharrgarbl" />
      </div>
    </Shell>
  )
}

/**
 * One view, in both rooms. `data-theme` is stamped on each box rather than on
 * the document, which works because `app/globals.css` defines each palette
 * against the attribute and not against `:root` alone — the same mechanism the
 * boot script uses, exercised twice on one page.
 *
 * @param {{name: string, data?: unknown, view?: string, children?: React.ReactNode}} props
 *   `view` is the name to RENDER when it differs from the name to SHOW;
 *   `children` is a specimen that is a COMPONENT rather than a whole view.
 */
function Specimen({ name, data, view, children }) {
  return (
    <section className={s.specimen} aria-label={name}>
      <h3 className={s.name}>{name}</h3>
      <div className={s.rooms}>
        {['light', 'dark'].map((room) => (
          // `data-specimen` is for the smoke gate and not for a stylesheet:
          // two of the specimens on this page ARE failures — the seam's 404 and
          // a view name the route table does not list — and a probe asking
          // "did this destination replace its content with a failure" would
          // otherwise be answered yes by the gallery doing its job.
          <div key={room} className={s.room} data-theme={room} data-specimen="true">
            <span className={s.roomName}>{room}</span>
            {children ?? <View view={view ?? name} data={data} />}
          </div>
        ))}
      </div>
    </section>
  )
}
