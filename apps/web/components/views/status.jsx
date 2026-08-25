import { Panel } from '@/components/ui/panel'
import s from './views.module.css'

/**
 * @typedef {object} StatusData
 * @property {string} status    the machine field, so the edge can be tinted
 * @property {string} headline  the one line of health, already worded
 * @property {string} detail    what that line is reading, for the person who asks
 */

/**
 * THE ONE-LINE HEALTH OF THE BUILD (`GET /panels/status`).
 *
 * It is one sentence because the page already has a strip of facts; a second
 * dashboard in the corner of Setup would be the same numbers wearing a
 * different wording. The predecessor's single status dot in the chrome was the
 * Linux sandbox's alone, so a page whose model endpoint was refusing every turn
 * still read green — the fact this projects is the BUILD's health, and the core
 * decides what that means.
 *
 * @param {{data: StatusData}} props
 */
export function Status({ data }) {
  return (
    <Panel caption="This build" status={data.status}>
      <p>{data.headline}</p>
      <p className={s.meta}>{data.detail}</p>
    </Panel>
  )
}
