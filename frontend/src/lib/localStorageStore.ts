// Local System Storage Engine for Conversations and Messages
// Guarantees 100% client-side persistence regardless of cloud spin-downs or free-tier database resets.

import { Session, Message, Document } from "./types";

export const LOCAL_SESSIONS_KEY = "docmind_local_sessions_v2";
export const LOCAL_MSGS_PREFIX = "docmind_local_msgs_v2_";
export const LOCAL_CHUNKS_PREFIX = "docmind_local_chunks_v2_";
export const LOCAL_BACKUP_META_KEY = "docmind_local_backup_meta";

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function updateLastSavedMeta() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LOCAL_BACKUP_META_KEY, new Date().toISOString());
  } catch {}
}

/**
 * Migrate conversations and messages from legacy scoped or v1 keys if present.
 */
function migrateLegacyStorage(): Session[] {
  if (typeof window === "undefined") return [];
  try {
    const migratedSessions: Map<string, Session> = new Map();

    // Check all localStorage keys for legacy sessions
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      if (
        key.startsWith("docmind_persistent_sessions") ||
        key === "docmind_persistent_sessions_v1"
      ) {
        const raw = localStorage.getItem(key);
        const parsed = safeJsonParse<Session[]>(raw, []);
        if (Array.isArray(parsed)) {
          for (const s of parsed) {
            if (s && s.id && !migratedSessions.has(s.id)) {
              migratedSessions.set(s.id, s);
            }
          }
        }
      }
    }

    if (migratedSessions.size > 0) {
      const list = Array.from(migratedSessions.values());
      // Migrate legacy message keys for each session
      for (const s of list) {
        let msgs: Message[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.includes(`cached_msgs`) && k.endsWith(s.id)) {
            const rawM = localStorage.getItem(k);
            const parsedM = safeJsonParse<Message[]>(rawM, []);
            if (Array.isArray(parsedM) && parsedM.length > msgs.length) {
              msgs = parsedM;
            }
          }
        }
        if (msgs.length > 0) {
          try {
            localStorage.setItem(`${LOCAL_MSGS_PREFIX}${s.id}`, JSON.stringify(msgs));
          } catch {}
          s.message_count = Math.max(s.message_count || 0, msgs.length);
        }
      }

      try {
        localStorage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(list));
      } catch {}
      return list;
    }
  } catch (err) {
    console.debug("Legacy local storage migration notice:", err);
  }
  return [];
}

/**
 * Retrieve all sessions stored locally on this machine.
 */
export function getLocalSessions(): Session[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LOCAL_SESSIONS_KEY);
    if (!raw) {
      return migrateLegacyStorage();
    }
    const sessions = safeJsonParse<Session[]>(raw, []);
    if (!Array.isArray(sessions) || sessions.length === 0) {
      const migrated = migrateLegacyStorage();
      if (migrated.length > 0) return migrated;
      return [];
    }
    return sessions.sort((a, b) => {
      const timeA = new Date(a.updated_at || a.created_at || 0).getTime();
      const timeB = new Date(b.updated_at || b.created_at || 0).getTime();
      return timeB - timeA;
    });
  } catch {
    return [];
  }
}

/**
 * Upsert a single session into local system storage.
 */
export function saveLocalSession(session: Session): void {
  if (typeof window === "undefined" || !session || !session.id) return;
  try {
    const current = getLocalSessions();
    const index = current.findIndex((s) => s.id === session.id);
    if (index >= 0) {
      current[index] = {
        ...current[index],
        ...session,
        updated_at: session.updated_at || new Date().toISOString(),
      };
    } else {
      current.unshift(session);
    }
    localStorage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(current));
    updateLastSavedMeta();
  } catch (err) {
    console.warn("Failed to save session locally:", err);
  }
}

/**
 * Save all sessions to local system storage.
 */
export function saveAllLocalSessions(sessions: Session[]): void {
  if (typeof window === "undefined" || !Array.isArray(sessions)) return;
  try {
    localStorage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(sessions));
    updateLastSavedMeta();
  } catch (err) {
    console.warn("Failed to save sessions locally:", err);
  }
}

/**
 * Delete a session, all its messages, and document chunks from local system storage.
 */
