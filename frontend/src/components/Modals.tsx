"use client";

import { useState, useCallback, useEffect } from "react";
import { X, Upload, Key, Check, AlertCircle, FileText, Shield, Layers, Cpu, CheckCircle2, Lock, Trash2, RefreshCw } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import { ApiKeys, Document, KeyStatus } from "@/lib/types";
import { uploadDocumentToSession, fetchKeyStatus, saveSecureKeys, clearSecureKeys } from "@/lib/api";
import NeuralWaveform from "./NeuralWaveform";

// ── API Key Modal (HTTP-Only Cookie & Backend Proxy Security) ─────────────────

interface ApiKeyModalProps {
  apiKeys?: ApiKeys;
  onSave?: (keys: ApiKeys) => void;
  onClose: () => void;
}

export function ApiKeyModal({ apiKeys, onSave, onClose }: ApiKeyModalProps) {
  const [keys, setKeys] = useState<ApiKeys>(apiKeys || { gemini: "", groq: "", openrouter: "" });
  const [status, setStatus] = useState<KeyStatus>({
    gemini_configured: false,
    groq_configured: false,
    openrouter_configured: false,
    has_custom_keys: false,
    has_server_keys: false,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (apiKeys) {
      setKeys(apiKeys);
    }
    fetchKeyStatus().then((s) => setStatus(s));
  }, [apiKeys]);

  const handleSave = async () => {
    setIsSaving(true);
    setMessage("");
    try {
      await saveSecureKeys(keys);
      onSave?.(keys);
      const updatedStatus = await fetchKeyStatus();
      setStatus(updatedStatus);
      setMessage("✓ Keys saved securely in HTTP-only encrypted cookie. Never exposed to browser storage.");
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to store API keys";
      setMessage(`⚠️ ${msg}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    setIsSaving(true);
    try {
      await clearSecureKeys();
      setKeys({ gemini: "", groq: "", openrouter: "" });
      const updatedStatus = await fetchKeyStatus();
      setStatus(updatedStatus);
      setMessage("✓ Custom cookie keys cleared.");
    } catch {
      // ignore
    } finally {
      setIsSaving(false);
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
      >
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <motion.div
              className="modal-icon-badge"
              whileHover={{ rotate: 15, scale: 1.1 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
            >
              <Lock size={16} color="#60a5fa" />
            </motion.div>
            <div>
              <span className="modal-title">API Key Security &amp; LLM Routing</span>
              <div className="modal-subtitle">HTTP-Only Encrypted Cookies &amp; Server Proxy</div>
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

        <div
          style={{
            marginTop: 10,
            marginBottom: 14,
            padding: "8px 12px",
            borderRadius: 8,
            background: "rgba(16, 185, 129, 0.1)",
            border: "1px solid rgba(16, 185, 129, 0.25)",
            fontSize: 11,
            color: "#6ee7b7",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Shield size={14} />
          <span>
            <strong>Zero Plaintext Storage:</strong> Keys are stored in an HTTP-only, SameSite=Strict cookie and proxied server-to-server. Browser scripts never touch your keys.
          </span>
        </div>

        {message && (
          <div
            style={{
              marginBottom: 12,
              padding: "8px 12px",
              borderRadius: 6,
              background: message.startsWith("⚠️") ? "rgba(239, 68, 68, 0.15)" : "rgba(99, 102, 241, 0.15)",
              color: message.startsWith("⚠️") ? "#fca5a5" : "#c7d2fe",
              fontSize: 12,
            }}
          >
            {message}
          </div>
        )}

        <div className="api-key-form">
          {/* Gemini */}
          <div className="form-group">
            <label className="form-label">
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="provider-pill">Priority 1</span>
                <span>Google Gemini (gemini-2.0-flash)</span>
              </div>
              {status.gemini_configured && (
                <span style={{ fontSize: 10, color: "#10b981", display: "flex", alignItems: "center", gap: 3 }}>
                  <Check size={11} /> Configured
                </span>
              )}
            </label>
            <input
              type="password"
              className="form-input"
              placeholder={status.gemini_configured ? "••••••••••••••••••••••••" : "AIzaSy..."}
              value={keys.gemini}
              onChange={(e) => setKeys((k) => ({ ...k, gemini: e.target.value }))}
            />
          </div>

          {/* Groq */}
          <div className="form-group">
            <label className="form-label">
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="provider-pill">Priority 2</span>
                <span>Groq Cloud (llama-3.3-70b-versatile)</span>
              </div>
              {status.groq_configured && (
                <span style={{ fontSize: 10, color: "#10b981", display: "flex", alignItems: "center", gap: 3 }}>
                  <Check size={11} /> Configured
                </span>
              )}
            </label>
            <input
              type="password"
              className="form-input"
              placeholder={status.groq_configured ? "••••••••••••••••••••••••" : "gsk_..."}
              value={keys.groq}
              onChange={(e) => setKeys((k) => ({ ...k, groq: e.target.value }))}
            />
          </div>

          {/* OpenRouter */}
          <div className="form-group">
            <label className="form-label">
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="provider-pill">Priority 3</span>
                <span>OpenRouter (Claude 3.5 / Mistral)</span>
              </div>
              {status.openrouter_configured && (
                <span style={{ fontSize: 10, color: "#10b981", display: "flex", alignItems: "center", gap: 3 }}>
                  <Check size={11} /> Configured
                </span>
              )}
            </label>
            <input
              type="password"
              className="form-input"
              placeholder={status.openrouter_configured ? "••••••••••••••••••••••••" : "sk-or-..."}
              value={keys.openrouter}
              onChange={(e) => setKeys((k) => ({ ...k, openrouter: e.target.value }))}
            />
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <motion.button
              className="btn btn-primary save-btn"
              onClick={handleSave}
              disabled={isSaving}
              style={{ flex: 2 }}
              whileHover={{ scale: 1.025, y: -1 }}
              whileTap={{ scale: 0.96 }}
            >
              <Shield size={14} />
              {isSaving ? "Saving to Secure Cookie..." : "Save in HTTP-Only Cookie"}
            </motion.button>

            {status.has_custom_keys && (
              <button
                type="button"
                onClick={handleClear}
                disabled={isSaving}
                style={{
                  flex: 1,
                  background: "rgba(239, 68, 68, 0.15)",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  color: "#f87171",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                <Trash2 size={13} /> Clear Keys
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Document Upload Modal (Session-Scoped & Server-Side Sanitized) ──────────────

type UploadStage = "idle" | "uploading" | "done" | "error";

interface DocumentUploadModalProps {
  sessionId: string;
  apiKeys?: ApiKeys;
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
              <div className="modal-subtitle">Server-Side MIME Verification &amp; Sanitization</div>
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
          Uploaded files undergo server-side magic byte inspection, path sanitization, and are partitioned exclusively to this session.
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

            <div className="ingestion-step-list">
              <div className={`step-item ${ingestionStep >= 1 ? "active" : ""}`}>
                <span className="step-num">1</span>
                <span>Server-side MIME verification &amp; sanitization</span>
              </div>
              <div className={`step-item ${ingestionStep >= 2 ? "active" : ""}`}>
                <span className="step-num">2</span>
                <span>AST structure &amp; hierarchical chunking</span>
              </div>
              <div className={`step-item ${ingestionStep >= 3 ? "active" : ""}`}>
                <span className="step-num">3</span>
                <span>Dense embeddings &amp; BM25 vector index</span>
              </div>
              <div className={`step-item ${ingestionStep >= 4 ? "active" : ""}`}>
                <span className="step-num">4</span>
                <span>Context ready for grounded Q&amp;A</span>
              </div>
            </div>

            {stage === "uploading" && (
              <div style={{ marginTop: 14, textAlign: "center" }}>
                <NeuralWaveform active={true} />
              </div>
            )}
          </div>
        )}

        {stage === "error" && (
          <div className="upload-error" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <AlertCircle size={16} color="#ef4444" />
            <span>{error}</span>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
