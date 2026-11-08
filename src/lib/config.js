// Where the backend lives: same origin in production; :4600 in dev; VITE_API_BASE overrides.
const env = (typeof import.meta !== "undefined" && import.meta.env) || {};
export const API_BASE = env.VITE_API_BASE ?? (env.DEV ? "http://localhost:4600" : "");
