/**
 * THE ONE FAILURE THE CORE CANNOT PRODUCE, so the interface holds it.
 *
 * GitHub Pages serves an address that is not a real directory as the 404
 * document (I1), which means the seam never sees it: there is no request, no
 * route lookup and nothing for `handle` to refuse. The page is the only thing
 * that knows, and it says so in the same shape every other failure arrives in —
 * `components/views/problem.jsx` renders this and the seam's alike, so there is
 * one error component and not two.
 *
 * It moved out of `lib/placeholder.js` when that file was deleted, and it is
 * the one thing in it that was never a placeholder.
 */

/** @type {import('@/components/views/problem').ProblemData} */
export const MISROUTE = {
  id: 'misroute',
  kind: 'no_such_destination',
  // TRUE ON BOTH DOCUMENTS. The 404 page renders this before the correction
  // runs, and Work renders it after; a past tense would be a lie on the first
  // and a present tense a lie on the second (I16).
  message: 'That address names no destination. Work is where the application opens, and that is where this goes.',
  detail: 'Work, Agents and Setup are every destination there is. The design system is reachable by address and is not one of them.',
  repair: 'Follow one of the three above, or edit the address.',
}
