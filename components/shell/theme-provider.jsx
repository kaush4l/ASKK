"use client"

import { ThemeProvider as NextThemesProvider } from "next-themes"

// On the server the inline theme script keeps its runnable type, so it runs before first paint and
// the wrong theme never flashes. In the browser it is typed as data, so React 19 no longer warns
// "Encountered a script tag" during hydration (next-themes #387).
export function themeScriptProps(isServer) {
  return isServer ? undefined : { type: "application/json" }
}

export function ThemeProvider(props) {
  return (
    <NextThemesProvider
      scriptProps={themeScriptProps(typeof window === "undefined")}
      {...props}
    />
  )
}
