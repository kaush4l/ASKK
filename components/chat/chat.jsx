"use client"

import * as React from "react"
import {
  ArrowUpIcon,
  BotIcon,
  CheckIcon,
  CodeIcon,
  ChevronRightIcon,
  MicIcon,
  MicOffIcon,
  SquareIcon,
  UserIcon,
  XIcon,
} from "lucide-react"

import { describeActivity } from "@/backend/core/activity"

import { EngineBar } from "@/components/chat/engine-bar"
import { ModelStats } from "@/components/chat/model-stats"
import { PromptPanel } from "@/components/chat/prompt-panel"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useEngineState, useEngines } from "@/hooks/use-engines"
import { useSpeechInput } from "@/hooks/use-speech"
import { cn } from "@/lib/utils"

// A collapsed section inside a reply: thoughts, structured fields, prompt.
function Detail({ label, children, mono = false }) {
  return (
    <Collapsible className="text-xs text-muted-foreground">
      <CollapsibleTrigger className="flex items-center gap-1 hover:text-foreground [&[data-panel-open]>svg]:rotate-90">
        <ChevronRightIcon className="size-3 transition-transform" />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent
        className={cn(
          "mt-1 max-h-80 overflow-auto border-l pl-3 whitespace-pre-wrap",
          mono && "font-mono text-[11px] leading-relaxed"
        )}
      >
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

function StructuredFields({ structured }) {
  return (
    <dl className="grid gap-1">
      {Object.entries(structured).map(([field, value]) => (
        <div key={field}>
          <dt className="text-foreground">{field}</dt>
          <dd>
            {Array.isArray(value)
              ? value.length
                ? value.map((item, i) => <div key={i}>{i + 1}. {item}</div>)
                : "[]"
              : value || "—"}
          </dd>
        </div>
      ))}
    </dl>
  )
}

// A tool result: one line saying whether the call succeeded, output on demand.
function ToolEvent({ message }) {
  const { name, kind, ok, skipped, stage, parallel, output } = message
  const target = name ? `${kind === "agent" ? "agent " : ""}${name}` : "unparsed call"
  const outcome = skipped ? "skipped" : ok ? "succeeded" : "failed"
  return (
    <div className="flex flex-col gap-1 pl-11 text-xs">
      <div
        className={cn(
          "flex min-w-0 items-center gap-1.5",
          ok || skipped ? "text-muted-foreground" : "text-destructive"
        )}
      >
        {ok ? <CheckIcon className="size-3.5 shrink-0" /> : <XIcon className="size-3.5 shrink-0" />}
        <span className="min-w-0 break-words">
          Tool call {outcome} · {target}
        </span>
        {stage && (
          <Badge variant="outline" className="shrink-0">
            {parallel ? `stage ${stage} · parallel` : `stage ${stage}`}
          </Badge>
        )}
      </div>
      {output && (
        <Detail label="Output">
          {output}
        </Detail>
      )}
    </div>
  )
}

// Live engine activity, shown while it works (also while working for another
// agent, and while it waits for the reports on quests it handed out).
function ActivityLine({ engine, activity }) {
  if (!activity || activity.phase === "idle") return null
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
      <span className="size-2 shrink-0 animate-pulse rounded-full bg-emerald-500" />
      <span className="min-w-0 truncate">
        {engine.name} · {describeActivity(activity)}
      </span>
      {activity.phase === "waiting" && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs pointer-coarse:h-10"
          onClick={() => engine.stop()}
        >
          Call back
        </Button>
      )}
    </div>
  )
}

// The summary that replaced an earlier log.
function SummaryMessage({ message }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-2xl border border-dashed px-4 py-3 text-sm">
      <span className="text-xs text-muted-foreground">
        Summary of {message.count ?? "earlier"} earlier messages
      </span>
      <p className="whitespace-pre-wrap">{message.content}</p>
      {message.archive && (
        <span className="text-xs break-all text-muted-foreground">Full log moved to {message.archive}</span>
      )}
    </div>
  )
}

