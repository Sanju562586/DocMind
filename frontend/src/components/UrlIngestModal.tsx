"use client";

import { useState, useEffect } from "react";
import { Globe, X, ArrowRight, Link as LinkIcon, Sparkles, Check } from "lucide-react";
import { motion } from "framer-motion";

interface UrlIngestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onIngest: (url: string) => Promise<void>;
  isLoading: boolean;
}

export function UrlIngestModal({ isOpen, onClose, onIngest, isLoading }: UrlIngestModalProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [ingestionStep, setIngestionStep] = useState(1);

  useEffect(() => {
    if (isLoading) {
      setIngestionStep(1);
      const t1 = setTimeout(() => setIngestionStep(2), 600);
      const t2 = setTimeout(() => setIngestionStep(3), 1400);
      const t3 = setTimeout(() => setIngestionStep(4), 2200);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }
  }, [isLoading]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Please enter a valid website URL");
      return;
    }
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
      setError("URL must start with http:// or https://");
      return;
    }

    try {
      await onIngest(trimmed);
      setUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to ingest URL");
    }
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
        style={{ maxWidth: 520 }}
      >
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <motion.div
              className="modal-icon-badge"
              whileHover={{ rotate: 15, scale: 1.1 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
            >
              <Globe size={16} />
            </motion.div>
            <div>
              <span className="modal-title">Ingest Web Page URL</span>
              <div className="modal-subtitle">Direct Web Article &amp; Documentation Ingestion</div>
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

        <p className="modal-description">
          Provide any public article, documentation, or blog URL. DocMind will extract, clean, and chunk the content for instant citation-grounded RAG.
        </p>

        <form onSubmit={handleSubmit} style={{ marginTop: 14 }}>
          <div style={{ position: "relative", width: "100%" }}>
            <LinkIcon
              size={14}
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--text-muted-alt)",
              }}
            />
            <input
              type="url"
              className="chat-textarea"
              placeholder="https://en.wikipedia.org/wiki/Artificial_intelligence"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (error) setError("");
              }}
              disabled={isLoading}
              style={{
                width: "100%",
                paddingLeft: 34,
                paddingRight: 12,
                height: 42,
                borderRadius: "var(--radius-md)",
                background: "#080808",
                border: error ? "1px solid #EF4444" : "1px solid rgba(255, 255, 255, 0.15)",
                fontSize: 13,
                color: "#FFFFFF",
              }}
              autoFocus
            />
          </div>

          {/* Real-Time 4-Step URL Ingestion Stepper */}
          {isLoading && (
            <div
              style={{
                background: "rgba(255, 255, 255, 0.03)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 10,
                padding: "12px 14px",
                marginTop: 14,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {[
                { step: 1, label: "Connecting & Fetching HTML Content" },
                { step: 2, label: "Cleaning Boilerplate & Parsing Article" },
                { step: 3, label: "Hierarchical Contextual Chunking" },
                { step: 4, label: "Neural Vector & BM25 Indexing" },
              ].map(({ step, label }) => {
                const isFinished = ingestionStep > step;
                const isCurrent = ingestionStep === step;

                return (
                  <div
                    key={step}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      fontSize: 12,
                      color: isFinished
                        ? "#4ADE80"
                        : isCurrent
                        ? "#FFFFFF"
                        : "rgba(255, 255, 255, 0.35)",
                      fontWeight: isCurrent || isFinished ? 500 : 400,
                    }}
                  >
                    <div
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 10,
                        fontWeight: 700,
                        background: isFinished
                          ? "rgba(74, 222, 128, 0.15)"
                          : isCurrent
                          ? "rgba(255, 255, 255, 0.15)"
                          : "rgba(255, 255, 255, 0.05)",
                        border: isFinished
                          ? "1px solid #4ADE80"
                          : isCurrent
                          ? "1px solid #FFFFFF"
                          : "1px solid rgba(255, 255, 255, 0.1)",
                      }}
                    >
                      {isFinished ? (
                        <Check size={11} color="#4ADE80" />
                      ) : isCurrent ? (
                        <div
                          className="spin"
                          style={{
                            width: 8,
                            height: 8,
                            border: "1.2px solid #FFFFFF",
                            borderTopColor: "transparent",
                            borderRadius: "50%",
                          }}
                        />
                      ) : (
                        step
                      )}
                    </div>
                    <span>{label}</span>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
            <button
              type="button"
              className="btn btn-outline"
              onClick={onClose}
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isLoading || !url.trim()}
              style={{ display: "flex", alignItems: "center", gap: 6 }}
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
                  <span>Ingesting Web Content…</span>
                </>
              ) : (
                <>
                  <Sparkles size={13} />
                  <span>Ingest &amp; Index URL</span>
                  <ArrowRight size={13} />
                </>
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
