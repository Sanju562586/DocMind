"use client";

import { useEffect } from "react";
import { X, Command, Keyboard } from "lucide-react";
import { motion } from "framer-motion";

interface KeyboardShortcutsModalProps {
  onClose: () => void;
}

interface ShortcutItem {
  keys: string[];
  description: string;
  category: "Navigation" | "Chat & Actions" | "General";
}

const SHORTCUTS: ShortcutItem[] = [
  { keys: ["Enter"], description: "Send message", category: "Chat & Actions" },
  { keys: ["Shift", "Enter"], description: "Add new line in chat input", category: "Chat & Actions" },
  { keys: ["Ctrl / ⌘", "B"], description: "Toggle left sidebar", category: "Navigation" },
  { keys: ["Ctrl / ⌘", "K"], description: "Open search / New conversation", category: "Navigation" },
  { keys: ["?"], description: "Open keyboard shortcuts guide", category: "General" },
  { keys: ["Esc"], description: "Close active modal / Cancel editing", category: "General" },
  { keys: ["Click Title"], description: "Double-click topbar title to rename conversation", category: "Chat & Actions" },
];

export default function KeyboardShortcutsModal({ onClose }: KeyboardShortcutsModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const categories = ["Chat & Actions", "Navigation", "General"] as const;

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
        className="upload-modal modal-3d shortcuts-modal"
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
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
            >
              <Keyboard size={16} />
            </motion.div>
            <div>
              <span className="modal-title">Keyboard Shortcuts</span>
              <div className="modal-subtitle">Power User Command Center</div>
            </div>
          </div>
          <motion.button
            className="modal-close"
            onClick={onClose}
            aria-label="Close shortcuts modal"
            whileHover={{ scale: 1.15, rotate: 90 }}
            whileTap={{ scale: 0.85 }}
            transition={{ type: "spring", stiffness: 450, damping: 20 }}
          >
            <X size={15} />
          </motion.button>
        </div>

        <p className="modal-description">
          Accelerate your document intelligence workflow with built-in hotkeys.
        </p>

        <div className="shortcuts-content">
          {categories.map((cat) => {
            const items = SHORTCUTS.filter((s) => s.category === cat);
            return (
              <div key={cat} className="shortcuts-category-section">
                <div className="shortcuts-category-title">{cat}</div>
                <div className="shortcuts-list">
                  {items.map((item, idx) => (
                    <div key={idx} className="shortcut-row">
                      <span className="shortcut-desc">{item.description}</span>
                      <div className="shortcut-keys">
                        {item.keys.map((k, ki) => (
                          <kbd key={ki} className="shortcut-kbd">
                            {k}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 20, textAlign: "center" }}>
          <motion.button
            className="btn btn-outline"
            onClick={onClose}
            style={{ width: "100%", justifyContent: "center" }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.96 }}
          >
            Got it
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}
