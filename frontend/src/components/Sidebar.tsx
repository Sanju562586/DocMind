"use client";

import { useState, useMemo } from "react";
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
} from "lucide-react";
import { format, isToday, isYesterday, parseISO } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { Session, ApiKeys } from "@/lib/types";
import { deleteSession, deleteAllSessions } from "@/lib/api";

interface SidebarProps {
  isOpen: boolean;
  sessions: Session[];
  activeSessionId: string | null;
  apiKeys: ApiKeys;
  backendStatus?: "healthy" | "unreachable" | "checking";
  onNewChat: () => void;
  onSelectSession: (session: Session) => void;
  onSessionDeleted: (id: string) => void;
  onAllSessionsDeleted?: () => void;
  onOpenSettings: () => void;
  onOpenShortcuts?: () => void;
  onCloseSidebar: () => void;
}

function groupSessionsByDate(sessions: Session[]): Record<string, Session[]> {
  const groups: Record<string, Session[]> = {};
  for (const s of sessions) {
    let date: Date;
    try {
      date = parseISO(s.updated_at || s.created_at);
    } catch {
      date = new Date();
    }
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
  onAllSessionsDeleted,
  onOpenSettings,
  onOpenShortcuts,
  onCloseSidebar,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [deletingSession, setDeletingSession] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [isClearingAll, setIsClearingAll] = useState(false);

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const query = searchQuery.toLowerCase().trim();
    return sessions.filter((s) => {
      const titleMatch = s.title.toLowerCase().includes(query);
      const docMatch = (s.documents || []).some((d) =>
        d.filename.toLowerCase().includes(query)
      );
      return titleMatch || docMatch;
    });
  }, [sessions, searchQuery]);

  const sessionGroups = useMemo(() => groupSessionsByDate(filteredSessions), [filteredSessions]);

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
      </div>

      {/* Scrollable Conversation Sessions List */}
      <div className="sidebar-scrollable">
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
                      <div className="sidebar-item-title">{s.title || "Untitled Conversation"}</div>
                      <div className="sidebar-item-meta">
                        {docCount > 0 ? (
                          <span style={{ color: "#FFFFFF", display: "inline-flex", alignItems: "center", gap: 3 }}>
                            <FileText size={10} />
                            {docCount} {docCount === 1 ? "doc" : "docs"}
                          </span>
                        ) : (
                          <span>No docs</span>
                        )}
                        <span>&bull;</span>
                        <span>{s.message_count || 0} msgs</span>
                      </div>
                    </div>
                    <div className="sidebar-item-actions">
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
