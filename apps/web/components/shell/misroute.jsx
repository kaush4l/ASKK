import { NOT_REAL_YET } from '@/lib/placeholder'
import s from './shell.module.css'

/**
 * AN ADDRESS THAT NAMES NO DESTINATION, AND THE PAGE SAYING SO.
 *
 * `/tools/` is a fair guess at the tool trace. The predecessor rewrote it to
 * the Dashboard in silence: a mistyped address, or one shared by somebody whose
 * build spelled the destination differently, landed you on a screen you did not
 * ask for and nothing on the page mentioned it. Correcting the address is
 * right; doing it without a word is what left the reader to notice, or not.
 *
 * Two arrivals, and only one of them is this. A name the product SHIPPED —
 * `/trace/`, `/settings/` — is a redirect and says nothing, because the link
 * used to work and still does. A name nobody shipped is a misroute and gets
 * this row (`lib/destinations.js`, `land`).
 *
 * A banner is its OWN ROW, never a slot in the header strip: in the strip it
 * evicted the endpoint and the spend, so being told something had gone wrong
 * removed the only place the page said what it was pointed at. An error may add
 * a row; it may not subtract a fact.
 *
 * The sentences are the seam's `problem` projection — `{kind, message, detail,
 * repair}`, the one failure shape — so this component renders four strings it
 * did not write and will not change when increment 3 hands it the real one.
 * The address is rendered as a VALUE beside them and never spliced into a
 * sentence: the interface chooses layout and never composes prose (I5).
 *
 * @param {{problem: {kind: string, message: string, detail: string, repair: string},
 *          address?: string}} props `address` is absent on the 404 document
 *   itself, where the browser's own address bar is still showing it.
 */
export function Misroute({ problem, address = '' }) {
  return (
    <div className={s.banner} role="status" data-kind={problem.kind} data-placeholder={NOT_REAL_YET}>
      <p className={s.bannerHead}>{problem.message}</p>
      {address ? (
        <p className={s.bannerAside}>
          <code className={s.address}>{address}</code>
        </p>
      ) : null}
      <p className={s.bannerAside}>{problem.detail}</p>
      <p className={s.bannerAside}>{problem.repair}</p>
    </div>
  )
}
