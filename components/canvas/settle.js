// The camera's first sight: a new desk or a new viewport size refits it and picks the layout's wrap again. A live
// artifact change never does (it moves cards, never flips the wrap), so the camera holds still with no input.
export const fitKey = ({ tree, viewport }) => `${tree?.name}|${viewport?.w ?? 0}x${viewport?.h ?? 0}`

// Refit (and pick the wrap again) for a new desk always, for a new viewport size only until the owner first holds the
// camera (Fit, an open, Follow, a pan or a zoom), so a size that flips under a still page never glides it.
const deskOf = (key) => key.slice(0, key.lastIndexOf("|"))
export const refitDue = ({ fitted, shown, held }) => {
  if (fitted === shown) return false
  if (fitted == null) return true
  return deskOf(fitted) !== deskOf(shown) || !held
}

// Glide to an opened card unless it is the card already open and the camera already sits on it (within 1 px and 1%
// zoom), so a second open of the same card (a repeat tap, or a tap and its click) never re-glides it.
const near = (a, b) => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 && Math.abs(a.z - b.z) <= 0.01 * b.z
export const openDue = ({ opened, id, cam, to }) => opened !== id || !cam || !to || !near(cam, to)
// Follow on with no work to follow: back to the whole desk, unless a card is open (it stays shown until the work
// moves), so Follow over an opened card never glides it away to Fit. rect: the camera on the target's card, or null.
export const glideTarget = ({ opened, rect, fitTo }) => (rect ? rect : opened ? null : fitTo)
