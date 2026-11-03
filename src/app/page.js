"use client";

// Home — the main screen is the chat. Skeleton only: one user query in,
// one LLM reply out, no loop, no streaming.
//
// The model picker has been removed from this screen: the models
// store (personal/model.json, via the desk) is now the source of
// truth, and the picker will be re-added improved later. The user
// manages models in the file for now. If no model is present, the
// screen says so plainly and Send stays disabled — it does not show
// a picker. The server routes for models/inferences still exist,
// they are just unused by this UI for now.
//
// The live engine object (src/components/engine-live.jsx) loads on
// page load and refreshes after every chat reply, from GET
// /api/engine: engine model id, provider, endpoint, instructions
// preview, desk default status, inference count, and the session
// message count. No keys, no secrets. Instructions always come from
// personal/instructions.md on the server; the client never sends
// them.
import { useCallback, useEffect, useState } from "react";
import EngineLive from "@/components/engine-live";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function Home() {
  const [live, setLive] = useState(null);
  const [liveLoading, setLiveLoading] = useState(true);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadLive = useCallback(async () => {
    try {
      const response = await fetch("/api/engine");
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "engine request failed");
      }
      setLive(body);
    } catch (err) {
      setError(err.message);
    } finally {
      setLiveLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLive();
  }, [loadLive]);

  async function send() {
    const text = input.trim();
    if (!text || loading || !live?.hasDefault) {
      return;
    }
    setError("");
    const nextMessages = [
      ...messages,
      { id: crypto.randomUUID(), role: "user", content: text },
    ];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "chat request failed");
      }
      setMessages([
        ...nextMessages,
        { id: crypto.randomUUID(), role: "assistant", content: body.reply },
      ]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      await loadLive();
    }
  }

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col gap-6 px-6 py-10">
        <div className="flex items-baseline justify-between">
          <span className="text-xl font-semibold tracking-tight text-black dark:text-zinc-50">
            ASKK
          </span>
          <a
            href="/showcase"
            className="text-sm font-medium text-zinc-600 dark:text-zinc-400"
          >
            Components showcase
          </a>
        </div>

        <EngineLive live={live} messageCount={messages.length} />

        {!liveLoading && live && !live.hasDefault && (
          <p className="text-sm font-medium">
            No model configured — add an entry to personal/model.json
          </p>
        )}

        <section className="flex flex-1 flex-col gap-3">
          {messages.length === 0 && (
            <p className="text-zinc-600 dark:text-zinc-400">
              Say something — the reply comes from the desk default model.
            </p>
          )}
          {messages.map((message) => (
            <div
              key={message.id}
              className={`max-w-[85%] rounded-xl px-4 py-2 text-sm leading-6 whitespace-pre-wrap ${
                message.role === "user"
                  ? "self-end bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                  : "self-start bg-white text-zinc-900 border border-zinc-200 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
              }`}
            >
              {message.content}
            </div>
          ))}
          {loading && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Thinking…
            </p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </section>

        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            placeholder="Type a message"
          />
          <Button
            onClick={send}
            disabled={!input.trim() || loading || !live?.hasDefault}
          >
            Send
          </Button>
        </div>
      </main>
    </div>
  );
}
