"use client";

import { motion } from "framer-motion";
import { X, Layers, CheckCircle2 } from "lucide-react";

interface PipelineModalProps {
  onClose: () => void;
}

export function PipelineModal({ onClose }: PipelineModalProps) {
  const steps = [
    {
      step: "01",
      name: "Document Ingestion & Multi-Format Parsing",
      desc: "Extracts raw text, table structures, and sections from PDF, DOCX, TXT, CSV, and XLSX files.",
      tag: "Session Scoped",
    },
    {
      step: "02",
      name: "Hierarchical Semantic Chunking",
      desc: "Builds dual-layer parent (~512 tokens) and child (~128 tokens) chunks with contextual section headers.",
      tag: "Parent-Child RAG",
    },
    {
      step: "03",
      name: "Hybrid Dual Retrieval (BM25 + Dense RRF)",
      desc: "Combines exact keyword term frequency (BM25) with dense neural embeddings using Reciprocal Rank Fusion.",
      tag: "Dual Index",
    },
    {
      step: "04",
      name: "Cross-Encoder Joint Reranking",
      desc: "Evaluates candidate chunk query pairs with deep cross-attention transformer reranking for high relevance.",
      tag: "Precision Top-K",
    },
    {
      step: "05",
      name: "Cascading Multi-LLM Generation & Global Memory",
      desc: "Streams synthesized responses with multi-tier failover (Gemini → Groq → OpenRouter) while preserving cross-chat insights.",
      tag: "Zero Downtime",
    },
  ];

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
        style={{ maxWidth: 620 }}
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
              <Layers size={16} color="#FFFFFF" />
            </motion.div>
            <div>
              <span className="modal-title">AI Intelligence Pipeline</span>
              <div className="modal-subtitle">End-to-End Hierarchical RAG Architecture</div>
            </div>
          </div>
          <motion.button
            className="modal-close"
            onClick={onClose}
            aria-label="Close pipeline modal"
            whileHover={{ scale: 1.15, rotate: 90 }}
            whileTap={{ scale: 0.85 }}
          >
            <X size={15} color="#FFFFFF" />
          </motion.button>
        </div>

        <p className="modal-description">
          DocMind utilizes an advanced 5-stage retrieval-augmented generation pipeline with parent-child chunking, reciprocal rank fusion, and cross-encoder neural reranking.
        </p>

        {/* Pipeline Stages Vertical Stepper */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "14px 0 18px" }}>
          {steps.map((s, idx) => (
            <motion.div
              key={s.step}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.06 }}
              style={{
                padding: "10px 14px",
                background: "#111111",
                border: "1px solid var(--border-strong)",
                borderRadius: "var(--radius-md)",
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: "#FFFFFF",
                  background: "rgba(255, 255, 255, 0.1)",
                  padding: "3px 6px",
                  borderRadius: "var(--radius-xs)",
                  fontFamily: "JetBrains Mono, monospace",
                }}
              >
                {s.step}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 4, marginBottom: 2 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "#FFFFFF" }}>{s.name}</span>
                  <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", color: "#FFFFFF", background: "rgba(255, 255, 255, 0.08)", padding: "1px 5px", borderRadius: 4, flexShrink: 0 }}>
                    {s.tag}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.45 }}>{s.desc}</div>
              </div>
            </motion.div>
          ))}
        </div>

        <motion.button
          className="btn btn-primary save-btn"
          onClick={onClose}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.96 }}
        >
          <CheckCircle2 size={14} color="#000000" />
          <span>Close Pipeline Inspector</span>
        </motion.button>
      </motion.div>
    </motion.div>
  );
}
