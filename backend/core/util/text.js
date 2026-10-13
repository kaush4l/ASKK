// Small text helpers shared across backend/ (core and features).

// `text` cut to `size` characters with an ellipsis when longer.
export const clip = (text, size) => (text.length > size ? `${text.slice(0, size)}…` : text)
