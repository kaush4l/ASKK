import linuxErrno from './linux-errno.json' with { type: 'json' }

// Linux UAPI asm-generic/errno{,-base}.h, v6.1. Emscripten uses WASI errno values.
export const errnoMarker = '#if defined(CONFIG_LINUX) || defined(EMSCRIPTEN)'
export const errnoTranslation = [
  '#if defined(EMSCRIPTEN)',
  '    if (err == 0) return 0;',
  ...Object.entries(linuxErrno).flatMap(([name, value]) => [`#ifdef ${name}`, `    if (err == ${name}) return ${value};`, '#endif']),
  '    return 5; /* Unmapped host error is Linux EIO, never a foreign errno. */',
  '#elif defined(CONFIG_LINUX)',
].join('\n')

export function patchErrno(source) {
  if (source.split(errnoMarker).length !== 2) throw new Error('Pinned 9p errno boundary changed')
  return source.replace(errnoMarker, errnoTranslation)
}