export function deleteLocalSession(sessionId: string): void {
  if (typeof window === "undefined" || !sessionId) return;
  try {
    const current = getLocalSessions().filter((s) => s.id !== sessionId);
    localStorage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(current));
    localStorage.removeItem(`${LOCAL_MSGS_PREFIX}${sessionId}`);
    deleteLocalChunks(sessionId);
    updateLastSavedMeta();
  } catch (err) {
    console.warn("Failed to delete local session:", err);
  }
}

/**
 * Clear all conversations, messages, and document chunks from local system storage.
 */
export function clearAllLocalSessions(): void {
  if (typeof window === "undefined") return;
  try {
    const sessions = getLocalSessions();
    for (const s of sessions) {
      localStorage.removeItem(`${LOCAL_MSGS_PREFIX}${s.id}`);
      deleteLocalChunks(s.id);
    }
    localStorage.removeItem(LOCAL_SESSIONS_KEY);
    clearAllLocalChunks();
    updateLastSavedMeta();
  } catch (err) {
    console.warn("Failed to clear local sessions:", err);
  }
}

/**
 * Retrieve all document chunks stored strictly in local system storage for a session.
 */
export function getLocalChunks(sessionId: string): any[] {
  if (typeof window === "undefined" || !sessionId) return [];
  try {
    const raw = localStorage.getItem(`${LOCAL_CHUNKS_PREFIX}${sessionId}`);
    const parsed = safeJsonParse<any[]>(raw, []);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Save document chunks strictly in client-side local storage.
 */
export function saveLocalChunks(sessionId: string, chunks: any[]): void {
  if (typeof window === "undefined" || !sessionId || !Array.isArray(chunks)) return;
  try {
    const existing = getLocalChunks(sessionId);
    const chunkMap = new Map<string, any>();
    for (const c of existing) {
      if (c && c.id) chunkMap.set(c.id, c);
    }
    for (const c of chunks) {
      if (c && c.id) chunkMap.set(c.id, c);
    }
    const merged = Array.from(chunkMap.values()).sort(
      (a, b) => (a.chunk_index || 0) - (b.chunk_index || 0)
    );
    localStorage.setItem(`${LOCAL_CHUNKS_PREFIX}${sessionId}`, JSON.stringify(merged));
    updateLastSavedMeta();
  } catch (err) {
    console.warn("Failed to store chunks in local storage:", err);
  }
}

/**
 * Delete all document chunks for a session from local storage.
 */
export function deleteLocalChunks(sessionId: string): void {
  if (typeof window === "undefined" || !sessionId) return;
  try {
    localStorage.removeItem(`${LOCAL_CHUNKS_PREFIX}${sessionId}`);
  } catch {}
}

/**
 * Clear all document chunks across all sessions from local storage.
 */
export function clearAllLocalChunks(): void {
  if (typeof window === "undefined") return;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith(LOCAL_CHUNKS_PREFIX)) {
        localStorage.removeItem(key);
      }
    }
  } catch {}
}

/**
 * Retrieve messages for a specific session from local system storage.
 */
export function getLocalMessages(sessionId: string): Message[] {
  if (typeof window === "undefined" || !sessionId) return [];
  try {
    const raw = localStorage.getItem(`${LOCAL_MSGS_PREFIX}${sessionId}`);
    if (raw) {
      const msgs = safeJsonParse<Message[]>(raw, []);
      if (Array.isArray(msgs)) return msgs;
    }
    // Check legacy fallback keys
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.includes("cached_msgs") && k.endsWith(sessionId)) {
        const legacyRaw = localStorage.getItem(k);
        const legacyMsgs = safeJsonParse<Message[]>(legacyRaw, []);
        if (Array.isArray(legacyMsgs) && legacyMsgs.length > 0) {
          saveLocalMessages(sessionId, legacyMsgs);
          return legacyMsgs;
        }
      }
    }
  } catch {}
  return [];
}

/**
 * Save messages for a session to local system storage, updating the session's message_count.
 */
export function saveLocalMessages(sessionId: string, messages: Message[]): void {
  if (typeof window === "undefined" || !sessionId || !Array.isArray(messages)) return;
  try {
    localStorage.setItem(`${LOCAL_MSGS_PREFIX}${sessionId}`, JSON.stringify(messages));
    // Keep session metadata synchronized with current message count
    const sessions = getLocalSessions();
    const target = sessions.find((s) => s.id === sessionId);
    if (target) {
      target.message_count = messages.length;
      target.updated_at = new Date().toISOString();
      saveAllLocalSessions(sessions);
    }
    updateLastSavedMeta();
  } catch (err) {
    console.warn("Failed to save local messages:", err);
  }
}

