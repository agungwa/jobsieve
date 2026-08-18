import { useEffect, useRef, useState } from "react";
import {
  api,
  getActiveCvId,
  getGlmBaseUrl,
  getGlmKey,
  getGlmModel,
  setGlmBaseUrl,
  setGlmKey,
  setGlmModel,
  type ChatReply,
} from "../api";

interface Message {
  role: "user" | "ai";
  text: string;
  flags?: string;
}

/** All models confirmed available on Z.ai (queried from /models endpoint). */
const MODELS = [
  "glm-4.5-air",
  "glm-4.5",
  "glm-4.6",
  "glm-4.7",
  "glm-5-turbo",
  "glm-5",
  "glm-5.1",
  "glm-5.2",
  "glm-5.3",
];
const ENDPOINTS = [
  { value: "https://api.z.ai/api/anthropic", label: "Coding Plan · Z.ai" },
  { value: "https://open.bigmodel.cn/api/anthropic", label: "Coding Plan · BigModel" },
  { value: "https://api.z.ai/api/paas/v4", label: "API balance · Z.ai" },
  { value: "https://open.bigmodel.cn/api/paas/v4", label: "API balance · BigModel" },
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cvId, setCvId] = useState<string | null>(getActiveCvId());
  const logRef = useRef<HTMLDivElement>(null);

  // Bring-your-own-key state (localStorage only).
  const [showKeyPanel, setShowKeyPanel] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [modelDraft, setModelDraft] = useState(getGlmModel() ?? "glm-4.5-air");
  const [endpointDraft, setEndpointDraft] = useState(
    getGlmBaseUrl() ?? ENDPOINTS[0]!.value,
  );
  const [byokActive, setByokActive] = useState(!!getGlmKey());

  useEffect(() => {
    setCvId(getActiveCvId());
    document.title = "AI career assistant — Jobsieve";
    return () => { document.title = "Jobsieve — Remote tech jobs, matched to your CV"; };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  function saveKey(e: React.FormEvent) {
    e.preventDefault();
    setGlmKey(keyDraft.trim() || null);
    setGlmModel(modelDraft);
    setGlmBaseUrl(endpointDraft);
    setByokActive(!!getGlmKey());
    setKeyDraft("");
    setShowKeyPanel(false);
  }

  function clearKey() {
    setGlmKey(null);
    setByokActive(false);
    setKeyDraft("");
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const message = input.trim();
    if (!message || pending) return;
    setInput("");
    setError(null);
    setMessages((m) => [...m, { role: "user", text: message }]);
    setPending(true);
    try {
      const headers: Record<string, string> = {};
      const key = getGlmKey();
      const model = getGlmModel();
      const baseUrl = getGlmBaseUrl();
      if (key) {
        headers["x-glm-key"] = key;
        if (model) headers["x-glm-model"] = model;
        if (baseUrl) headers["x-glm-base-url"] = baseUrl;
      }
      const reply = await api<ChatReply>("/chat", {
        method: "POST",
        headers: Object.keys(headers).length ? headers : undefined,
        body: cvId ? { cv_id: cvId, message } : { message },
      });
      const flags = [
        reply.byok ? "your key" : null,
        reply.cached ? "cached" : null,
        reply.model,
        reply.usage ? `${reply.usage.promptTokens + reply.usage.completionTokens} tokens` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      setMessages((m) => [...m, { role: "ai", text: reply.reply, flags }]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <div className="card">
        <div className="row-between">
          <div>
            <strong style={{ fontSize: 15 }}>Ask about jobs</strong>
            <div className="muted" style={{ fontSize: 13 }}>
              {cvId
                ? "Your uploaded CV is used as context."
                : "Upload a CV on the Jobs page for personalized answers."}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {byokActive && <span className="pill pill-remote">own AI key ✓</span>}
            <button
              className="ghost"
              style={{ padding: "6px 12px", fontSize: 12 }}
              onClick={() => setShowKeyPanel((v) => !v)}
            >
              {byokActive ? "Manage AI key" : "Use your own AI key"}
            </button>
          </div>
        </div>

        {showKeyPanel && (
          <form style={{ marginTop: 12 }} onSubmit={saveKey}>
            <div className="filters-inline">
              <input
                type="password"
                placeholder="Z.ai / BigModel API key (id.secret)"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                style={{ flex: 2 }}
              />
              <select value={modelDraft} onChange={(e) => setModelDraft(e.target.value)}>
                {MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <button type="submit" className="ghost">Save</button>
              {byokActive && (
                <button type="button" className="ghost" onClick={clearKey}>Remove</button>
              )}
            </div>
            <div className="filters-inline" style={{ marginTop: 8 }}>
              <label className="muted" style={{ fontSize: 12 }}>Endpoint:</label>
              {ENDPOINTS.map((ep) => (
                <label key={ep.value} className="check-row" style={{ fontSize: 12 }}>
                  <input
                    type="radio"
                    name="glm-endpoint"
                    checked={endpointDraft === ep.value}
                    onChange={() => setEndpointDraft(ep.value)}
                  />
                  {ep.label}
                </label>
              ))}
            </div>
          </form>
        )}
        <p className="faint" style={{ fontSize: 12, margin: byokActive ? "8px 0 0" : 0 }}>
          🔒 Your API key is stored only in your browser (localStorage) and sent
          only with your own chat requests. We never store it on our servers or
          logs. Without a key, a shared key is used with a daily message limit.
        </p>
      </div>

      <div className="card">
        <div className="chat-log" ref={logRef}>
          {messages.length === 0 && (
            <p className="muted">e.g. "What jobs am I a good fit for?"</p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`chat-msg ${m.role}`}>
              {m.text}
              {m.flags && <div className="flags">{m.flags}</div>}
            </div>
          ))}
          {pending && <div className="muted">thinking…</div>}
        </div>
        {error && <p className="error-text">{error}</p>}
        <form className="filters-inline" onSubmit={send}>
          <input
            type="text"
            placeholder="Your question…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={pending}
            style={{ flex: 1 }}
          />
          <button type="submit" disabled={pending || !input.trim()}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
