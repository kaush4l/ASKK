// Where the backend lives: the same origin that served the page (askk-server); VITE_API_BASE overrides.
const env = (typeof import.meta !== "undefined" && import.meta.env) || {};
export const API_BASE = env.VITE_API_BASE ?? "";
