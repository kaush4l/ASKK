// The shell's destinations as URLs. Each one owns the whole centre: the dashboard (and its cards) renders only at
// "/", the canvas only at "/canvas"; everything else replaces them (no overlay, nothing beside). The server and
// Tauri serve index.html for any path, so these survive reload and browser back/forward.

/** Engine/element ids may hold "/" (askk/loop): each segment is encoded, the slashes kept. */
export const engineHref = (id) => `/e/${String(id ?? "").split("/").map(encodeURIComponent).join("/")}`;
export const pageHref = (view) => (view === "canvas" ? "/page?view=canvas" : "/page");
export const HREF = { dashboard: "/", canvas: "/canvas", models: "/models", theme: "/tokens" };
/** The server's API paths (server/src/main.rs): no UI route may take one, or a reload hits the API, not index.html. */
export const API_PATHS = ["/world", "/act", "/layout", "/theme", "/events", "/ui"];

/** What a pathname shows: {kind: dashboard|canvas|models|theme|page|engine|focus|unknown, id?, view?}. */
export function routeOf(url) {
  const path = (url?.pathname ?? "/").replace(/\/+$/, "") || "/";
  if (path === "/") return { kind: "dashboard" };
  if (path === "/canvas") return { kind: "canvas" };
  if (path === "/models") return { kind: "models" };
  if (path === "/tokens") return { kind: "theme" };
  if (path === "/page") return { kind: "page", view: url?.searchParams?.get("view") === "canvas" ? "canvas" : "dashboard" };
  if (path === "/focus") return { kind: "focus" };
  if (path.startsWith("/e/")) {
    let id; try { id = path.slice(3).split("/").map(decodeURIComponent).join("/"); } catch { id = ""; }
    return id ? { kind: "engine", id } : { kind: "unknown" };
  }
  return { kind: "unknown" };
}
/** The page tree a route takes its Panel and background from. */
export const viewOf = (r) => (r.kind === "canvas" || (r.kind === "page" && r.view === "canvas") ? "canvas" : "dashboard");
/** Whether a panel item is the current route. */
export function isCurrent(r, item) {
  if (item.kind === "engine") return r.kind === "engine" && r.id === item.id;
  return r.kind === item.kind;
}
/** Where "done"/Close on a destination goes: the page it edits, else home. */
export const homeOf = (r) => (r.kind === "page" && r.view === "canvas" ? "/canvas" : "/");
/** Theme and Page are edit-mode tools: locked, their routes show an Unlock hint instead. */
export const needsUnlock = (r) => r.kind === "theme" || r.kind === "page";
