'use client'

import { useSyncExternalStore } from 'react'

/**
 * THE ONE PLACE REACT AND THE SIGNAL GRAPH MEET.
 *
 * `packages/kernel/src/signal.js` is pure and knows nothing about React;
 * `useSyncExternalStore` is React's own contract for a value it does not own.
 * Both halves already exist, so the binding is three lines — and it is written
 * once, here, so that adding a second reactive pane is a `useSignal` call and
 * never another hand-rolled subscribe/compare pair.
 *
 * `subscribe` and `get` are passed as they are, NOT wrapped: React re-subscribes
 * whenever the `subscribe` it is given is a new function, and a wrapper built in
 * the render body is a new function every render. A cell's two members are
 * closures made once when the cell was made, which is what makes this safe.
 *
 * The third argument is the server snapshot and it is `get` as well. This is a
 * static export with no server (I1), but Next still renders the tree once at
 * build time, and a `get` that reached for the browser would fail there — which
 * is why a cell's value is always something the pure core can produce.
 * @template T @param {import('@harness/kernel').Cell<T>} cell @returns {T}
 */
export function useSignal(cell) {
  return useSyncExternalStore(cell.subscribe, cell.get, cell.get)
}
