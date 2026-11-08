// Moves an element to document.body while it lives. Fixed chrome (the panel, its menu button and scrim) must not sit
// inside a scrolling ancestor: Safari/WebKit clips position:fixed descendants of an overflow scroller to its box,
// which hid the panel on the dashboard (whose content area scrolls). Chrome lets them escape; WebKit does not.
export function portal(node, target = typeof document !== "undefined" ? document.body : null) {
  if (target) target.appendChild(node);
  return { destroy() { node.remove(); } };
}
