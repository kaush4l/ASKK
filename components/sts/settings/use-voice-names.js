"use client"

import * as React from "react"

import { browserVoices, macVoices } from "@/backend/hardware/speech/voices"

export function useVoiceNames(open, engine, locale) {
  const [names, setNames] = React.useState([])
  React.useEffect(() => {
    if (!open || !engine) return
    let live = true
    const lang = (locale ?? "en").slice(0, 2)
    if (engine === "mac") {
      macVoices()
        .then((list) => live && setNames(list.filter((v) => v.lang.startsWith(lang)).map((v) => v.name)))
        .catch(() => live && setNames([]))
      return () => {
        live = false
      }
    }
    const read = () =>
      live &&
      setNames(
        browserVoices()
          .filter((v) => v.lang.startsWith(lang))
          .map((v) => v.name),
      )
    read()
    speechSynthesis.addEventListener?.("voiceschanged", read)
    return () => {
      live = false
      speechSynthesis.removeEventListener?.("voiceschanged", read)
    }
  }, [open, engine, locale])
  return names
}
