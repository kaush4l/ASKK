// Avatars (contract §5 Avatar): every object's icon view. Pure: what the avatar shows from an object's live state.

/** The object's icon: the twin's `icon`, else the Avatar its icon view carries, else null. */
export function iconOf(obj) {
  if (obj?.icon) return obj.icon;
  const a = (obj?.views?.icon?.children ?? []).find((n) => n?.c === "Avatar");
  return a?.props?.icon ?? null;
}
/** Initials for the label fallback: "Research desk" → "RD". */
export function initials(label = "") {
  const w = String(label).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] ?? "·").slice(0, 2)).toUpperCase();
}
export const isAsset = (icon) => typeof icon === "string" && icon.startsWith("/ui/assets/");

/**
 * Live state → the avatar's ring and badge. An engine reports `running` (below or itself), open `asks`, `failed`
 * below; `online` is the connection. Order: offline/stopped dim · failed ⚠️ · asking 💬 · running pulse · idle dot.
 */
export function avatarState({ phase = "idle", running = 0, asks = 0, failed = 0, online = true } = {}) {
  const dim = !online || phase === "stopped";
  const isFailed = phase === "failed" || failed > 0;
  const asking = asks > 0 || phase === "waiting";
  const busy = running > 0 || phase === "running" || phase === "waiting";
  return {
    dim,
    ring: dim ? "none" : busy ? "pulse" : isFailed ? "steady" : "none",
    tone: dim ? "neutral" : isFailed ? "error" : busy || asking ? "accent" : phase === "interrupted" ? "warn" : "ok",
    badge: dim && !isFailed ? null : isFailed ? "⚠️" : asking ? "💬" : null,
    dot: online && !dim && !busy && !isFailed && !asking,
    word: dim ? (online ? "stopped" : "offline") : isFailed ? "failed" : asking ? "asking" : busy ? "running" : "idle",
  };
}
