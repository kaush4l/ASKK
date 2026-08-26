/** The one element helper, in one place.
 *
 *     el("p", { class: "note" }, ["text"])
 *
 * Five views had a byte-identical copy of this. Five copies of seven lines is
 * not a crisis, but every one of those files sat at exactly the 200-line
 * ceiling, and a file with no room left is a file whose next honest change
 * arrives as a bad one. Hoisting the duplicate is what bought the room.
 *
 * It stays deliberately small: attributes as strings, children as nodes or
 * text, no event wiring and no reactive anything. A view that wants a listener
 * calls `addEventListener` where a reader can see it.
 */

/**
 * @param {string} tag
 * @param {Record<string, string>} [attrs]
 * @param {(Node | string)[]} [kids]
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, kids = []) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  node.append(...kids);
  return node;
}
