"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Command,
  Plus,
  Lightbulb,
  FileText,
  Scale,
  Globe,
  Upload,
  Brain,
  Download,
  Settings,
  X,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { Session } from "@/lib/types";

export interface CommandItem {
  id: string;
  label: string;
  category: "Actions" | "Conversations";
  shortcut?: string;
  icon: React.ReactNode;
  perform: () => void;
}

interface CommandPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: Session[];
  onSelectSession: (s: Session) => void;
  onNewChat: () => void;
  onOpenQuiz: () => void;
  onOpenCompare: () => void;
  onOpenUrlIngest: () => void;
  onOpenUpload: () => void;
  onOpenMemory: () => void;
  onExport: (format: "pdf" | "markdown" | "json" | "print") => void;
  onOpenSettings: () => void;
}

export function CommandPaletteModal({
  isOpen,
  onClose,
  sessions,
  onSelectSession,
  onNewChat,
  onOpenQuiz,
  onOpenCompare,
  onOpenUrlIngest,
  onOpenUpload,
  onOpenMemory,
  onExport,
  onOpenSettings,
}: CommandPaletteModalProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Base action commands
  const actionCommands: CommandItem[] = useMemo(
    () => [
      {
        id: "action-new-chat",
        label: "Start New Conversation",
        category: "Actions",
        shortcut: "N",
        icon: <Plus size={14} color="#FFFFFF" />,
        perform: () => {
          onClose();
          onNewChat();
        },
      },
      {
        id: "action-quiz",
        label: "Launch Interactive Quiz & Flashcards",
        category: "Actions",
        shortcut: "Q",
        icon: <Lightbulb size={14} color="#F59E0B" />,
        perform: () => {
          onClose();
          onOpenQuiz();
        },
      },
      {
        id: "action-compare",
        label: "Compare Documents Side-by-Side",
        category: "Actions",
        shortcut: "C",
        icon: <Scale size={14} color="#A855F7" />,
        perform: () => {
          onClose();
          onOpenCompare();
        },
      },
      {
        id: "action-url",
        label: "Ingest Web Page or Article URL",
        category: "Actions",
        shortcut: "U",
        icon: <Globe size={14} color="#3B82F6" />,
        perform: () => {
          onClose();
          onOpenUrlIngest();
        },
      },
      {
        id: "action-upload",
        label: "Upload Document (PDF, Images, OCR)",
        category: "Actions",
        shortcut: "O",
        icon: <Upload size={14} color="#10B981" />,
        perform: () => {
          onClose();
          onOpenUpload();
        },
      },
      {
        id: "action-memory",
        label: "Open Cross-Session Memory Inspector",
        category: "Actions",
        shortcut: "M",
        icon: <Brain size={14} color="#EC4899" />,
        perform: () => {
          onClose();
          onOpenMemory();
        },
      },
      {
        id: "action-export-pdf",
        label: "Export Conversation as PDF (.pdf)",
        category: "Actions",
        shortcut: "E",
        icon: <Download size={14} color="#FFFFFF" />,
        perform: () => {
          onClose();
          onExport("pdf");
        },
      },
      {
        id: "action-settings",
        label: "API Settings & Model Failover",
        category: "Actions",
        shortcut: ",",
        icon: <Settings size={14} color="#94A3B8" />,
        perform: () => {
          onClose();
          onOpenSettings();
        },
      },
    ],
    [
      onClose,
      onNewChat,
      onOpenQuiz,
      onOpenCompare,
      onOpenUrlIngest,
      onOpenUpload,
      onOpenMemory,
      onExport,
      onOpenSettings,
    ]
  );

  // Conversation commands
  const conversationCommands: CommandItem[] = useMemo(() => {
    return sessions.map((s) => ({
      id: `session-${s.id}`,
      label: s.title || "Untitled Conversation",
      category: "Conversations",
      icon: <FileText size={14} color="#FFFFFF" />,
      perform: () => {
        onClose();
        onSelectSession(s);
      },
    }));
  }, [sessions, onClose, onSelectSession]);

  // Combined and filtered items
  const filteredItems = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return [...actionCommands, ...conversationCommands.slice(0, 5)];

    const matchedActions = actionCommands.filter((c) =>
      c.label.toLowerCase().includes(q)
    );
    const matchedSessions = conversationCommands.filter((c) =>
      c.label.toLowerCase().includes(q)
    );

    return [...matchedActions, ...matchedSessions];
  }, [query, actionCommands, conversationCommands]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < filteredItems.length - 1 ? prev + 1 : 0
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredItems.length - 1
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filteredItems[selectedIndex]) {
          filteredItems[selectedIndex].perform();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, filteredItems, selectedIndex, onClose]);

  if (!isOpen) return null;

  return (
    <motion.div
      className="upload-modal-overlay"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      style={{ zIndex: 9999 }}
    >
      <motion.div
        className="upload-modal modal-3d"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.95, y: -20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -20 }}
        transition={{ type: "spring", stiffness: 450, damping: 30 }}
        style={{
          maxWidth: 580,
          padding: 0,
          overflow: "hidden",
          borderRadius: 14,
          background: "#0a0a0c",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          boxShadow: "0 25px 60px rgba(0, 0, 0, 0.85)",
        }}
      >
        {/* Search Input Bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 18px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            background: "rgba(255, 255, 255, 0.02)",
          }}
        >
          <Search size={16} color="rgba(255, 255, 255, 0.5)" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Type a command or search conversations…"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#FFFFFF",
              fontSize: 14,
              fontFamily: "inherit",
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              color: "rgba(255, 255, 255, 0.4)",
              background: "rgba(255, 255, 255, 0.06)",
              padding: "2px 6px",
              borderRadius: 4,
            }}
          >
            <span>ESC to close</span>
          </div>
        </div>

        {/* Results List */}
        <div
          style={{
            maxHeight: 340,
            overflowY: "auto",
            padding: "8px",
          }}
        >
          {filteredItems.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "30px 16px",
                color: "rgba(255, 255, 255, 0.4)",
                fontSize: 13,
              }}
            >
              No matching commands or conversations found for &ldquo;{query}&rdquo;
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  onClick={() => item.perform()}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "9px 12px",
                    borderRadius: 8,
                    cursor: "pointer",
                    background: isSelected
                      ? "rgba(255, 255, 255, 0.1)"
                      : "transparent",
                    transition: "background 0.12s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 6,
                        background: "rgba(255, 255, 255, 0.05)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {item.icon}
                    </div>
                    <span
                      style={{
                        fontSize: 13,
                        color: isSelected ? "#FFFFFF" : "#D4D4D8",
                        fontWeight: isSelected ? 500 : 400,
                      }}
                    >
                      {item.label}
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {item.shortcut && (
                      <kbd
                        style={{
                          fontSize: 10,
                          padding: "2px 5px",
                          borderRadius: 4,
                          background: "rgba(255, 255, 255, 0.08)",
                          color: "rgba(255, 255, 255, 0.5)",
                          fontFamily: "monospace",
                        }}
                      >
                        {item.shortcut}
                      </kbd>
                    )}
                    {isSelected && (
                      <ArrowRight size={13} color="rgba(255, 255, 255, 0.6)" />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer info */}
        <div
          style={{
            padding: "8px 16px",
            borderTop: "1px solid rgba(255, 255, 255, 0.06)",
            background: "rgba(0, 0, 0, 0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 11,
            color: "rgba(255, 255, 255, 0.35)",
          }}
        >
          <div style={{ display: "flex", gap: 12 }}>
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
          </div>
          <span>DocMind Quick Launch</span>
        </div>
      </motion.div>
    </motion.div>
  );
}
