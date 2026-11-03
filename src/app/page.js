"use client";

// Home — the main screen is the chat. Skeleton only: one user query in,
// one LLM reply out, no loop, no streaming.
//
// Model picker: enter an OpenAI-compatible endpoint, optionally an API
// key, fetch the models list from that server, pick a model, save.
// Saved endpoint, model, and key live in browser localStorage only —
// they are never written to the repo. Instructions always come from
// personal/instructions.md on the server; the client never sends them.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const STORAGE_KEYS = {
  endpoint: "askk:endpoint",
  apiKey: "askk:apiKey",
  model: "askk:model",
};

export default function Home() {
  const [endpoint, setEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState([]);
  const [saved, setSaved] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const savedEndpoint = localStorage.getItem(STORAGE_KEYS.endpoint) ?? "";
    const savedKey = localStorage.getItem(STORAGE_KEYS.apiKey) ?? "";
    const savedModel = localStorage.getItem(STORAGE_KEYS.model) ?? "";
    setEndpoint(savedEndpoint);
    setApiKey(savedKey);
    setModel(savedModel);
    setSaved(Boolean(savedEndpoint && savedModel));
  }, []);

  async function fetchModels() {
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint, apiKey }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "models request failed");
      }
      setModels(body.models);
      if (body.models.length > 0 && !body.models.includes(model)) {
        setModel(body.models[0]);
      }
      setSaved(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function saveSettings() {
    localStorage.setItem(STORAGE_KEYS.endpoint, endpoint);
    localStorage.setItem(STORAGE_KEYS.apiKey, apiKey);
    localStorage.setItem(STORAGE_KEYS.model, model);
    setSaved(true);
    setError("");
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) {
      return;
    }
    if (!endpoint || !model) {
      setError("Pick a model and save it first.");
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
        body: JSON.stringify({
          endpoint,
          apiKey,
          model,
          messages: nextMessages,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "chat request failed");
      }
      setMessages([
        ...nextMessages,
        { role: "assistant", content: body.reply },
      ]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
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

        <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="text-sm font-semibold">Model</h2>
          <label htmlFor="endpoint" className="flex flex-col gap-1 text-sm">
            Endpoint
            <Input
              id="endpoint"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="http://localhost:11434/v1"
            />
          </label>
          <label htmlFor="api-key" className="flex flex-col gap-1 text-sm">
            API key (optional)
            <Input
              id="api-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Leave empty for a local server"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={fetchModels}
              disabled={!endpoint || loading}
              variant="outline"
            >
              Fetch models
            </Button>
            <select
              className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              disabled={models.length === 0}
            >
              {models.length === 0 ? (
                <option value="">Fetch models first</option>
              ) : (
                models.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))
              )}
            </select>
            <Button onClick={saveSettings} disabled={!endpoint || !model}>
              Save
            </Button>
          </div>
          {saved && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Saved in this browser. Now you can talk to the model.
            </p>
          )}
        </section>

        <section className="flex flex-1 flex-col gap-3">
          {messages.length === 0 && (
            <p className="text-zinc-600 dark:text-zinc-400">
              Say something — the reply comes from the model you picked above.
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
          <Button onClick={send} disabled={!input.trim() || loading}>
            Send
          </Button>
        </div>
      </main>
    </div>
  );
}
