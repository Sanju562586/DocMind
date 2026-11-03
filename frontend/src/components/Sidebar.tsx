"use client";

import { useState, useMemo, useEffect } from "react";
import {
  MessageSquare,
  Plus,
  FileText,
  Trash2,
  Settings,
  Brain,
  Database,
  PanelLeftClose,
  CheckCircle2,
  AlertTriangle,
  X,
  Search,
  Command,
  HelpCircle,
  Edit3,
  Check,
  Pin,
  PinOff,
  Tag,
  Globe,
  HardDrive,
  Download,
  Upload,
} from "lucide-react";
import { format, isToday, isYesterday, parseISO, isValid } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { Session, ApiKeys } from "@/lib/types";
import { deleteSession, deleteAllSessions, renameSession } from "@/lib/api";
import { downloadChatsBackupFile, importChatsBackupJson } from "@/lib/localStorageStore";
import { useAuth } from "@/lib/auth";

interface SidebarProps {
  isOpen: boolean;
  sessions: Session[];
  activeSessionId: string | null;
  apiKeys: ApiKeys;
  backendStatus?: "healthy" | "unreachable" | "checking";
  onNewChat: () => void;
  onSelectSession: (session: Session) => void;
  onSessionDeleted: (id: string) => void;
  onSessionRenamed?: (id: string, newTitle: string) => void;
  onAllSessionsDeleted?: () => void;
  onOpenSettings: () => void;
  onOpenShortcuts?: () => void;
  onOpenCompare?: () => void;
  onOpenQuiz?: () => void;
  onOpenMemoryInspector?: () => void;
  onOpenUrlIngest?: () => void;
  onCloseSidebar: () => void;
  onRefreshSessions?: () => void;
}

function parseDateSafe(val?: string | null): Date {
  if (!val) return new Date();
  try {
    const isoString = val.includes(" ") ? val.replace(" ", "T") : val;
    const d = parseISO(isoString);
    if (isValid(d)) return d;
    const direct = new Date(val);
    if (isValid(direct)) return direct;
  } catch {}
  return new Date();
}

function groupSessionsByDate(sessions: Session[]): Record<string, Session[]> {
  const groups: Record<string, Session[]> = {};
  for (const s of sessions) {
    const date = parseDateSafe(s.updated_at || s.created_at);
    let key: string;
    if (isToday(date)) key = "Today";
    else if (isYesterday(date)) key = "Yesterday";
    else key = format(date, "MMM d, yyyy");
    groups[key] = groups[key] ? [...groups[key], s] : [s];
  }
  return groups;
}