/**
 * Append or update a single message immediately in local storage.
 * Ensures that newly sent user and assistant messages are NEVER lost if the tab is closed or server reloads.
 */
export function appendLocalMessage(sessionId: string, message: Message): void {
  if (typeof window === "undefined" || !sessionId || !message) return;
  try {
    const current = getLocalMessages(sessionId);
    const existingIndex = current.findIndex((m) => m.id === message.id);
    if (existingIndex >= 0) {
      current[existingIndex] = { ...current[existingIndex], ...message };
    } else {
      current.push(message);
    }
    localStorage.setItem(`${LOCAL_MSGS_PREFIX}${sessionId}`, JSON.stringify(current));

    // Update parent session metadata
    const sessions = getLocalSessions();
    const target = sessions.find((s) => s.id === sessionId);
    if (target) {
      target.message_count = current.length;
      target.updated_at = new Date().toISOString();
      saveAllLocalSessions(sessions);
    }
    updateLastSavedMeta();
  } catch (err) {
    console.warn("Failed to append local message:", err);
  }
}

/**
 * Merge local sessions and remote sessions without ever dropping locally stored conversations.
 */
export function mergeSessions(localList: Session[], remoteList: Session[]): Session[] {
  const mergedMap: Map<string, Session> = new Map();

  // First, index all local sessions
  for (const s of localList) {
    if (s && s.id) {
      mergedMap.set(s.id, { ...s });
    }
  }

  // Then, blend remote sessions
  for (const r of remoteList) {
    if (!r || !r.id) continue;
    const existing = mergedMap.get(r.id);
    if (!existing) {
      mergedMap.set(r.id, { ...r });
    } else {
      // Retain the most recent updated timestamp
      const localTime = new Date(existing.updated_at || existing.created_at || 0).getTime();
      const remoteTime = new Date(r.updated_at || r.created_at || 0).getTime();
      const newestTime = remoteTime > localTime ? r.updated_at : existing.updated_at;

      // Merge documents without duplicates
      const docMap = new Map<string, Document>();
      (existing.documents || []).forEach((d) => d && (d.doc_id || d.id) && docMap.set(d.doc_id || d.id || "", d));
      (r.documents || []).forEach((d) => d && (d.doc_id || d.id) && docMap.set(d.doc_id || d.id || "", d));

      mergedMap.set(r.id, {
        ...existing,
        ...r,
        updated_at: newestTime,
        documents: Array.from(docMap.values()),
        message_count: Math.max(existing.message_count || 0, r.message_count || 0),
      });
    }
  }

  const result = Array.from(mergedMap.values()).sort((a, b) => {
    const timeA = new Date(a.updated_at || a.created_at || 0).getTime();
    const timeB = new Date(b.updated_at || b.created_at || 0).getTime();
    return timeB - timeA;
  });

  saveAllLocalSessions(result);
  return result;
}

/**
 * Merge local messages and remote messages by ID, preserving source citations and memory items.
 */
export function mergeMessages(localMsgs: Message[], remoteMsgs: Message[]): Message[] {
  const msgMap = new Map<string, Message>();

  for (const m of localMsgs) {
    if (m && m.id) msgMap.set(m.id, { ...m });
  }

  for (const m of remoteMsgs) {
    if (!m || !m.id) continue;
    const existing = msgMap.get(m.id);
    if (!existing) {
      msgMap.set(m.id, { ...m });
    } else {
      msgMap.set(m.id, {
        ...existing,
        ...m,
        sources: m.sources && m.sources.length > 0 ? m.sources : existing.sources,
        memory_recalled: m.memory_recalled && m.memory_recalled.length > 0 ? m.memory_recalled : existing.memory_recalled,
      });
    }
  }

  return Array.from(msgMap.values()).sort((a, b) => {
    const timeA = new Date(a.created_at || 0).getTime();
    const timeB = new Date(b.created_at || 0).getTime();
    return timeA - timeB;
  });
}

/**
 * Retrieve all local sessions bundled with their complete message and chunk arrays (useful for cloud sync or backup).
 */
