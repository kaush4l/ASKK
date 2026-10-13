"use client"

import * as React from "react"
import { SendIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function TypeBox({ model, disabled }) {
  const [text, setText] = React.useState("")
  return (
    <form
      className="flex w-full max-w-md gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!text.trim()) return
        model.send(text.trim())
        setText("")
      }}
    >
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Or type to the lead"
        className="text-base md:text-sm"
        disabled={disabled}
        aria-label="Type a message to the lead"
      />
      <Button
        type="submit"
        size="icon-lg"
        variant="outline"
        disabled={disabled || !text.trim()}
        aria-label="Send"
        className="pointer-coarse:size-10"
      >
        <SendIcon />
      </Button>
    </form>
  )
}
