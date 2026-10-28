"use client"

import * as React from "react"

import { detectHost, hasCapability } from "@/backend/live/host"
import { HostDictation, pickRecognizer } from "@/backend/live/listen"
import { Dictation } from "@/lib/speech/dictation"
import { speechSupport } from "@/lib/speech/recognition"

// Live dictation into a text field.
//   const speech = useSpeechInput({ onText })
//   speech.support     null while probing, then pickRecognizer() (backend/live/listen.js): { kind, supported, reason }
//   speech.listening   · speech.correcting · speech.error · speech.correctionError
//   speech.toggle()    start, or stop (the final text still lands)
//   speech.release()   stop and ignore anything later (after send, or typing)
// onText(text) receives the dictated text so far on every change; the caller
// decides where it goes.
// voice-in (2026-10-27): a host with capability "speech" (macOS) transcribes the page's mic in any browser (HostDictation);
// without it Safari's dictation (lib/speech/dictation.js); elsewhere the mic is off with the reason.
const probe = () =>
  Promise.all([detectHost().then((h) => hasCapability(h, "speech"), () => false), speechSupport()]).then(([hostSpeech, browser]) =>
    pickRecognizer({ hostSpeech, browser }),
  )

export function useSpeechInput({ onText }) {
  const [support, setSupport] = React.useState(null)
  const [listening, setListening] = React.useState(false)
  const [correcting, setCorrecting] = React.useState(false)
  const [error, setError] = React.useState(null)
  const [correctionError, setCorrectionError] = React.useState(null)
  const dictation = React.useRef(null)
  const onTextRef = React.useRef(onText)
  const supportRef = React.useRef(null)

  React.useEffect(() => {
    onTextRef.current = onText
    supportRef.current = support
  })

  React.useEffect(() => {
    let live = true
    probe().then((found) => live && setSupport(found))
    return () => {
      live = false
      dictation.current?.release()
    }
  }, [])

  const release = React.useCallback(() => {
    dictation.current?.release()
    dictation.current = null
    setListening(false)
    setCorrecting(false)
  }, [])

  const start = React.useCallback(() => {
    if (dictation.current) return
    setError(null)
    setCorrectionError(null)
    const Kind = supportRef.current?.kind === "host" ? HostDictation : Dictation
    const d = new Kind({
      onChange: (text) => onTextRef.current?.(text),
      onStatus: ({ correcting, error }) => {
        setCorrecting(correcting)
        setCorrectionError(error)
      },
      onEnd: ({ error }) => {
        if (dictation.current === d) dictation.current = null
        setListening(false)
        setCorrecting(false)
        if (error) setError(error)
        // A denied prompt changes what the browser can do; probe again.
        probe().then(setSupport)
      },
    })
    dictation.current = d
    try {
      d.start()
      setListening(true)
    } catch (e) {
      dictation.current = null
      setError(e.message)
    }
  }, [])

  const toggle = React.useCallback(() => {
    if (dictation.current?.listening) {
      dictation.current.stop()
      setListening(false)
      return
    }
    release() // a final text still on its way is dropped
    start()
  }, [release, start])

  return { support, listening, correcting, error, correctionError, start, release, toggle }
}
