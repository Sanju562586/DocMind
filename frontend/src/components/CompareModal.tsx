"use client";

import { useState, useMemo } from "react";
import { Scale, X, Sparkles, FileText, Upload, CheckSquare, Square } from "lucide-react";
import { motion } from "framer-motion";
import { Document, Session } from "@/lib/types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { preprocessMarkdown } from "@/lib/markdown";

interface CompareModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeSession: Session | null;
  sessions: Session[];
  onOpenUpload: () => void;
  onStartComparison: (selectedDocIds: string[], focusTopic: string) => void;
  isLoading: boolean;
  resultMarkdown: string;
}

export function CompareModal({
  isOpen,
  onClose,
  activeSession,
  sessions,
  onOpenUpload,
  onStartComparison,
  isLoading,
  resultMarkdown,
}: CompareModalProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [focusTopic, setFocusTopic] = useState("Executive Overview & Key Differences");

  // Gather documents from active session first, or from all sessions
  const availableDocs = useMemo(() => {
    const map = new Map<string, Document>();
    if (activeSession?.documents) {
      activeSession.documents.forEach((d) => map.set(d.doc_id, d));
    }
    sessions.forEach((s) => {
      s.documents?.forEach((d) => {
        if (!map.has(d.doc_id)) map.set(d.doc_id, d);
      });
    });
    return Array.from(map.values());
  }, [activeSession, sessions]);

  if (!isOpen) return null;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((dId) => dId !== id) : [...prev, id]
    );
  };

  const handleRun = () => {
    const docsToCompare = selectedIds.length > 0 ? selectedIds : availableDocs.slice(0, 4).map((d) => d.doc_id);
    onStartComparison(docsToCompare, focusTopic);
  };

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
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.92, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 20 }}
        transition={{ type: "spring", stiffness: 450, damping: 30 }}
        style={{ maxWidth: 780, maxHeight: "90vh", display: "flex", flexDirection: "column" }}
      >
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <motion.div
              className="modal-icon-badge"
              whileHover={{ rotate: 15, scale: 1.1 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
            >
              <Scale size={16} />
            </motion.div>
            <div>
              <span className="modal-title">Side-by-Side Document Comparison</span>
              <div className="modal-subtitle">Cross-Document Matrix &amp; Delta Analysis</div>
            </div>
          </div>
          <motion.button
            className="modal-close"
            onClick={onClose}
            aria-label="Close modal"
            whileHover={{ scale: 1.15, rotate: 90 }}
            whileTap={{ scale: 0.85 }}
            transition={{ type: "spring", stiffness: 450, damping: 20 }}
          >
            <X size={15} />
          </motion.button>
        </div>

        {/* Body */}
        <div style={{ overflowY: "auto", padding: "16px 0", flex: 1 }}>
          {availableDocs.length < 2 ? (
            <div style={{ textAlign: "center", padding: "30px 20px" }}>
              <FileText size={32} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
              <h4 style={{ fontSize: 14, color: "#FFFFFF", marginBottom: 6 }}>
                At Least 2 Documents Required
              </h4>
              <p style={{ fontSize: 12, color: "var(--text-muted-alt)", maxWidth: 380, margin: "0 auto 18px" }}>
                DocMind needs at least two documents to synthesize side-by-side comparative matrices, contracts diffs, or research evaluations.
              </p>
              <button
                className="btn btn-primary"
                onClick={() => {
                  onClose();
                  onOpenUpload();
                }}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Upload size={13} />
                <span>Upload Another Document</span>
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Controls */}
              <div
                style={{
                  background: "#080808",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  borderRadius: "var(--radius-md)",
                  padding: "14px 16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#FFFFFF", display: "block", marginBottom: 6 }}>
                    Comparison Focus Area:
                  </label>
                  <input
                    type="text"
                    className="chat-textarea"
                    value={focusTopic}
                    onChange={(e) => setFocusTopic(e.target.value)}
                    placeholder="e.g. Terms, Pricing, Methodologies, Strategic Differences"
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      background: "#111114",
                      border: "1px solid rgba(255, 255, 255, 0.15)",
                      borderRadius: "var(--radius-sm)",
                      fontSize: 12,
                      color: "#FFFFFF",
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#FFFFFF", display: "block", marginBottom: 6 }}>
                    Select Documents to Compare:
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {availableDocs.map((doc) => {
                      const isChecked = selectedIds.includes(doc.doc_id) || selectedIds.length === 0;
                      return (
                        <div
                          key={doc.doc_id}
                          onClick={() => toggleSelect(doc.doc_id)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "8px 12px",
                            background: isChecked ? "rgba(255, 255, 255, 0.08)" : "#111114",
                            border: isChecked ? "1px solid rgba(255, 255, 255, 0.4)" : "1px solid rgba(255, 255, 255, 0.1)",
                            borderRadius: "var(--radius-sm)",
                            cursor: "pointer",
                            fontSize: 12,
                            color: isChecked ? "#FFFFFF" : "var(--text-muted-alt)",
                            transition: "all 0.15s ease",
                          }}
                        >
                          {isChecked ? <CheckSquare size={14} color="#FFFFFF" /> : <Square size={14} color="var(--text-muted-alt)" />}
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: isChecked ? 600 : 400 }}>
                            {doc.filename}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
                  <button
                    className="btn btn-primary"
                    onClick={handleRun}
                    disabled={isLoading}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    {isLoading ? (
                      <>
                        <div
                          className="spin"
                          style={{
                            width: 12,
                            height: 12,
                            border: "1.5px solid #000000",
                            borderTopColor: "transparent",
                            borderRadius: "50%",
                          }}
                        />
                        <span>Generating Comparison Matrix…</span>
                      </>
                    ) : (
                      <>
                        <Sparkles size={13} />
                        <span>Run Comparative Matrix</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Output */}
              {resultMarkdown && (
                <div
                  style={{
                    background: "#080808",
                    border: "1px solid rgba(255, 255, 255, 0.15)",
                    borderRadius: "var(--radius-md)",
                    padding: "16px 20px",
                    fontSize: 13,
                    lineHeight: 1.6,
                    color: "#E2E8F0",
                  }}
                  className="message-bubble"
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
                  >
                    {preprocessMarkdown(resultMarkdown)}
                  </ReactMarkdown>

                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
