// API client — all calls go through Next.js proxy to FastAPI backend

import { ApiKeys, Document, Message, Session, Source, MemoryItem, SystemStats } from "./types";

const API_BASE = "/api/backend";

function buildHeaders(keys: Partial<ApiKeys>): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (keys.gemini) headers["X-Gemini-Key"] = keys.gemini;
  if (keys.groq) headers["X-Groq-Key"] = keys.groq;
  if (keys.openrouter) headers["X-OpenRouter-Key"] = keys.openrouter;
  return headers;
}

export function parseErrorMessage(err: unknown, fallback: string): string {
  if (!err) return fallback;
  if (typeof err === "string") {
    if (
      err === "Internal Server Error" ||
      err === "Bad Gateway" ||
      err === "Service Unavailable" ||
      err.includes("ECONNREFUSED") ||
      err.includes("fetch failed")
    ) {
      return "Backend server is offline or unreachable on http://127.0.0.1:8000. Please start the FastAPI backend server.";
    }
    return err;
  }
  if (err instanceof Error) {
    if (
      err.message === "Internal Server Error" ||
      err.message === "Bad Gateway" ||
      err.message.includes("ECONNREFUSED") ||
      err.message.includes("fetch failed")
    ) {
      return "Backend server is offline or unreachable on http://127.0.0.1:8000. Please start the FastAPI backend server.";
    }
    return err.message;
  }
  if (typeof err === "object" && "detail" in err) {
    const detail = (err as { detail: unknown }).detail;
    if (typeof detail === "string") {
      if (
        detail === "Internal Server Error" ||
        detail === "Bad Gateway" ||
        detail === "Service Unavailable" ||
        detail.includes("ECONNREFUSED")
      ) {
        return "Backend server is offline or unreachable on http://127.0.0.1:8000. Please start the FastAPI backend server.";
      }
      return detail;
    }
    if (Array.isArray(detail)) {
      return detail.map((d: { msg?: string }) => d.msg || JSON.stringify(d)).join(", ");
    }
    return JSON.stringify(detail);
  }
  return fallback;
}

async function handleResponse<T>(res: Response, fallbackError: string): Promise<T> {
  if (!res.ok) {
    let errBody: unknown;
    try {
      errBody = await res.json();
    } catch {
      errBody = res.statusText || `HTTP ${res.status}`;
    }

    if (
      res.status >= 500 &&
      (res.statusText === "Internal Server Error" ||
        res.statusText === "Bad Gateway" ||
        res.statusText === "Service Unavailable" ||
        typeof errBody === "string")
    ) {
      throw new Error(
        "Backend server is offline or unreachable on http://127.0.0.1:8000. Please start the FastAPI backend server (python backend/main.py)."
      );
    }

    throw new Error(parseErrorMessage(errBody, fallbackError));
  }
  return res.json() as Promise<T>;
}

// ── Health Check ───────────────────────────────────────────────────────────

export async function checkBackendHealth(): Promise<{
  status: string;
  neural_models_ready: boolean;
  service: string;
}> {
  try {
    const res = await fetch(`${API_BASE}/health`, { cache: "no-store" });
    return await handleResponse(res, "Backend is unreachable. Please verify the backend server is running.");
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Backend is unreachable. Please verify the backend server is running."));
  }
}

// ── Sessions ───────────────────────────────────────────────────────────────

export async function createSession(title: string = "New Conversation"): Promise<string> {
  try {
    const res = await fetch(`${API_BASE}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const data = await handleResponse<{ session_id: string; title: string }>(res, "Failed to create session");
    return data.session_id;
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Failed to create session"));
  }
}

export async function listSessions(): Promise<Session[]> {
  try {
    const res = await fetch(`${API_BASE}/sessions`, { cache: "no-store" });
    return await handleResponse<Session[]>(res, "Failed to fetch sessions");
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Failed to fetch sessions"));
  }
}

export async function getSession(sessionId: string): Promise<Session> {
  try {
    const res = await fetch(`${API_BASE}/sessions/${sessionId}`);
    return await handleResponse<Session>(res, "Failed to fetch session");
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Failed to fetch session"));
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/sessions/${sessionId}`, { method: "DELETE" });
    await handleResponse<{ status: string }>(res, "Failed to delete session");
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Failed to delete session"));
  }
}
export async function getMessages(sessionId: string): Promise<Message[]> {
  try {
    const res = await fetch(`${API_BASE}/sessions/${sessionId}/messages`);
    return await handleResponse<Message[]>(res, "Failed to fetch messages");
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Failed to fetch messages"));
  }
}


export async function getStats(): Promise<SystemStats> {
  try {
    const res = await fetch(`${API_BASE}/stats`, { cache: "no-store" });
    return await handleResponse<SystemStats>(res, "Failed to fetch platform stats");
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Failed to fetch platform stats"));
  }
}

