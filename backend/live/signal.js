// Signals (2026-10-25): the live stores' one primitive. A signal holds a value and tells its subscribers when it is
// replaced (an equal value is no change); computed() derives one from others, recomputed only when one of theirs is.
// useValue() is a view's subscription: it re-renders only when the part it selects changes (`eq`), so one artifact's
// patch redraws that artifact's tile, not the page.
//
//   signal(value, server?)        {get, server, set, subscribe, clear} — server: what the server rendered (default: now)
//   computed(deps, fn)            fn(...deps' values), cached on their identities — read-only, the same shape
//   useValue(sig, select?, eq?)   select(sig's value); a new select result equal to the last (eq) keeps the last
//   sameJson, sameItems           eqs for a select that builds a fresh object, a fresh list

import { useRef, useSyncExternalStore } from "react"

export function signal(value, server) {
  const listeners = new Set()
  return {
    get: () => value,
    server: () => (server === undefined ? value : server),
    set(next) {
      if (Object.is(next, value)) return
      value = next
      for (const fn of listeners) fn()
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    clear: () => listeners.clear(),
  }
}

export function computed(deps, fn) {
  const cache = {}
  const read = (side) => {
    const now = deps.map((d) => d[side]())
    const c = cache[side]
    if (!c || now.some((v, i) => v !== c.inputs[i])) cache[side] = { inputs: now, value: fn(...now) }
    return cache[side].value
  }
  const subscribe = (cb) => {
    const offs = deps.map((d) => d.subscribe(cb))
    return () => offs.forEach((off) => off())
  }
  return { get: () => read("get"), server: () => read("server"), subscribe }
}

const same = (v) => v
// eq for a select that builds a fresh object each time (a card's derived line): equal when its JSON is.
export const sameJson = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b)
// eq for a select that builds a fresh list: equal when its items are.
export const sameItems = (a, b) => a === b || (a?.length === b?.length && a.every((x, i) => x === b[i]))

export function useValue(sig, select = same, eq = Object.is) {
  const memo = useRef({})
  const pick = (side) => {
    const input = sig[side]()
    const m = memo.current[side]
    if (m && m.sig === sig && m.input === input && m.select === select) return m.output
    const fresh = select(input)
    const output = m && m.sig === sig && eq(m.output, fresh) ? m.output : fresh
    memo.current[side] = { sig, input, select, output }
    return output
  }
  return useSyncExternalStore(sig.subscribe, () => pick("get"), () => pick("server"))
}
