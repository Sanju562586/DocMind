"use client";

import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Database, X, Brain, CheckCircle2, Trash2, Search, RefreshCw, AlertTriangle } from "lucide-react";
import { Session, MemoryItem } from "@/lib/types";
import { listAllMemories, deleteMemoryItem, clearAllMemories } from "@/lib/api";

interface GlobalMemoryModalProps {
  sessions: Session[];
  onClose: () => void;
}

export function GlobalMemoryModal({ sessions, onClose }: GlobalMemoryModalProps) {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [isClearingAll, setIsClearingAll] = useState(false);

  const loadMemories = async () => {
    setIsLoading(true);
    try {
      const list = await listAllMemories();
      setMemories(list);
    } catch (err) {
      console.warn("Failed to load memories:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadMemories();
  }, []);

  const filteredMemories = useMemo(() => {
    if (!searchQuery.trim()) return memories;
    const q = searchQuery.toLowerCase().trim();
    return memories.filter(
      (m) =>
        m.content.toLowerCase().includes(q) ||
        m.session_title.toLowerCase().includes(q)
    );
  }, [memories, searchQuery]);

  const handleDeleteMemory = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteMemoryItem(id);
      setMemories((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      console.warn("Failed to delete memory item:", err);
    } finally {
      setDeletingId(null);
    }
  };

  const handleClearAllMemories = async () => {
    if (!confirmClearAll) {
      setConfirmClearAll(true);
      setTimeout(() => setConfirmClearAll(false), 4000);
      return;
    }
    setIsClearingAll(true);
    try {
      await clearAllMemories();
      setMemories([]);
      setConfirmClearAll(false);
    } catch (err) {
      console.warn("Failed to clear memories:", err);
    } finally {
      setIsClearingAll(false);
    }
  };

  const totalMessages = sessions.reduce((acc, s) => acc + (s.message_count || 0), 0);
  const totalDocs = sessions.reduce((acc, s) => acc + (s.documents?.length || 0), 0);

  return (
    <motion.div
      className="upload-modal-overlay"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="upload-modal modal-3d"
        style={{ maxWidth: 640, maxHeight: "90vh", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.92, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 20 }}
        transition={{ type: "spring", stiffness: 450, damping: 30 }}
      >
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <motion.div
              className="modal-icon-badge"
              whileHover={{ rotate: 15, scale: 1.1 }}
            >
              <Database size={16} color="#FFFFFF" />
            </motion.div>
            <div>
              <span className="modal-title">Global Cross-Session Memory</span>
              <div className="modal-subtitle">Continuous Neural Knowledge Graph ({memories.length} entries)</div>
            </div>
          </div>
          <motion.button
            className="modal-close"
            onClick={onClose}
            aria-label="Close memory modal"
            whileHover={{ scale: 1.15, rotate: 90 }}
            whileTap={{ scale: 0.85 }}
          >
            <X size={15} color="#FFFFFF" />
          </motion.button>
        </div>

        <p className="modal-description" style={{ marginBottom: 12 }}>
          DocMind continuously indexes key conversation turns and insights across all chats. When you ask new questions, relevant past learnings are synthesized automatically.
        </p>

        {/* Memory Statistics Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 14 }}>
          <div style={{ padding: "8px 6px", background: "#111111", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-md)", textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#FFFFFF" }}>{sessions.length}</div>
            <div style={{ fontSize: 9, color: "var(--text-muted-alt)", textTransform: "uppercase", fontWeight: 700 }}>Sessions</div>
          </div>
          <div style={{ padding: "8px 6px", background: "#111111", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-md)", textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#FFFFFF" }}>{totalDocs}</div>
            <div style={{ fontSize: 9, color: "var(--text-muted-alt)", textTransform: "uppercase", fontWeight: 700 }}>Corpus Docs</div>
          </div>
          <div style={{ padding: "8px 6px", background: "#111111", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-md)", textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#FFFFFF" }}>{memories.length}</div>
            <div style={{ fontSize: 9, color: "var(--text-muted-alt)", textTransform: "uppercase", fontWeight: 700 }}>Memory Items</div>
          </div>
        </div>

        {/* Search & Action Bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <div style={{ flex: 1, position: "relative" }}>
            <Search size={12} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted-alt)" }} />
            <input
              type="text"
              placeholder="Search cross-session memories…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%",
                background: "#111111",
                border: "1px solid var(--border-strong)",
                borderRadius: "var(--radius-sm)",
                color: "#FFFFFF",
                fontSize: 12,
                padding: "6px 28px",
                outline: "none",
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--text-muted-alt)", cursor: "pointer" }}
              >
                <X size={12} />
              </button>
            )}
          </div>

          {memories.length > 0 && (
            <motion.button
              className={`btn btn-outline ${confirmClearAll ? "btn-danger" : ""}`}
              style={{ padding: "6px 10px", fontSize: 11, whiteSpace: "nowrap" }}
              onClick={handleClearAllMemories}
              disabled={isClearingAll}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
            >
              {isClearingAll ? "Clearing…" : confirmClearAll ? "Confirm Clear?" : "Clear All"}
            </motion.button>
          )}
        </div>

        {/* Scrollable Memories List */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 180, maxHeight: 260, paddingRight: 4, display: "flex", flexDirection: "column", gap: 8 }}>
          {isLoading ? (
            <div style={{ textAlign: "center", padding: "30px 0", color: "var(--text-muted-alt)", fontSize: 12 }}>
              Loading global memories…
            </div>
          ) : filteredMemories.length === 0 ? (
            <div style={{ textAlign: "center", padding: "30px 0", color: "var(--text-muted-alt)", fontSize: 12 }}>
              {searchQuery ? "No memories match your search." : "No global memories recorded yet. Ask questions in any chat to build memories."}
            </div>
          ) : (
            <AnimatePresence mode="popLayout">
              {filteredMemories.map((mem, memIdx) => (
                <motion.div
                  key={mem.id || `mem-${memIdx}-${mem.session_id}-${mem.content?.slice(0, 16)}`}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  style={{
                    padding: "8px 12px",
                    background: "#0c0c0c",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "var(--radius-md)",
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#FFFFFF", background: "rgba(255, 255, 255, 0.1)", padding: "1px 6px", borderRadius: 4 }}>
                        {mem.session_title}
                      </span>
                      <span style={{ fontSize: 9.5, color: "var(--text-muted-alt)" }}>
                        {mem.role}
                      </span>
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.45, wordBreak: "break-word" }}>
                      {mem.content}
                    </div>
                  </div>

                  {mem.id && (
                    <motion.button
                      onClick={() => handleDeleteMemory(mem.id!)}
                      disabled={deletingId === mem.id}
                      className="icon-btn"
                      style={{ padding: 4, opacity: 0.6, flexShrink: 0 }}
                      whileHover={{ opacity: 1, scale: 1.1, color: "#FFFFFF" }}
                      whileTap={{ scale: 0.9 }}
                      title="Delete memory item"
                    >
                      {deletingId === mem.id ? (
                        <div className="spin" style={{ width: 10, height: 10, border: "1.2px solid #FFFFFF", borderTopColor: "transparent", borderRadius: "50%" }} />
                      ) : (
                        <Trash2 size={12} />
                      )}
                    </motion.button>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>

        <div style={{ marginTop: 14 }}>
          <motion.button
            className="btn btn-primary save-btn"
            onClick={onClose}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.96 }}
          >
            <CheckCircle2 size={14} color="#000000" />
            <span>Close Memory Inspector</span>
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}