export default function Sidebar({
  isOpen,
  sessions,
  activeSessionId,
  apiKeys,
  backendStatus = "healthy",
  onNewChat,
  onSelectSession,
  onSessionDeleted,
  onSessionRenamed,
  onAllSessionsDeleted,
  onOpenSettings,
  onOpenShortcuts,
  onOpenCompare,
  onOpenQuiz,
  onOpenMemoryInspector,
  onOpenUrlIngest,
  onCloseSidebar,
  onRefreshSessions,
}: SidebarProps) {
  const { user, openAuthModal } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [deletingSession, setDeletingSession] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [isClearingAll, setIsClearingAll] = useState(false);
  const [importNotification, setImportNotification] = useState<string | null>(null);

  const handleExportBackup = (e: React.MouseEvent) => {
    e.stopPropagation();
    downloadChatsBackupFile();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const res = await importChatsBackupJson(text);
      if (res.success) {
        setImportNotification(`✓ Restored ${res.sessionCount} chats`);
        setTimeout(() => setImportNotification(null), 3500);
        onRefreshSessions?.();
      } else {
        setImportNotification(`⚠️ ${res.error || "Failed to restore backup"}`);
        setTimeout(() => setImportNotification(null), 4000);
      }
    } catch {
      setImportNotification("⚠️ Failed to parse backup file");
      setTimeout(() => setImportNotification(null), 3000);
    } finally {
      e.target.value = "";
    }
  };

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);

  // Pinned Sessions State (scoped per user)
  const pinnedKey = `docmind_pinned_sessions_${user?.id || "default"}`;
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(pinnedKey);
      if (saved) {
        setPinnedIds(JSON.parse(saved));
      } else {
        setPinnedIds([]);
      }
    } catch {
      setPinnedIds([]);
    }
  }, [pinnedKey]);

  // Subject Tag Filter State
  const [selectedTag, setSelectedTag] = useState<string>("All");
  const SUBJECT_TAGS = ["All", "Exam Prep", "CS / Code", "Math", "Research"];

  const handleTogglePin = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    setPinnedIds((prev) => {
      const next = prev.includes(sessionId)
        ? prev.filter((id) => id !== sessionId)
        : [...prev, sessionId];
      try {
        localStorage.setItem(pinnedKey, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const handleStartEdit = (e: React.MouseEvent, s: Session) => {
    e.stopPropagation();
    setEditingSessionId(s.id);
    setEditingTitle(s.title || "");
  };

  const handleSaveEdit = async (e?: React.FormEvent | React.MouseEvent, sessionId?: string) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    const targetId = sessionId || editingSessionId;
    if (!targetId) return;
    const cleanTitle = editingTitle.trim();
    if (!cleanTitle) {
      setEditingSessionId(null);
      return;
    }
    setIsRenaming(true);
    try {
      const updated = await renameSession(targetId, cleanTitle);
      onSessionRenamed?.(targetId, updated);
    } catch (err) {
      console.warn("Failed to rename session:", err);
    } finally {
      setIsRenaming(false);
      setEditingSessionId(null);
    }
  };

  const filteredSessions = useMemo(() => {
    let result = sessions;

    // Apply tag filter
    if (selectedTag !== "All") {
      const tagLower = selectedTag.toLowerCase();
      result = result.filter((s) => {
        const titleMatch = s.title.toLowerCase().includes(tagLower) ||
          (selectedTag === "Exam Prep" && (s.title.toLowerCase().includes("exam") || s.title.toLowerCase().includes("quiz") || s.title.toLowerCase().includes("study"))) ||
          (selectedTag === "CS / Code" && (s.title.toLowerCase().includes("cs") || s.title.toLowerCase().includes("code") || s.title.toLowerCase().includes("algorithm"))) ||
          (selectedTag === "Math" && (s.title.toLowerCase().includes("math") || s.title.toLowerCase().includes("formula") || s.title.toLowerCase().includes("calculus")));
        const docMatch = (s.documents || []).some((d) =>
          d.filename.toLowerCase().includes(tagLower)
        );
        return titleMatch || docMatch;
      });
    }

    // Apply text search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter((s) => {
        const titleMatch = s.title.toLowerCase().includes(query);
        const docMatch = (s.documents || []).some((d) =>
          d.filename.toLowerCase().includes(query)
        );
        return titleMatch || docMatch;
      });
    }

    return result;
  }, [sessions, searchQuery, selectedTag]);

  const pinnedSessions = useMemo(
    () => filteredSessions.filter((s) => pinnedIds.includes(s.id)),
    [filteredSessions, pinnedIds]
  );

  const unpinnedSessions = useMemo(
    () => filteredSessions.filter((s) => !pinnedIds.includes(s.id)),
    [filteredSessions, pinnedIds]
  );

  const sessionGroups = useMemo(() => groupSessionsByDate(unpinnedSessions), [unpinnedSessions]);

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    setDeletingSession(sessionId);
    try {
      await deleteSession(sessionId);
      onSessionDeleted(sessionId);
    } catch (err) {
      console.warn("Failed to delete session:", err);
    } finally {
      setDeletingSession(null);
    }
  };

  const handleClearAll = async () => {
    if (!confirmClearAll) {
      setConfirmClearAll(true);
      setTimeout(() => setConfirmClearAll(false), 4000);
      return;
    }
    setIsClearingAll(true);
    try {
      await deleteAllSessions();
      onAllSessionsDeleted?.();
      setConfirmClearAll(false);
    } catch (err) {
      console.warn("Failed to clear all sessions:", err);
    } finally {
      setIsClearingAll(false);
    }
  };

  return (
    <aside className={`sidebar ${isOpen ? "open" : "collapsed"}`}>
      {/* Header */}
      <div className="sidebar-header">
        <div className="sidebar-header-top">
          <motion.div
            className="logo-container"
            whileHover={{ scale: 1.02 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            onClick={onNewChat}
          >
            <motion.div
              className="logo-icon"
              whileHover={{ rotate: 12, scale: 1.08 }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
            >
              <Brain size={19} strokeWidth={2.3} />
            </motion.div>
            <div>
              <div className="logo-text">
                DocMind
                <span style={{ fontSize: 10, color: "#FFFFFF", fontWeight: 700, marginLeft: 3 }}>AI</span>
              </div>
              <div className="logo-tagline">Intelligence Hub</div>
            </div>
          </motion.div>

          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {onOpenShortcuts && (
              <motion.button
                className="icon-btn"
                onClick={onOpenShortcuts}
                whileHover={{ scale: 1.1, color: "#FFFFFF" }}
                whileTap={{ scale: 0.9 }}
                title="Keyboard Shortcuts (?)"
                aria-label="Keyboard shortcuts"
                style={{ width: 28, height: 28 }}
              >
                <HelpCircle size={14} />
              </motion.button>
            )}
            <motion.button
              className="sidebar-close-btn"
              onClick={onCloseSidebar}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
              title="Collapse sidebar (Ctrl+B)"
              aria-label="Close sidebar"
            >
              <PanelLeftClose size={16} className="desktop-close-icon" />
              <X size={16} className="mobile-close-icon" />
            </motion.button>
          </div>
        </div>

        <motion.button
          className="new-chat-btn"
          onClick={onNewChat}
          whileHover={{ scale: 1.02, y: -1 }}
          whileTap={{ scale: 0.96 }}
          transition={{ type: "spring", stiffness: 400, damping: 22 }}
        >
          <Plus size={15} strokeWidth={2.5} />
          <span>New Conversation</span>
        </motion.button>

        {/* Live Search Input */}
        {sessions.length > 2 && (
          <div className="sidebar-search-wrapper">
            <Search size={12} className="sidebar-search-icon" />
            <input
              type="text"
              className="sidebar-search-input"
              placeholder="Search conversations…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Filter conversations"
            />
            {searchQuery && (
              <button
                className="sidebar-search-clear"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
              >
                <X size={11} />
              </button>
            )}
          </div>
        )}

        {/* Subject Tag Filter Bar */}
        {sessions.length > 1 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              overflowX: "auto",
              padding: "4px 0 2px 0",
              scrollbarWidth: "none",
            }}
          >
            {SUBJECT_TAGS.map((tag) => {
              const isSelected = selectedTag === tag;
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setSelectedTag(tag)}
                  style={{
                    padding: "3px 8px",
                    borderRadius: 10,
                    fontSize: 10,
                    fontWeight: isSelected ? 600 : 400,
                    border: isSelected
                      ? "1px solid rgba(255, 255, 255, 0.4)"
                      : "1px solid rgba(255, 255, 255, 0.08)",
                    background: isSelected
                      ? "rgba(255, 255, 255, 0.12)"
                      : "transparent",
                    color: isSelected ? "#FFFFFF" : "rgba(255, 255, 255, 0.5)",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    transition: "all 0.12s ease",
                  }}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Scrollable Conversation Sessions List */}
      <div className="sidebar-scrollable">
        {/* Local System Storage Persistence Badge & Actions */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "4px 8px",
            marginBottom: 6,
            borderRadius: 6,
            background: "rgba(16, 185, 129, 0.07)",
            border: "1px solid rgba(16, 185, 129, 0.18)",
            fontSize: 10,
            color: "#6ee7b7",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#10b981",
                display: "inline-block",
                boxShadow: "0 0 6px #10b981",
              }}
            />
            <HardDrive size={11} color="#10b981" />
            <span style={{ fontWeight: 500 }}>Saved in local system</span>
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <label
              style={{
                cursor: "pointer",
                color: "#93c5fd",
                display: "flex",
                alignItems: "center",
                gap: 2,
                fontSize: 9.5,
              }}
              title="Import conversations from backup JSON file"
            >
              <Upload size={10} />
              <span>Import</span>
              <input
                type="file"
                accept=".json"
                style={{ display: "none" }}
                onChange={handleImportFile}
              />
            </label>
            <span style={{ opacity: 0.3 }}>|</span>
            <button
              type="button"
              onClick={handleExportBackup}
              style={{
                background: "transparent",
                border: "none",
                color: "#a78bfa",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 2,
                fontSize: 9.5,
                padding: 0,
              }}
              title="Download backup JSON of all chats to your computer"
            >
              <Download size={10} />
              <span>Export</span>
            </button>
          </div>
        </div>

        {importNotification && (
          <div
            style={{
              padding: "4px 8px",
              marginBottom: 6,
              borderRadius: 5,
              background: importNotification.startsWith("✓") ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
              color: importNotification.startsWith("✓") ? "#6ee7b7" : "#fca5a5",
              fontSize: 10.5,
              fontWeight: 500,
            }}
          >
            {importNotification}
          </div>
        )}

        <div className="sidebar-section-header">
          <span className="sidebar-section-title">
            Conversations ({filteredSessions.length})
          </span>
          {sessions.length > 1 && (
            <motion.button
              className={`sidebar-clear-all-btn ${confirmClearAll ? "confirm" : ""}`}
              onClick={handleClearAll}
              disabled={isClearingAll}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              title="Delete all conversations"
            >
              {isClearingAll ? "Clearing…" : confirmClearAll ? "Confirm Clear?" : "Clear All"}
            </motion.button>
          )}
        </div>

        {filteredSessions.length === 0 && (
          <div className="sidebar-empty-conversations">
            {searchQuery ? (
              <>No conversations match &ldquo;{searchQuery}&rdquo;</>
            ) : (
              <>
                No conversations yet.<br />
                Click <strong style={{ color: "#FFFFFF" }}>New Conversation</strong> to begin.
              </>
            )}
          </div>
        )}

        <AnimatePresence mode="popLayout">
          {pinnedSessions.length > 0 && (
            <div className="sidebar-date-section">
              <div className="sidebar-date-group" style={{ color: "#F59E0B", display: "flex", alignItems: "center", gap: 4 }}>
                <Pin size={11} />
                <span>Pinned ({pinnedSessions.length})</span>
              </div>
              {pinnedSessions.map((s) => {
                const docCount = s.documents?.length || 0;
                const isActive = activeSessionId === s.id;
                return (
                  <motion.div
                    key={`pinned-${s.id}`}
                    layout
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -15, scale: 0.95 }}
                    transition={{ type: "spring", stiffness: 350, damping: 25 }}
                    className={`sidebar-item ${isActive ? "active" : ""}`}
                    onClick={() => onSelectSession(s)}
                    whileHover={{ x: 3 }}
                    whileTap={{ scale: 0.98 }}
                    style={{ borderLeft: "2px solid #F59E0B" }}
                  >
                    <div className="sidebar-item-icon">
                      <Pin size={13} color="#F59E0B" />
                    </div>
                    <div className="sidebar-item-content">
                      {editingSessionId === s.id ? (
                        <form
                          onSubmit={(e) => handleSaveEdit(e, s.id)}
                          onClick={(e) => e.stopPropagation()}
                          style={{ display: "flex", alignItems: "center", gap: 4, width: "100%" }}
                        >
                          <input
                            type="text"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onBlur={(e) => handleSaveEdit(e, s.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") setEditingSessionId(null);
                            }}
                            autoFocus
                            style={{
                              background: "#1E1E24",
                              border: "1px solid rgba(255, 255, 255, 0.4)",
                              borderRadius: 4,
                              color: "#FFFFFF",
                              fontSize: 12,
                              padding: "2px 6px",
                              width: "100%",
                              outline: "none",
                            }}
                          />
                        </form>
                      ) : (
                        <div
                          className="sidebar-item-title"
                          onDoubleClick={(e) => handleStartEdit(e, s)}
                          title="Double click to rename"
                        >
                          {s.title || "Untitled Conversation"}
                        </div>
                      )}
                    </div>
                    <div className="sidebar-item-actions">
                      <motion.button
                        className="icon-btn"
                        onClick={(e) => handleTogglePin(e, s.id)}
                        title="Unpin conversation"
                        whileHover={{ scale: 1.2, color: "#FFFFFF" }}
                        whileTap={{ scale: 0.85 }}
                      >
                        <PinOff size={11} color="#F59E0B" />
                      </motion.button>
                      <motion.button
                        className="icon-btn"
                        onClick={(e) => handleStartEdit(e, s)}
                        title="Rename conversation"
                        whileHover={{ scale: 1.2, color: "#FFFFFF" }}
                        whileTap={{ scale: 0.85 }}
                      >
                        <Edit3 size={11} />
                      </motion.button>
                      <motion.button
                        className="icon-btn"
                        onClick={(e) => handleDeleteSession(e, s.id)}
                        disabled={deletingSession === s.id}
                        title="Delete conversation"
                        whileHover={{ scale: 1.2, color: "#FFFFFF" }}
                        whileTap={{ scale: 0.85 }}
                      >
                        <Trash2 size={12} />
                      </motion.button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}

          {Object.entries(sessionGroups).map(([dateGroup, groupSessions]) => (
            <div key={dateGroup} className="sidebar-date-section">
              <div className="sidebar-date-group">{dateGroup}</div>
              {groupSessions.map((s) => {
                const docCount = s.documents?.length || 0;
                const isActive = activeSessionId === s.id;
                return (
                  <motion.div
                    key={s.id}
                    layout
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -15, scale: 0.95 }}
                    transition={{ type: "spring", stiffness: 350, damping: 25 }}
                    className={`sidebar-item ${isActive ? "active" : ""}`}
                    onClick={() => onSelectSession(s)}
                    whileHover={{ x: 3 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <div className="sidebar-item-icon">
                      <MessageSquare size={14} />
                    </div>
                    <div className="sidebar-item-content">
                      {editingSessionId === s.id ? (
                        <form
                          onSubmit={(e) => handleSaveEdit(e, s.id)}
                          onClick={(e) => e.stopPropagation()}
                          style={{ display: "flex", alignItems: "center", gap: 4, width: "100%" }}
                        >
                          <input
                            type="text"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onBlur={(e) => handleSaveEdit(e, s.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") setEditingSessionId(null);
                            }}
                            autoFocus
                            style={{
                              background: "#1E1E24",
                              border: "1px solid rgba(255, 255, 255, 0.4)",
                              borderRadius: 4,
                              color: "#FFFFFF",
                              fontSize: 12,
                              padding: "2px 6px",
                              width: "100%",
                              outline: "none",
                            }}
                          />
                        </form>
                      ) : (
                        <div
                          className="sidebar-item-title"
                          onDoubleClick={(e) => handleStartEdit(e, s)}
                          title="Double click to rename"
                        >
                          {s.title || "Untitled Conversation"}
                        </div>
                      )}
                    </div>
                    <div className="sidebar-item-actions">
                      <motion.button
                        className="icon-btn"
                        onClick={(e) => handleTogglePin(e, s.id)}
                        title="Pin conversation to top"
                        whileHover={{ scale: 1.2, color: "#FFFFFF" }}
                        whileTap={{ scale: 0.85 }}
                      >
                        <Pin size={11} />
                      </motion.button>
                      <motion.button
                        className="icon-btn"
                        onClick={(e) => handleStartEdit(e, s)}
                        title="Rename conversation"
                        whileHover={{ scale: 1.2, color: "#FFFFFF" }}
                        whileTap={{ scale: 0.85 }}
                      >
                        <Edit3 size={11} />
                      </motion.button>
                      <motion.button
                        className="icon-btn"
                        onClick={(e) => handleDeleteSession(e, s.id)}
                        disabled={deletingSession === s.id}
                        title="Delete conversation & session docs"
                        whileHover={{ scale: 1.2, color: "#FFFFFF" }}
                        whileTap={{ scale: 0.85 }}
                        transition={{ type: "spring", stiffness: 450, damping: 20 }}
                      >
                        {deletingSession === s.id ? (
                          <div
                            className="spin"
                            style={{
                              width: 10,
                              height: 10,
                              border: "1.2px solid #FFFFFF",
                              borderTopColor: "transparent",
                              borderRadius: "50%",
                            }}
                          />
                        ) : (
                          <Trash2 size={12} />
                        )}
                      </motion.button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          ))}
        </AnimatePresence>
      </div>

      {/* User Profile & Workspace Switcher */}
      <div style={{ padding: "0 10px 10px 10px" }}>
        <motion.div
          onClick={openAuthModal}
          whileHover={{ scale: 1.02, borderColor: "rgba(99, 102, 241, 0.5)" }}
          whileTap={{ scale: 0.98 }}
          style={{
            padding: "8px 10px",
            borderRadius: 8,
            background: "rgba(255, 255, 255, 0.04)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
          title="Switch profile or sign in"
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                background: "rgba(99, 102, 241, 0.2)",
                border: "1px solid rgba(99, 102, 241, 0.4)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                flexShrink: 0,
                overflow: "hidden",
                position: "relative",
              }}
            >
              {typeof user?.image === "string" &&
              (user.image.startsWith("http://") ||
                user.image.startsWith("https://") ||
                user.image.startsWith("data:") ||
                user.image.startsWith("/")) ? (
                <img
                  src={user.image}
                  alt={user?.name || "User"}
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = "none";
                  }}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    borderRadius: "50%",
                    display: "block",
                  }}
                />
              ) : user?.image === "🌐" ? (
                <Globe size={13} color="#60a5fa" />
              ) : typeof user?.image === "string" && user.image.length <= 4 ? (
                <span style={{ fontSize: 13, lineHeight: 1, userSelect: "none" }}>{user.image}</span>
              ) : user?.name && user.name.trim().length > 0 ? (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#fff",
                    textTransform: "uppercase",
                    userSelect: "none",
                  }}
                >
                  {user.name.trim().charAt(0)}
                </span>
              ) : (
                <span style={{ fontSize: 13, lineHeight: 1, userSelect: "none" }}>👤</span>
              )}
            </div>
            <div style={{ overflow: "hidden", textAlign: "left" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#fff", whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
                {user?.name || "Guest User"}
              </div>
              <div style={{ fontSize: 9.5, color: "rgba(255, 255, 255, 0.5)", whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
                {user?.role || "Private Workspace"}
              </div>
            </div>
          </div>
          <div
            style={{
              fontSize: 9,
              padding: "2px 6px",
              borderRadius: 4,
              background: "rgba(99, 102, 241, 0.15)",
              color: "#818cf8",
              border: "1px solid rgba(99, 102, 241, 0.3)",
              fontWeight: 500,
              flexShrink: 0,
            }}
          >
            Switch
          </div>
        </motion.div>
      </div>

      {/* Footer: Settings & Shortcuts Button */}
      <div className="sidebar-footer">
        <motion.button
          className="btn btn-outline"
          style={{ width: "100%", justifyContent: "center", padding: "8px 12px" }}
          onClick={onOpenSettings}
          whileHover={{ scale: 1.02, borderColor: "#FFFFFF" }}
          whileTap={{ scale: 0.96 }}
          transition={{ type: "spring", stiffness: 400, damping: 22 }}
        >
          <Settings size={13} />
          <span>API Keys &amp; Settings</span>
        </motion.button>
      </div>
    </aside>
  );
}
