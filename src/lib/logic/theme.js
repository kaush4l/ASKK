// The tokens (docs/design-rules.md §1): one file, design/tokens.json, is the single source of every scale, colour,
// glass and motion value. The backend seeds theme.json from the same file; the app.css token block is generated
// from it (`bun scripts/tokens.js`); tokens.test.js fails when any of the three drift.
import TOKENS from "../../../design/tokens.json";

/** The token file: scales (space, text, radius, width, control, icon, line, field, motion, ease, font, glass,
 * background, breakpoint) and the colours per mode (light, dark). */
export const DEFAULT_TOKENS = TOKENS;
export const MODES = ["light", "dark"];
export const GROUPS = Object.keys(TOKENS).filter((g) => !MODES.includes(g));

/** world.theme → {groups, light, dark}. Accepts {tokens: {...}} or the tokens themselves. */
export function splitTokens(theme) {
  const t = theme?.tokens ?? theme ?? {};
  const groups = {}, light = {}, dark = {};
  for (const [k, v] of Object.entries(t)) {
    if (k === "light" && v && typeof v === "object") Object.assign(light, v);
    else if (k === "dark" && v && typeof v === "object") Object.assign(dark, v);
    else if (v && typeof v === "object") groups[k] = { ...v };
  }
  return { groups, light, dark };
}

/** An older flat theme (`radius: "10px"`, `face`, `blur` …) → the token shape. */
const LEGACY = { radius: ["radius", "md"], blur: ["glass", "blur"], "glass-alpha": ["glass", "alpha"], "card-alpha": ["glass", "card"], face: ["font", "face"], font: ["font", "body"], mono: ["font", "mono"] };

/** The theme with every token present: saved steps win, missing ones come from the token file, unknown ones drop. */
export function withDefaults(theme) {
  const t = theme?.tokens ?? theme ?? {};
  const out = structuredClone(TOKENS);
  for (const [k, v] of Object.entries(t)) {
    if ((typeof v === "string" || typeof v === "number") && LEGACY[k]) { const [g, s] = LEGACY[k]; out[g][s] = typeof v === "number" ? `${v}px` : v; continue; }
    if (!v || typeof v !== "object" || !out[k]) continue;
    for (const [s, x] of Object.entries(v)) if (s in out[k] && typeof x === "string") out[k][s] = x;
  }
  return out;
}

const safe = (s) => String(s).replace(/[;{}<>]/g, "");
const decl = (m, prefix = "") => Object.entries(m).map(([k, v]) => `--${prefix}${safe(k)}:${safe(v)};`).join("");
/** CSS text: the scales and light colours on :root, dark under the system preference unless forced light, and forced dark. */
export function themeCss(theme) {
  const { groups, light, dark } = splitTokens(theme);
  const scales = Object.entries(groups).map(([g, m]) => decl(m, `${safe(g)}-`)).join("");
  return `:root{${scales}${decl(light)}}` +
    `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${decl(dark)}}}` +
    `:root[data-theme="dark"]{${decl(dark)}}`;
}

/** The app.css token block (between the markers), generated from the token file. */
export const BLOCK_START = "/* tokens:start — generated from design/tokens.json by `bun scripts/tokens.js`; do not edit */";
export const BLOCK_END = "/* tokens:end */";
export function tokenBlock() {
  return `${BLOCK_START}\n${themeCss(TOKENS).replace(/}(?=[:@])/g, "}\n")}\n${BLOCK_END}`;
}
