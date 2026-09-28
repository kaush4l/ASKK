const paths = {
  files: <><path d="M14 2H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 12h8M8 16h5"/></>,
  folder: <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  terminal: <><path d="m4 6 5 6-5 6M12 18h8"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  arrow: <><path d="M12 19V5m-6 6 6-6 6 6"/></>,
  right: <path d="m9 5 7 7-7 7"/>,
  down: <path d="m5 9 7 7 7-7"/>,
  play: <path d="m8 4 12 8-12 8Z"/>,
  stop: <rect x="6" y="6" width="12" height="12" rx="2"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  settings: <><path d="m10 3-1 3-3 1-2-1-2 4 2 2-1 3 2 3 3-1 2 2h4l1-3 3-1 2 1 2-4-2-2 1-3-2-3-3 1-2-2Z"/><circle cx="12" cy="11" r="3"/></>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2m-3-9 1 1M5 19l-1 1m15-1 1 1M5 5 4 4"/></>,
  moon: <path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>,
  agents: <><circle cx="9" cy="7" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/></>,
  changes: <><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10m0-2h6a6 6 0 0 0 6-5"/></>,
  globe: <><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></>,
  box: <><path d="m12 3 9 5v9l-9 5-9-5V8Zm-9 5 9 5 9-5M12 13v9M8 5l9 5"/></>,
  bolt: <path d="m13 2-9 12h7l-1 8 10-13h-8Z"/>,
  external: <><path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3"/></>,
  code: <path d="m8 5-6 7 6 7m8-14 6 7-6 7M14 3l-4 18"/>,
  save: <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/></>,
  pin: <><path d="m16 3 5 5-4 1-4 4-1 5-6-6 5-1 4-4Z"/><path d="m9 15-6 6"/></>,
  panel: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></>,
  spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/><path d="m20 2 .5 1.5L22 4l-1.5.5L20 6l-.5-1.5L18 4l1.5-.5Z"/></>,
  more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  warning: <><path d="m12 3 10 18H2Z"/><path d="M12 9v5m0 3v1"/></>,
  laptop: <><rect x="4" y="3" width="16" height="13" rx="2"/><path d="m4 16-2 4h20l-2-4"/></>,
  chat: <path d="M21 11a8 8 0 0 1-8 8H8l-5 3V7a4 4 0 0 1 4-4h6a8 8 0 0 1 8 8Z"/>,
}
export default function Icon({ name, size = 18, ...props }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] || paths.box}</svg>
}
export function IconButton({ icon, label, children, className = '', ...props }) {
  return <button type="button" className={`icon-button ${className}`} aria-label={label} title={label} {...props}><Icon name={icon}/>{children}</button>
}
