/**
 * One format for time (UX U2). A moment is clock time HH:MM in the owner's locale; anything
 * older than today is day-qualified. A duration is 38s, 4m 12s, 1h 03m. Durations never carry a
 * clock time and clock times never carry seconds. Nothing else in the UI formats time.
 */

const clockFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const shortDay = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
const yearDay = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

const startOfDay = (at) => {
  const day = new Date(at)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

/** `14:02` */
export function clock(at) {
  return at ? clockFormat.format(new Date(at)) : ''
}

/** The day-divider label: Today, Yesterday, Mon 21 Sep, 21 Sep 2025. */
export function day(at, now = Date.now()) {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (new Date(at).getFullYear() !== new Date(now).getFullYear()) return yearDay.format(new Date(at))
  return dayFormat.format(new Date(at))
}

export function sameDay(a, b) {
  return startOfDay(a) === startOfDay(b)
}

/** A lone moment outside a list: `14:02`, `yesterday 14:02`, `21 Sep 14:02`. */
export function moment(at, now = Date.now()) {
  if (!at) return ''
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86400000)
  if (days === 0) return clock(at)
  if (days === 1) return `yesterday ${clock(at)}`
  const date = new Date(at).getFullYear() !== new Date(now).getFullYear() ? yearDay.format(new Date(at)) : shortDay.format(new Date(at))
  return `${date} ${clock(at)}`
}

/** A day-qualified date without time, for lists: `21 Sep`, or the clock time when today. */
export function when(at, now = Date.now()) {
  if (!at) return ''
  if (sameDay(at, now)) return clock(at)
  return new Date(at).getFullYear() !== new Date(now).getFullYear() ? yearDay.format(new Date(at)) : shortDay.format(new Date(at))
}

/** `850ms` is shown as `0.9s`; `38s`, `4m 12s`, `1h 03m`. */
export function duration(seconds) {
  const s = Math.max(0, Number(seconds) || 0)
  if (s < 10) return `${(Math.round(s * 10) / 10).toFixed(1)}s`
  if (s < 60) return `${Math.round(s)}s`
  const whole = Math.round(s)
  if (whole < 3600) return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, '0')}s`
  return `${Math.floor(whole / 3600)}h ${String(Math.floor((whole % 3600) / 60)).padStart(2, '0')}m`
}

export const ms = (value) => duration((Number(value) || 0) / 1000)
