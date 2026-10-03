"use client"

import * as React from "react"

import { Dictation } from "@/lib/dictation"
import { speechSupport } from "@/lib/speech"

// Live dictation into a text field, auto-punctuated (lib/dictation.js).
//   const speech = useSpeechInput({ onText })
//   speech.support     null while probing, then speechSupport() (lib/speech.js)
//   speech.listening   · speech.correcting · speech.error · speech.correctionError
//   speech.toggle()    start, or stop (the final correction still lands)
//   speech.release()   stop and ignore anything later (after send, or typing)
// onText(text) receives the dictated text so far on every change; the caller
// decides where it goes.
export function useSpeechInput({ onText }) {
  const [support, setSupport] = React.useState(null)
  const [listening, setListening] = React.useState(false)
  const [correcting, setCorrecting] = React.useState(false)
  const [error, setError] = React.useState(null)
  const [correctionError, setCorrectionError] = React.useState(null)
  const dictation = React.useRef(null)
  const onTextRef = React.useRef(onText)

  React.useEffect(() => {
    onTextRef.current = onText
  })

  React.useEffect(() => {
    let live = true
    speechSupport().then((found) => live && setSupport(found))
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
    const d = new Dictation({
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
        speechSupport().then(setSupport)
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
    release() // a final correction still running is dropped
    start()
  }, [release, start])

  return { support, listening, correcting, error, correctionError, start, release, toggle }
}