export async function renameSession(sessionId: string, title: string): Promise<string> {
  try {
    const res = await fetch(`${API_BASE}/sessions/${sessionId}/title`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const data = await handleResponse<{ session_id: string; title: string }>(res, "Failed to rename session");
    return data.title;
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Failed to rename session"));
  }
}

export async function deleteAllSessions(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/sessions`, { method: "DELETE" });
    await handleResponse<{ status: string }>(res, "Failed to delete all sessions");
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Failed to delete all sessions"));
  }
}

export async function listAllMemories(): Promise<MemoryItem[]> {
  try {
    const res = await fetch(`${API_BASE}/memory`, { cache: "no-store" });
    return await handleResponse<MemoryItem[]>(res, "Failed to fetch global memories");
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Failed to fetch global memories"));
  }
}

export async function deleteMemoryItem(memoryId: string): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/memory/${memoryId}`, { method: "DELETE" });
    await handleResponse<{ status: string; memory_id: string }>(res, "Failed to delete memory item");
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Failed to delete memory item"));
  }
}

export async function clearAllMemories(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/memory`, { method: "DELETE" });
    await handleResponse<{ status: string }>(res, "Failed to clear global memories");
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Failed to clear global memories"));
  }
}

// ── Session Documents ──────────────────────────────────────────────────────

export async function uploadDocumentToSession(
  sessionId: string,
  file: File,
  keys: Partial<ApiKeys>
): Promise<Document> {
  try {
    const formData = new FormData();
    formData.append("file", file);

    const headers: Record<string, string> = {};
    if (keys.gemini) headers["X-Gemini-Key"] = keys.gemini;
    if (keys.groq) headers["X-Groq-Key"] = keys.groq;
    if (keys.openrouter) headers["X-OpenRouter-Key"] = keys.openrouter;

    const res = await fetch(`${API_BASE}/sessions/${sessionId}/documents`, {
      method: "POST",
      headers,
      body: formData,
    });

    return await handleResponse<Document>(res, "Document upload failed");
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Document upload failed"));
  }
}

export async function listSessionDocuments(sessionId: string): Promise<Document[]> {
  try {
    const res = await fetch(`${API_BASE}/sessions/${sessionId}/documents`);
    return await handleResponse<Document[]>(res, "Failed to fetch session documents");
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Failed to fetch session documents"));
  }
}

export async function deleteDocument(docId: string): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/documents/${docId}`, { method: "DELETE" });
    await handleResponse<{ status: string; session_id: string }>(res, "Failed to delete document");
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Failed to delete document"));
  }
}

// ── Chat (Streaming with Global Memory & Sources) ───────────────────────────

export interface ChatStreamCallbacks {
  onToken: (token: string) => void;
  onSources?: (sources: Source[]) => void;
  onMemoryRecalled?: (memories: MemoryItem[]) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

export async function sendMessage(
  sessionId: string,
  message: string,
  keys: Partial<ApiKeys>,
  callbacks: ChatStreamCallbacks
): Promise<void> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (keys.gemini) headers["X-Gemini-Key"] = keys.gemini;
    if (keys.groq) headers["X-Groq-Key"] = keys.groq;
    if (keys.openrouter) headers["X-OpenRouter-Key"] = keys.openrouter;

    const res = await fetch(`${API_BASE}/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({ session_id: sessionId, message }),
    });

    if (!res.ok) {
      let errBody: unknown;
      try {
        errBody = await res.json();
      } catch {
        errBody = res.statusText;
      }
      callbacks.onError(parseErrorMessage(errBody, `Chat request failed (${res.status})`));
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      callbacks.onError("No stream response available from server");
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === "token") callbacks.onToken(event.content);
          else if (event.type === "sources") callbacks.onSources?.(event.sources);
          else if (event.type === "memory_recalled") callbacks.onMemoryRecalled?.(event.memories);
          else if (event.type === "done") callbacks.onDone();
          else if (event.type === "error") callbacks.onError(event.message || "Streaming error");
        } catch {
          // ignore malformed lines
        }
      }
    }
  } catch (err) {
    callbacks.onError(
      parseErrorMessage(err, "Connection error: Unable to reach backend server. Please check your network or server status.")
    );
  }
}

// ── Summarize Session Documents (Streaming) ────────────────────────────────

export async function summarizeSession(
  sessionId: string,
  keys: Partial<ApiKeys>,
  callbacks: ChatStreamCallbacks
): Promise<void> {
  try {
    const headers: Record<string, string> = {};
    if (keys.gemini) headers["X-Gemini-Key"] = keys.gemini;
    if (keys.groq) headers["X-Groq-Key"] = keys.groq;
    if (keys.openrouter) headers["X-OpenRouter-Key"] = keys.openrouter;

    const res = await fetch(`${API_BASE}/sessions/${sessionId}/summarize`, {
      method: "POST",
      headers,
    });

    if (!res.ok) {
      let errBody: unknown;
      try {
        errBody = await res.json();
      } catch {
        errBody = res.statusText;
      }
      callbacks.onError(parseErrorMessage(errBody, `Summarization failed (${res.status})`));
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      callbacks.onError("No stream response available from server");
      return;
    }

    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          if (ev.type === "token") callbacks.onToken(ev.content);
          else if (ev.type === "done") callbacks.onDone();
          else if (ev.type === "error") callbacks.onError(ev.message || "Summarization stream error");
        } catch {
          // ignore
        }
      }
    }
  } catch (err) {
    callbacks.onError(
      parseErrorMessage(err, "Connection error: Unable to reach backend server. Please verify the backend is running.")
    );
  }
}
