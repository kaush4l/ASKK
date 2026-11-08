// A small, safe markdown subset: everything escaped first, then headings, lists, emphasis, code, links.
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
export function renderMarkdown(text = "") {
  const out = []; let list = false;
  for (const line of String(text).split("\n")) {
    const li = line.match(/^\s*[-*]\s+(.*)/);
    if (li) { if (!list) { out.push("<ul>"); list = true; } out.push(`<li>${inline(li[1])}</li>`); continue; }
    if (list) { out.push("</ul>"); list = false; }
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) out.push(`<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push("</ul>");
  return out.join("");
}

/** One line of inline markdown (emphasis, code, links; no blocks): for rows and other one-line places. */
export function renderInline(text = "") {
  const line = String(text).split("\n").find((l) => l.trim()) ?? "";
  return inline(line.replace(/^\s*(#{1,3}|[-*])\s+/, ""));
}
/** Text with `md`: a single line renders inline (fits a row), several lines as blocks. */
export const mdInline = (text = "") => !String(text).trim().includes("\n");
/** Markdown → its plain text (for the hover title). */
export const plainText = (text = "") => String(text).replace(/\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g, "$1$2$3").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
