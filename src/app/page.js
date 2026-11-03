"use client";

// Home — the main screen is the chat. Skeleton only: one user query in,
// one LLM reply out, no loop, no streaming.
//
// Desk state is the source of truth and lives on the server in
// personal/ (instructions.md, model.json, .env). On load the client
// asks GET /api/desk: if a default inference is present, the chat
// loads with it already selected and the user can talk immediately.
// If NO model is present, the screen asks for a default first: enter
// a provider and endpoint, fetch models, pick one, save — and Save
// persists between restarts, because it writes personal/model.json
// on the server (and, when a key is given, personal/.env), not just
// browser storage. The picker stays available after a default
// exists, to add another provider or make another entry the default
// (making default = moving that entry to the front of model.json).
// Keys are never returned by any API route and never shown back.
// Instructions always come from personal/instructions.md on the
// server; the client never sends them. The only browser storage left
// is the currently-selected inference id for this session.
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const SELECTED_KEY = "askk:selectedInference";

export default function Home() {
  const [desk, setDesk] = useState(null);
  const [deskLoading, setDeskLoading] = useState(true);
  const [provider, setProvider] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState([]);
  const [model, setModel] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadDesk = useCallback(async () => {
    setDeskLoading(true);
    try {
      const response = await fetch("/api/desk");
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "desk request failed");
      }
      setDesk(body);
      const savedSelected = localStorage.getItem(SELECTED_KEY) ?? "";
      const nextSelected = body.inferences.some(
        (entry) => entry.id === savedSelected,
      )
        ? savedSelected
        : (body.defaultInference?.id ?? "");
      setSelectedId(nextSelected);
    } catch (err) {
      setError(err.message);
    } finally {
      setDeskLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDesk();
  }, [loadDesk]);

  function selectInference(id) {
    setSelectedId(id);
    localStorage.setItem(SELECTED_KEY, id);
  }

  async function fetchModels() {
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const response = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint, apiKey, provider }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "models request failed");
      }
      setModels(body.models);
      if (body.models.length > 0 && !body.models.includes(model)) {
        setModel(body.models[0]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function saveInference() {
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const response = await fetch("/api/inferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, endpoint, model, apiKey }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "save failed");
      }
      setNotice(
        `Saved ${body.inference.provider} / ${body.inference.model} to personal/model.json. It survives restarts.`,
      );
      setApiKey("");
      await loadDesk();
      selectInference(body.inference.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function makeDefault(id) {
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/inferences/default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "make default failed");
      }
      setNotice(
        `Default is now ${body.defaultInference.provider} / ${body.defaultInference.model}.`,
      );
      await loadDesk();
      selectInference(id);
    } catch (err) {
      setError(err.message);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) {
      return;
    }
    if (!selectedId) {
      setError("Add a default model first, below.");
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
          inferenceId: selectedId,
          messages: nextMessages,
        }),
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
    }
  }

  const selected = desk?.inferences.find((entry) => entry.id === selectedId);

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
          <h2 className="text-sm font-semibold">Models</h2>
          {deskLoading && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Loading desk…
            </p>
          )}
          {!deskLoading && desk && !desk.hasDefault && (
            <p className="text-sm font-medium">
              No model yet — add a default below, then you can talk.
            </p>
          )}
          {!deskLoading && desk?.hasDefault && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Default: {desk.defaultInference.provider} /{" "}
              {desk.defaultInference.model}
              {selected
                ? ` — chatting with ${selected.provider} / ${selected.model}`
                : ""}
            </p>
          )}
          {!deskLoading && desk?.inferences.length > 0 && (
            <ul className="flex flex-col gap-2">
              {desk.inferences.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  <span className="flex-1">
                    {entry.provider} / {entry.model}
                    <span className="text-zinc-500"> — {entry.endpoint}</span>
                  </span>
                  <Button
                    variant="outline"
                    onClick={() => selectInference(entry.id)}
                    disabled={selectedId === entry.id}
                  >
                    {selectedId === entry.id ? "Selected" : "Select"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => makeDefault(entry.id)}
                    disabled={desk.defaultInference?.id === entry.id}
                  >
                    Make default
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <h3 className="text-sm font-semibold">Add an inference</h3>
          <label htmlFor="provider" className="flex flex-col gap-1 text-sm">
            Provider
            <Input
              id="provider"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              placeholder="ollama"
            />
          </label>
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
            API key (optional — saved to personal/.env, never to model.json)
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
            <Button
              onClick={saveInference}
              disabled={!provider || !endpoint || !model || loading}
            >
              Save
            </Button>
          </div>
          {notice && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{notice}</p>
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
