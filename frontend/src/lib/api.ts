// API client — all calls go through Next.js proxy or direct backend URL

import { ApiKeys, Document, Message, Session, Source, MemoryItem, SystemStats, KeyStatus, HealthStatus, SharedSession } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_DIRECT_API === "true" && process.env.NEXT_PUBLIC_BACKEND_URL
  ? `${process.env.NEXT_PUBLIC_BACKEND_URL.replace(/\/+$/, "").replace(/\/api$/, "")}/api`
  : "/api/backend";

function getUserHeaders(): Record<string, string> {
  if (typeof document === "undefined") return {};
  try {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; docmind_user=`);
    if (parts.length === 2) {
      const val = parts.pop()?.split(";").shift();
      if (val) {
        const user = JSON.parse(decodeURIComponent(val));
        if (user && user.id) {
          return {
            "X-User-Id": user.id,
            "X-User-Email": user.email || "guest@docmind.local",
            "X-User-Name": user.name || "Guest User",
          };
        }
      }
    }
  } catch {
    // ignore parsing errors
  }
  return {};
}

function buildHeaders(keys?: Partial<ApiKeys>): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getUserHeaders(),
  };
  if (keys?.gemini) headers["X-Gemini-Key"] = keys.gemini;
  if (keys?.groq) headers["X-Groq-Key"] = keys.groq;
  if (keys?.openrouter) headers["X-OpenRouter-Key"] = keys.openrouter;
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
      return "Backend server is offline or unreachable. Please verify the FastAPI backend server is running.";
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
      return "Backend server is offline or unreachable. Please verify the FastAPI backend server is running.";
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
        return "Backend server is offline or unreachable. Please verify the FastAPI backend server is running.";
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

async function fetchWithRetry(url: string, options?: RequestInit, retries = 2, delayMs = 300): Promise<Response> {
  const mergedHeaders = {
    ...getUserHeaders(),
    ...(options?.headers ? Object.fromEntries(new Headers(options.headers).entries()) : {}),
  };
  const finalOptions: RequestInit = {
    ...options,
    headers: mergedHeaders,
  };
  try {
    const res = await fetch(url, finalOptions);
    if ((res.status === 503 || res.status === 502) && retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return fetchWithRetry(url, options, retries - 1, delayMs * 1.5);
    }
    // If direct backend request is rate-limited (429) or fails with 502/503/504,
    // immediately attempt fallback via Next.js server proxy (runs server-to-server)
    if (
      (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) &&
      API_BASE !== "/api/backend" &&
      url.startsWith(API_BASE)
    ) {
      try {
        const proxyUrl = url.replace(API_BASE, "/api/backend");
        const proxyRes = await fetch(proxyUrl, finalOptions);
        if (proxyRes.ok || proxyRes.status !== 429) {
          return proxyRes;
        }
      } catch {
        // preserve original response if proxy also errors
      }
    }
    return res;
  } catch (err) {
    if (retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return fetchWithRetry(url, options, retries - 1, delayMs * 1.5);
    }
    // Fallback to Next.js server proxy if direct backend request failed (e.g. CORS or network error)
    if (API_BASE !== "/api/backend" && url.startsWith(API_BASE)) {
      try {
        const proxyUrl = url.replace(API_BASE, "/api/backend");
        return await fetch(proxyUrl, finalOptions);
      } catch {
        // preserve original error
      }
    }
    throw err;
  }
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
        "Backend server is offline or unreachable. Please verify the FastAPI backend is active."
      );
    }

    throw new Error(parseErrorMessage(errBody, fallbackError));
  }
  return res.json() as Promise<T>;
}

// ── Secure API Keys Management ─────────────────────────────────────────────

export async function fetchKeyStatus(): Promise<KeyStatus> {
  try {
    const res = await fetch("/api/keys", { cache: "no-store" });
    if (!res.ok) {
      return {
        gemini_configured: false,
        groq_configured: false,
        openrouter_configured: false,
        has_custom_keys: false,
        has_server_keys: false,
      };
    }
    return await res.json();
  } catch {
    return {
      gemini_configured: false,
      groq_configured: false,
      openrouter_configured: false,
      has_custom_keys: false,
      has_server_keys: false,
    };
  }
}

export async function saveSecureKeys(keys: Partial<ApiKeys>): Promise<void> {
  try {
    const res = await fetch("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(keys),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to save secure keys");
    }
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Failed to store API keys securely"));
  }
}

export async function clearSecureKeys(): Promise<void> {
  try {
    await fetch("/api/keys", { method: "DELETE" });
  } catch {
    // ignore
  }
}

// ── Health Check ───────────────────────────────────────────────────────────

export async function checkBackendHealth(): Promise<HealthStatus> {
  try {
    const res = await fetchWithRetry(`${API_BASE}/health`, { cache: "no-store" });
    return await handleResponse<HealthStatus>(res, "Backend is unreachable. Please verify the backend server is running.");
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Backend is unreachable. Please verify the backend server is running."));
  }
}

// ── Sessions ───────────────────────────────────────────────────────────────

export async function createSession(title: string = "New Conversation"): Promise<string> {
  try {
    const res = await fetchWithRetry(`${API_BASE}/sessions`, {
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
    const res = await fetchWithRetry(`${API_BASE}/sessions`, { cache: "no-store" });
    return await handleResponse<Session[]>(res, "Failed to fetch sessions");
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Failed to fetch sessions"));
  }
}

export async function getSession(sessionId: string): Promise<Session> {
  try {
    const res = await fetchWithRetry(`${API_BASE}/sessions/${sessionId}`);
    return await handleResponse<Session>(res, "Failed to fetch session");
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Failed to fetch session"));
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  try {
    const res = await fetchWithRetry(`${API_BASE}/sessions/${sessionId}`, { method: "DELETE" });
    await handleResponse<{ status: string }>(res, "Failed to delete session");
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Failed to delete session"));
  }
}

export async function getMessages(sessionId: string): Promise<Message[]> {
  try {
    const res = await fetchWithRetry(`${API_BASE}/sessions/${sessionId}/messages`);
    return await handleResponse<Message[]>(res, "Failed to fetch messages");
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Failed to fetch messages"));
  }
}

export async function getStats(): Promise<SystemStats> {
  try {
    const res = await fetchWithRetry(`${API_BASE}/stats`, { cache: "no-store" });
    return await handleResponse<SystemStats>(res, "Failed to fetch platform stats");
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Failed to fetch platform stats"));
  }
}

export async function renameSession(sessionId: string, title: string): Promise<string> {
  try {
    const res = await fetchWithRetry(`${API_BASE}/sessions/${sessionId}/title`, {
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
    const res = await fetchWithRetry(`${API_BASE}/sessions`, { method: "DELETE" });
    await handleResponse<{ status: string }>(res, "Failed to delete all sessions");
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Failed to delete all sessions"));
  }
}

// ── Shareable Chat Links ───────────────────────────────────────────────────

export async function createShareLink(sessionId: string): Promise<{
  session_id: string;
  share_token: string;
  share_url: string;
  shared_at: string;
  is_shared: boolean;
}> {
  try {
    const res = await fetchWithRetry(`${API_BASE}/sessions/${sessionId}/share`, {
      method: "POST",
    });
    return await handleResponse(res, "Failed to create share link");
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Failed to create share link"));
  }
}

export async function revokeShareLink(sessionId: string): Promise<{
  session_id: string;
  is_shared: boolean;
}> {
  try {
    const res = await fetchWithRetry(`${API_BASE}/sessions/${sessionId}/share`, {
      method: "DELETE",
    });
    return await handleResponse(res, "Failed to revoke share link");
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Failed to revoke share link"));
  }
}

export async function getSharedChat(shareToken: string): Promise<SharedSession> {
  try {
    const res = await fetchWithRetry(`${API_BASE}/shared/${shareToken}`, {
      cache: "no-store",
    });
    return await handleResponse<SharedSession>(res, "Failed to load shared conversation");
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Failed to load shared conversation"));
  }
}

export async function listAllMemories(): Promise<MemoryItem[]> {
  try {
    const res = await fetchWithRetry(`${API_BASE}/memory`, { cache: "no-store" });
    return await handleResponse<MemoryItem[]>(res, "Failed to fetch global memories");
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Failed to fetch global memories"));
  }
}

export async function deleteMemoryItem(memoryId: string): Promise<void> {
  try {
    const res = await fetchWithRetry(`${API_BASE}/memory/${memoryId}`, { method: "DELETE" });
    await handleResponse<{ status: string; memory_id: string }>(res, "Failed to delete memory item");
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Failed to delete memory item"));
  }
}

export async function clearAllMemories(): Promise<void> {
  try {
    const res = await fetchWithRetry(`${API_BASE}/memory`, { method: "DELETE" });
    await handleResponse<{ status: string }>(res, "Failed to clear global memories");
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Failed to clear global memories"));
  }
}

// ── Session Documents ──────────────────────────────────────────────────────

export async function uploadDocumentToSession(
  sessionId: string,
  file: File,
  keys?: Partial<ApiKeys>
): Promise<Document> {
  try {
    const formData = new FormData();
    formData.append("file", file);

    const headers: Record<string, string> = {};
    if (keys?.gemini) headers["X-Gemini-Key"] = keys.gemini;
    if (keys?.groq) headers["X-Groq-Key"] = keys.groq;
    if (keys?.openrouter) headers["X-OpenRouter-Key"] = keys.openrouter;

    const res = await fetchWithRetry(`${API_BASE}/sessions/${sessionId}/documents`, {
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
    const res = await fetchWithRetry(`${API_BASE}/sessions/${sessionId}/documents`);
    return await handleResponse<Document[]>(res, "Failed to fetch session documents");
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Failed to fetch session documents"));
  }
}

export async function deleteDocument(docId: string): Promise<void> {
  try {
    const res = await fetchWithRetry(`${API_BASE}/documents/${docId}`, { method: "DELETE" });
    await handleResponse<{ status: string; session_id: string }>(res, "Failed to delete document");
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Failed to delete document"));
  }
}

export async function retryDocument(docId: string): Promise<Document> {
  try {
    const res = await fetchWithRetry(`${API_BASE}/documents/${docId}/retry`, { method: "POST" });
    return await handleResponse<Document>(res, "Failed to retry document processing");
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Failed to retry document processing"));
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
  keys: Partial<ApiKeys> | undefined,
  callbacks: ChatStreamCallbacks,
  useGlobalMemory: boolean = true
): Promise<void> {
  try {
    const headers = buildHeaders(keys);

    const res = await fetch(`${API_BASE}/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        session_id: sessionId,
        message,
        use_global_memory: useGlobalMemory,
      }),
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
  keys: Partial<ApiKeys> | undefined,
  callbacks: ChatStreamCallbacks
): Promise<void> {
  try {
    const headers = buildHeaders(keys);

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

// ── Ingest URL ─────────────────────────────────────────────────────────────

export async function ingestUrl(sessionId: string, url: string): Promise<Document> {
  try {
    const res = await fetchWithRetry(`${API_BASE}/sessions/${sessionId}/url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    return await handleResponse<Document>(res, "URL ingestion failed");
  } catch (err) {
    throw new Error(parseErrorMessage(err, "URL ingestion failed"));
  }
}

// ── Compare Documents (Streaming) ─────────────────────────────────────────

export async function compareDocuments(
  sessionId: string,
  docIds: string[],
  focusTopic: string,
  keys: Partial<ApiKeys> | undefined,
  callbacks: ChatStreamCallbacks
): Promise<void> {
  try {
    const headers = buildHeaders(keys);

    const res = await fetch(`${API_BASE}/sessions/${sessionId}/compare`, {
      method: "POST",
      headers,
      body: JSON.stringify({ doc_ids: docIds, focus_topic: focusTopic }),
    });

    if (!res.ok) {
      let errBody: unknown;
      try {
        errBody = await res.json();
      } catch {
        errBody = res.statusText;
      }
      callbacks.onError(parseErrorMessage(errBody, `Comparison failed (${res.status})`));
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      callbacks.onError("No stream available from server");
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
          else if (ev.type === "error") callbacks.onError(ev.message || "Comparison error");
        } catch {
          // ignore
        }
      }
    }
  } catch (err) {
    callbacks.onError(
      parseErrorMessage(err, "Connection error: Unable to reach backend server. Please check network.")
    );
  }
}

// ── Interactive Quiz & Flashcards ──────────────────────────────────────────

export interface QuizQuestion {
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
}

export async function generateQuiz(
  sessionId: string,
  keys?: Partial<ApiKeys>,
  numQuestions: number = 5
): Promise<QuizQuestion[]> {
  try {
    const headers = buildHeaders(keys);

    const res = await fetchWithRetry(`${API_BASE}/sessions/${sessionId}/quiz`, {
      method: "POST",
      headers,
      body: JSON.stringify({ num_questions: numQuestions }),
    });

    const data = await handleResponse<{ session_id: string; quiz: QuizQuestion[] }>(
      res,
      "Failed to generate quiz"
    );
    return data.quiz;
  } catch (err) {
    throw new Error(parseErrorMessage(err, "Failed to generate quiz"));
  }
}