function ChatMessage({ message, streaming }) {
  if (message.role === "tool") return <ToolEvent message={message} />
  if (message.role === "summary") return <SummaryMessage message={message} />

  const { role, content, raw, reasoning, structured, prompt, error, stopped, from } = message
  const isUser = role === "user"
  const waiting = streaming && !raw
  const toolStep = (message.action ?? structured?.action) === "tool"

  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <Avatar className="size-8">
        <AvatarFallback>
          {isUser ? <UserIcon className="size-4" /> : <BotIcon className="size-4" />}
        </AvatarFallback>
      </Avatar>
      <div
        className={cn(
          "flex max-w-[85%] min-w-0 flex-col gap-1.5 rounded-2xl px-4 py-2 text-sm",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted"
        )}
      >
        {reasoning && (
          <Detail label={waiting ? "Thinking…" : "Thoughts"}>{reasoning}</Detail>
        )}
        {waiting && !reasoning && <span className="text-muted-foreground">Thinking…</span>}

        {/* While streaming, show the raw structured text; once parsed, the response field. */}
        {streaming && raw && (
          <p className="whitespace-pre-wrap text-muted-foreground">{raw}</p>
        )}
        {from && <span className="text-xs opacity-70">from {from}</span>}
        {!streaming && content && !toolStep && <p className="whitespace-pre-wrap">{content}</p>}
        {!streaming && toolStep && (
          <p className="font-mono text-xs break-all whitespace-pre-wrap">{content}</p>
        )}
        {stopped && <span className="text-xs text-muted-foreground">Stopped</span>}
        {error && <span className="text-xs text-destructive">{error}</span>}

        {!isUser && !streaming && (structured || prompt) && (
          <div className="flex flex-col gap-1 border-t pt-1.5">
            {structured && (
              <Detail label="Structured response">
                <StructuredFields structured={structured} />
              </Detail>
            )}
            {prompt && (
              <Detail label="Prompt sent" mono>
                {prompt}
              </Detail>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyState({ engine, status }) {
  if (!engine) {
    return (
      <div className="flex flex-col items-center gap-2 py-24 text-center">
        <h2 className="text-lg">
          {status === "loading" ? "Starting agents…" : "No agent open"}
        </h2>
        {status === "ready" && (
          <p className="text-sm text-muted-foreground">Press + to open an agent.</p>
        )}
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <h2 className="text-lg">{engine.name}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{engine.description}</p>
      <div className="flex flex-wrap justify-center gap-1.5">
        {engine.tools.length ? (
          engine.tools.map((tool) => (
            <Badge key={tool.name} variant="outline">
              {tool.name}
            </Badge>
          ))
        ) : (
          <Badge variant="outline">no tools</Badge>
        )}
        <Badge variant="secondary">{engine.responseFormat}</Badge>
      </div>
    </div>
  )
}

// What a pending call will do, by tool.
function ApprovalDetail({ tool, inputs }) {
  const block = "max-h-48 overflow-auto rounded-md border p-2 font-mono text-xs whitespace-pre-wrap break-words"
  if (tool === "fs.write") {
    return (
      <>
        <p className="text-sm break-all">
          Write <span className="font-mono">{inputs.path}</span> ({inputs.text?.length ?? 0} characters)
        </p>
        <pre className={block}>{inputs.text}</pre>
      </>
    )
  }
  if (tool === "fs.edit") {
    return (
      <>
        <p className="text-sm break-all">
          Edit <span className="font-mono">{inputs.path}</span>
        </p>
        <pre className={cn(block, "text-destructive")} aria-label="Text to replace">{inputs.old}</pre>
        <pre className={cn(block, "text-emerald-600 dark:text-emerald-400")} aria-label="Replacement">{inputs.new}</pre>
      </>
    )
  }
  if (tool === "fs.delete") {
    return (
      <p className="text-sm break-all text-destructive">
        Delete <span className="font-mono">{inputs.path}</span>
        {inputs.recursive ? " and everything in it" : ""}
      </p>
    )
  }
  return <pre className={block}>{JSON.stringify(inputs, null, 2)}</pre>
}

// Tool calls waiting for the owner. The engine pauses until each is answered.
function Approvals({ engine, approvals }) {
  if (!approvals?.length) return null
  return (
    <div className="flex flex-col gap-2 pb-2">
      {approvals.map((approval) => (
        <section
          key={approval.id}
          aria-label={`Approve ${approval.tool}`}
          className="flex flex-col gap-2 rounded-lg border border-amber-500/60 p-3"
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="size-2 animate-pulse rounded-full bg-amber-500" />
            {engine.name} wants to run <span className="font-mono text-foreground">{approval.tool}</span>
          </div>
          <ApprovalDetail tool={approval.tool} inputs={approval.inputs ?? {}} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="pointer-coarse:h-10"
              onClick={() => engine.resolveApproval(approval.id, false)}
            >
              Decline
            </Button>
            <Button type="button" className="pointer-coarse:h-10" onClick={() => engine.resolveApproval(approval.id, true)}>
              Approve
            </Button>
          </div>
        </section>
      ))}
    </div>
  )
}

// Live dictation into the message box. Disabled, with the reason, where the
// browser cannot transcribe speech.
function MicButton({ speech, onToggle, disabled }) {
  const { support, listening } = speech
  if (!support) return null
  const unavailable = !support.supported
  const label = unavailable ? support.reason : listening ? "Stop dictation" : "Dictate (live transcription)"
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon"
            variant={listening ? "destructive" : "ghost"}
            className={cn("rounded-full pointer-coarse:size-10", listening && "animate-pulse")}
            onClick={onToggle}
            disabled={unavailable || disabled}
            aria-label={label}
            aria-pressed={listening}
          />
        }
      >
        {unavailable ? <MicOffIcon /> : <MicIcon />}
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function Chat() {
  const { engines, activeId, status } = useEngines()
  const engine = engines.find((e) => e.id === activeId) ?? null
  const state = useEngineState(engine)
  const messages = state?.messages ?? []
  const running = state?.status === "running"

  const [input, setInput] = React.useState("")
  const [showPrompt, setShowPrompt] = React.useState(false)
  const endRef = React.useRef(null)

  // Dictation goes after whatever was typed before it started.
  const dictationBase = React.useRef("")
  const speech = useSpeechInput({
    onText: (text) => setInput(dictationBase.current ? `${dictationBase.current} ${text}`.trimEnd() : text),
  })
  function toggleDictation() {
    if (!speech.listening) dictationBase.current = input.trimEnd()
    speech.toggle()
  }

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" })
  }, [messages])

  function send() {
    const text = input.trim()
    if (!text || running || !engine) return
    speech.release()
    dictationBase.current = ""
    setInput("")
    engine.send(text)
  }

  function onKeyDown(event) {
    // Enter sends, Shift+Enter inserts a newline; ignore IME composition.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send()
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EngineBar />

      <div className="flex min-h-0 flex-1">
        <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", showPrompt && "hidden lg:flex")}>
          <ScrollArea className="min-h-0 flex-1">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
              {messages.length === 0 ? (
                <EmptyState engine={engine} status={status} />
              ) : (
                messages.map((m, i) => (
                  <React.Fragment key={m.id}>
                    <ChatMessage
                      message={m}
                      streaming={running && i === messages.length - 1 && m.role === "assistant" && !m.structured}
                    />
                    {m.restored && !messages[i + 1]?.restored && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="h-px flex-1 bg-border" />
                        Restored from memory · {engine.memory.path}
                        <span className="h-px flex-1 bg-border" />
                      </div>
                    )}
                  </React.Fragment>
                ))
              )}
              <div ref={endRef} />
            </div>
          </ScrollArea>
    
          <form
            className="mx-auto w-full max-w-3xl p-4 pt-0"
            onSubmit={(event) => {
              event.preventDefault()
              send()
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 pb-2">
              <ActivityLine engine={engine} activity={state?.activity} />
              <div className="ml-auto flex min-w-0 items-center gap-1">
                <ModelStats engine={engine} state={state} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setShowPrompt((v) => !v)}
                  aria-pressed={showPrompt}
                  aria-label="Show prompt sent to the LLM"
                  title="Prompt sent to the LLM"
                  disabled={!engine}
                  className="aria-pressed:bg-muted pointer-coarse:size-10"
                >
                  <CodeIcon />
                </Button>
              </div>
            </div>
            <Approvals engine={engine} approvals={state?.approvals} />
            {speech.error && <p className="px-1 pb-2 text-xs text-destructive">{speech.error}</p>}
            {speech.correctionError && <p className="px-1 pb-2 text-xs text-destructive">{speech.correctionError}</p>}
            {(speech.listening || speech.correcting) && (
              <p className="px-1 pb-2 text-xs text-muted-foreground" aria-live="polite">
                {speech.correcting ? "Punctuating…" : "Listening · punctuation is added after each pause"}
              </p>
            )}
            {state?.memoryError && (
              <p className="px-1 pb-2 text-xs text-destructive">{state.memoryError}</p>
            )}
            {state?.error?.startsWith("Summarize failed") && (
              <p className="px-1 pb-2 text-xs text-destructive">{state.error}</p>
            )}
            <div className="relative">
              <Textarea
                value={input}
                onChange={(event) => {
                  // Typing takes over from dictation.
                  if (speech.listening || speech.correcting) speech.release()
                  setInput(event.target.value)
                }}
                onKeyDown={onKeyDown}
                disabled={!engine}
                placeholder={
                  speech.listening ? "Listening…" : engine ? `Message ${engine.name}…` : "Open an agent to chat"
                }
                aria-label="Message"
                className="max-h-48 min-h-12 resize-none pr-22 pointer-coarse:pr-24 dark:bg-transparent"
              />
              <div className="absolute right-12 bottom-2 pointer-coarse:right-14">
                <MicButton speech={speech} onToggle={toggleDictation} disabled={!engine} />
              </div>
              {running ? (
                <Button
                  type="button"
                  size="icon"
                  className="absolute right-2 bottom-2 rounded-full pointer-coarse:size-10"
                  onClick={() => engine.stop()}
                  aria-label="Stop"
                >
                  <SquareIcon className="fill-current" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon"
                  className="absolute right-2 bottom-2 rounded-full pointer-coarse:size-10"
                  disabled={!input.trim() || !engine}
                  aria-label="Send"
                >
                  <ArrowUpIcon />
                </Button>
              )}
            </div>
          </form>
        </div>
        {showPrompt && engine && (
          <PromptPanel
            engine={engine}
            messages={messages}
            input={input}
            onClose={() => setShowPrompt(false)}
            className="flex-1 lg:w-[min(44rem,50%)] lg:flex-none lg:border-l"
          />
        )}
      </div>
    </div>
  )
}