export function getAllSessionsWithMessages(): Array<Session & { messages: Message[]; chunks: any[] }> {
  const sessions = getLocalSessions();
  return sessions.map((s) => ({
    ...s,
    messages: getLocalMessages(s.id),
    chunks: getLocalChunks(s.id),
  }));
}

/**
 * Generate a complete JSON backup of all conversations, documents, messages, and document chunks on this local device.
 */
export function exportChatsBackupJson(): string {
  const allData = getAllSessionsWithMessages();
  let totalChunks = 0;
  for (const d of allData) {
    totalChunks += d.chunks.length;
  }
  const backup = {
    app: "DocMind Document Intelligence",
    version: 3,
    exported_at: new Date().toISOString(),
    total_sessions: allData.length,
    total_chunks: totalChunks,
    sessions: allData,
  };
  return JSON.stringify(backup, null, 2);
}

/**
 * Download a local .json file containing all conversations to the user's computer.
 */
export function downloadChatsBackupFile(): void {
  if (typeof window === "undefined") return;
  try {
    const jsonStr = exportChatsBackupJson();
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().split("T")[0];
    const link = document.createElement("a");
    link.href = url;
    link.download = `docmind_chats_backup_${dateStr}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Failed to export chats backup file:", err);
  }
}

/**
 * Restore and merge conversations, messages, and document chunks from a local .json backup file.
 */
export async function importChatsBackupJson(
  jsonString: string
): Promise<{ success: boolean; sessionCount: number; messageCount: number; chunkCount: number; error?: string }> {
  try {
    const parsed = JSON.parse(jsonString);
    const sessionsToImport: any[] = Array.isArray(parsed) ? parsed : (parsed.sessions || []);
    if (!Array.isArray(sessionsToImport) || sessionsToImport.length === 0) {
      return { success: false, sessionCount: 0, messageCount: 0, chunkCount: 0, error: "No valid conversation sessions found in backup file" };
    }

    let sessionCount = 0;
    let messageCount = 0;
    let chunkCount = 0;

    for (const rawSess of sessionsToImport) {
      const sid = rawSess.id || rawSess.session_id;
      if (!sid) continue;

      const sessionObj: Session = {
        id: sid,
        title: rawSess.title || "Restored Conversation",
        created_at: rawSess.created_at || new Date().toISOString(),
        updated_at: rawSess.updated_at || new Date().toISOString(),
        documents: rawSess.documents || [],
        message_count: 0,
        is_shared: Boolean(rawSess.is_shared),
        share_token: rawSess.share_token,
      };

      const msgs: Message[] = Array.isArray(rawSess.messages) ? rawSess.messages : [];
      sessionObj.message_count = msgs.length;

      saveLocalSession(sessionObj);
      sessionCount++;

      if (msgs.length > 0) {
        saveLocalMessages(sid, msgs);
        messageCount += msgs.length;
      }

      const chunks: any[] = Array.isArray(rawSess.chunks) ? rawSess.chunks : [];
      if (chunks.length > 0) {
        saveLocalChunks(sid, chunks);
        chunkCount += chunks.length;
      }
    }

    updateLastSavedMeta();
    return { success: true, sessionCount, messageCount, chunkCount };
  } catch (err: any) {
    return { success: false, sessionCount: 0, messageCount: 0, chunkCount: 0, error: err?.message || "Invalid JSON backup file" };
  }
}

/**
 * Get quick stats on local system storage including preserved document chunks.
 */
export function getLocalStats(): { totalSessions: number; totalMessages: number; totalChunks: number; lastSaved: string | null } {
  if (typeof window === "undefined") {
    return { totalSessions: 0, totalMessages: 0, totalChunks: 0, lastSaved: null };
  }
  try {
    const sessions = getLocalSessions();
    let totalMessages = 0;
    let totalChunks = 0;
    for (const s of sessions) {
      totalMessages += (s.message_count || 0);
      totalChunks += getLocalChunks(s.id).length;
    }
    const lastSaved = localStorage.getItem(LOCAL_BACKUP_META_KEY);
    return {
      totalSessions: sessions.length,
      totalMessages,
      totalChunks,
      lastSaved,
    };
  } catch {
    return { totalSessions: 0, totalMessages: 0, totalChunks: 0, lastSaved: null };
  }
}
