/**
 * The two things a checked JavaScript app needs told about its own build, and
 * nothing more.
 *
 * CSS Modules: Turbopack turns `styles.rail` into a class name at build time,
 * so at type level the import is a string map. Declaring it as `string` rather
 * than a generated per-file union is deliberate — a generated union needs a
 * build step, and no package below the UI has one (I19).
 */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}

declare module '*.css'
