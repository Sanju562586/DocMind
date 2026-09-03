"use client";

import { useState, useCallback, useEffect } from "react";
import { X, Upload, Key, Check, AlertCircle, FileText, Shield, Layers, Cpu, CheckCircle2 } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import { ApiKeys, Document } from "@/lib/types";
import { uploadDocumentToSession } from "@/lib/api";
import NeuralWaveform from "./NeuralWaveform";

// ── API Key Modal ─────────────────────────────────────────────────────────────

interface ApiKeyModalProps {
  apiKeys: ApiKeys;
  onSave: (keys: ApiKeys) => void;
  onClose: () => void;
}

export function ApiKeyModal({ apiKeys, onSave, onClose }: ApiKeyModalProps) {
  const [keys, setKeys] = useState<ApiKeys>({ ...apiKeys });

  const handleSave = () => {
    onSave(keys);
    onClose();
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
      >
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <motion.div
              className="modal-icon-badge"
              whileHover={{ rotate: 15, scale: 1.1 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
            >
              <Key size={16} />
            </motion.div>
            <div>
              <span className="modal-title">API Keys &amp; Multi-LLM Routing</span>
              <div className="modal-subtitle">Automatic 3-Tier Cascading Failover</div>
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
          Keys remain private in your browser. If a provider hits a <strong>429 Rate Limit</strong> or server outage, DocMind seamlessly falls back to the next tier without interrupting your query.
        </p>

        <div className="api-key-form">
          {/* Gemini */}
          <div className="form-group">
            <label className="form-label">
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="provider-pill">Priority 1</span>
                <span>Google Gemini (gemini-1.5-flash)</span>
              </div>
              {keys.gemini && <Check size={13} color="#ffffff" />}
            </label>
            <input
              type="password"
              className="form-input"
              placeholder="AIzaSy..."
              value={keys.gemini}
              onChange={(e) => setKeys((k) => ({ ...k, gemini: e.target.value }))}
            />
          </div>

          {/* Groq */}
          <div className="form-group">
            <label className="form-label">
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="provider-pill">Priority 2</span>
                <span>Groq Cloud (llama-3.1-70b-versatile)</span>
              </div>
              {keys.groq && <Check size={13} color="#ffffff" />}
            </label>
            <input
              type="password"
              className="form-input"
              placeholder="gsk_..."
              value={keys.groq}
              onChange={(e) => setKeys((k) => ({ ...k, groq: e.target.value }))}
            />
          </div>

          {/* OpenRouter */}
          <div className="form-group">
            <label className="form-label">
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="provider-pill">Priority 3</span>
                <span>OpenRouter (Claude 3 / Mistral / DeepSeek)</span>
              </div>
              {keys.openrouter && <Check size={13} color="#ffffff" />}
            </label>
            <input
              type="password"
              className="form-input"
              placeholder="sk-or-..."
              value={keys.openrouter}
              onChange={(e) => setKeys((k) => ({ ...k, openrouter: e.target.value }))}
            />
          </div>

          <motion.button
            className="btn btn-primary save-btn"
            onClick={handleSave}
            whileHover={{ scale: 1.025, y: -1 }}
            whileTap={{ scale: 0.96 }}
            transition={{ type: "spring", stiffness: 400, damping: 22 }}
          >
            <Shield size={14} />
            Save &amp; Activate Multi-LLM Routing
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Document Upload Modal (Session-Scoped) ─────────────────────────────────────

type UploadStage = "idle" | "uploading" | "done" | "error";

interface DocumentUploadModalProps {
  sessionId: string;
  apiKeys: ApiKeys;
  onClose: () => void;
  onUploaded: (doc: Document) => void;
}

export function DocumentUploadModal({
  sessionId,
  apiKeys,
  onClose,
  onUploaded,
}: DocumentUploadModalProps) {
  const [stage, setStage] = useState<UploadStage>("idle");
  const [error, setError] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [ingestionStep, setIngestionStep] = useState(1);

  useEffect(() => {
    if (stage === "uploading") {
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
  }, [stage]);

  const processFile = useCallback(
    async (file: File) => {
      setSelectedFile(file);
      setStage("uploading");
      setError("");

      try {
        const doc = await uploadDocumentToSession(sessionId, file, apiKeys);
        setStage("done");
        setIngestionStep(4);
        setTimeout(() => {
          onUploaded(doc);
          onClose();
        }, 600);
      } catch (err) {
        setError((err as Error).message || "Upload failed");
        setStage("error");
      }
    },
    [sessionId, apiKeys, onUploaded, onClose]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (accepted) => accepted[0] && processFile(accepted[0]),
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "text/plain": [".txt"],
      "text/markdown": [".md"],
      "text/html": [".html", ".htm"],
      "text/csv": [".csv"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
    },
    multiple: false,
    disabled: stage === "uploading",
  });

  const fileTypes = ["PDF", "DOCX", "TXT", "MD", "HTML", "CSV", "XLSX"];

  return (
    <motion.div
      className="upload-modal-overlay"
      onClick={stage !== "uploading" ? onClose : undefined}
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
      >
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <motion.div
              className="modal-icon-badge"
              whileHover={{ rotate: 15, scale: 1.1 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
            >
              <Upload size={16} />
            </motion.div>
            <div>
              <span className="modal-title">Attach Document to Chat</span>
              <div className="modal-subtitle">Session-Scoped Neural Vectorization</div>
            </div>
          </div>
          {stage !== "uploading" && (
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
          )}
        </div>

        <p className="modal-description">
          Uploaded files are partitioned exclusively to this chat session. Global memory continues to recall insights from all other sessions.
        </p>

        {/* Dropzone */}
        {stage === "idle" && (
          <div
            {...getRootProps()}
            className={`dropzone ${isDragActive ? "drag-active" : ""}`}
          >
            <input {...getInputProps()} />
            <motion.div
              className="dropzone-icon"
              whileHover={{ scale: 1.12, rotate: 6 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
            >
              <FileText size={24} />
            </motion.div>
            <div className="dropzone-title">
              {isDragActive ? "Drop file to initiate hierarchical chunking" : "Drag & drop document here"}
            </div>
            <div className="dropzone-subtitle">or click to browse from your device</div>
            <div className="file-types">
              {fileTypes.map((t) => (
                <span key={t} className="file-type-badge">
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Progress & Processing States */}
        {(stage === "uploading" || stage === "done" || stage === "error") && selectedFile && (
          <div style={{ marginTop: 14 }}>
            <motion.div
              className="file-upload-preview-box"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
            >
              <FileText size={16} color="#ffffff" />
              <span className="file-upload-name">{selectedFile.name}</span>
              <span className="file-upload-size">
                {(selectedFile.size / 1024).toFixed(0)} KB
              </span>
            </motion.div>

            <div className="progress-bar-container">
              <motion.div
                className="progress-bar"
                initial={{ width: 0 }}
                animate={{ width: stage === "done" ? "100%" : `${ingestionStep * 24}%` }}
                transition={{ duration: 0.4 }}
              />
            </div>

            {/* Real-Time 4-Step Ingestion Stepper */}
            {(stage === "uploading" || stage === "done") && (
              <div
                style={{
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: 10,
                  padding: "12px 14px",
                  marginTop: 10,
                  marginBottom: 10,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {[
                  { step: 1, label: "File Upload & Integrity Check" },
                  { step: 2, label: "Text Extraction & Multimodal OCR" },
                  { step: 3, label: "Hierarchical Semantic Chunking" },
                  { step: 4, label: "Dense Vector & BM25 Hybrid Indexing" },
                ].map(({ step, label }) => {
                  const isFinished = stage === "done" || ingestionStep > step;
                  const isCurrent = stage === "uploading" && ingestionStep === step;

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
                        transition: "color 0.2s ease",
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

            <div className="upload-status-row">
              {stage === "uploading" && (
                <div style={{ width: "100%" }}>
                  <NeuralWaveform
                    label="Uploading file to server…"
                    barCount={16}
                    active={true}
                  />
                </div>
              )}
              {stage === "done" && (
                <motion.div
                  style={{ display: "flex", alignItems: "center", gap: 7, color: "#ffffff", fontSize: 13, fontWeight: 600 }}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 25 }}
                >
                  <Check size={16} color="#ffffff" />
                  <span>Successfully uploaded document</span>
                </motion.div>
              )}
              {stage === "error" && (
                <motion.div
                  style={{ display: "flex", alignItems: "center", gap: 7, color: "#ffffff", fontSize: 13 }}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                >
                  <AlertCircle size={16} color="#ffffff" />
                  <span>{error}</span>
                </motion.div>
              )}
            </div>

            {stage === "error" && (
              <motion.button
                className="btn btn-outline"
                style={{ width: "100%", marginTop: 14 }}
                onClick={() => {
                  setStage("idle");
                  setSelectedFile(null);
                }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.96 }}
              >
                Try Again
              </motion.button>
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
