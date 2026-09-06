"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Share2,
  Copy,
  Check,
  Globe,
  Lock,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";
import { Session } from "@/lib/types";
import { createShareLink, revokeShareLink } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: Session | null;
  onSessionUpdated?: (updated: Partial<Session>) => void;
}

export function ShareModal({
  isOpen,
  onClose,
  session,
  onSessionUpdated,
}: ShareModalProps) {
  const [isShared, setIsShared] = useState(false);
  const [shareToken, setShareToken] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session) {
      setIsShared(Boolean(session.is_shared && session.share_token));
      setShareToken(session.share_token || "");
      setError(null);
    }
  }, [session, isOpen]);

  if (!isOpen || !session) return null;

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const shareUrl = shareToken ? `${origin}/share/${shareToken}` : "";

  const handleToggleShare = async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (!isShared) {
        // Enable sharing
        const res = await createShareLink(session.id);
        setIsShared(true);
        setShareToken(res.share_token);
        onSessionUpdated?.({
          is_shared: true,
          share_token: res.share_token,
          shared_at: res.shared_at,
        });
      } else {
        // Revoke sharing
        await revokeShareLink(session.id);
        setIsShared(false);
        setShareToken("");
        onSessionUpdated?.({
          is_shared: false,
          share_token: undefined,
          shared_at: undefined,
        });
      }
    } catch (err: any) {
      setError(err?.message || "Failed to update share settings");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    const ok = await copyToClipboard(shareUrl);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } else {
      setError("Failed to copy link to clipboard");
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        className="upload-modal-overlay"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        style={{ zIndex: 99998 }}
      >
        <motion.div
          className="upload-modal modal-3d"
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.94, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 20 }}
          transition={{ type: "spring", stiffness: 450, damping: 30 }}
          style={{ maxWidth: 520 }}
        >
          {/* Header */}
          <div className="modal-header">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <motion.div
                className="modal-icon-badge"
                whileHover={{ rotate: 15, scale: 1.1 }}
                transition={{ type: "spring", stiffness: 400, damping: 20 }}
              >
                <Share2 size={16} color="#60a5fa" />
              </motion.div>
              <div>
                <span className="modal-title">Share Conversation</span>
                <div className="modal-subtitle">
                  {session.title || "Current Conversation"}
                </div>
              </div>
            </div>
            <motion.button
              className="modal-close"
              onClick={onClose}
              aria-label="Close modal"
              whileHover={{ scale: 1.15, rotate: 90 }}
              whileTap={{ scale: 0.85 }}
            >
              <X size={15} />
            </motion.button>
          </div>

          <div style={{ padding: "18px 22px" }}>
            {error && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 14px",
                  borderRadius: 8,
                  background: "rgba(239, 68, 68, 0.15)",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  color: "#fca5a5",
                  fontSize: 12,
                  marginBottom: 16,
                }}
              >
                <AlertCircle size={15} />
                <span>{error}</span>
              </div>
            )}

            {/* Sharing Status Card */}
            <div
              style={{
                padding: "16px",
                borderRadius: 12,
                background: isShared
                  ? "rgba(16, 185, 129, 0.08)"
                  : "rgba(255, 255, 255, 0.03)",
                border: isShared
                  ? "1px solid rgba(16, 185, 129, 0.25)"
                  : "1px solid rgba(255, 255, 255, 0.08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 18,
                transition: "all 0.2s ease",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    background: isShared
                      ? "rgba(16, 185, 129, 0.2)"
                      : "rgba(255, 255, 255, 0.06)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {isShared ? (
                    <Globe size={18} color="#34d399" />
                  ) : (
                    <Lock size={18} color="rgba(255, 255, 255, 0.5)" />
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>
                    {isShared ? "Public Link Sharing Active" : "Private Conversation"}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: isShared ? "#a7f3d0" : "rgba(255, 255, 255, 0.5)",
                    }}
                  >
                    {isShared
                      ? "Anyone with the link can view the transcript"
                      : "Only you can view and edit this chat"}
                  </div>
                </div>
              </div>

              <motion.button
                onClick={handleToggleShare}
                disabled={isLoading}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                style={{
                  padding: "7px 14px",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: isLoading ? "wait" : "pointer",
                  border: "none",
                  background: isShared ? "#ef4444" : "#3b82f6",
                  color: "#fff",
                  boxShadow: isShared
                    ? "0 2px 8px rgba(239, 68, 68, 0.3)"
                    : "0 2px 8px rgba(59, 130, 246, 0.3)",
                }}
              >
                {isLoading
                  ? "Updating..."
                  : isShared
                  ? "Revoke Link"
                  : "Enable Public Link"}
              </motion.button>
            </div>

            {/* Active Share Link Field */}
            {isShared && shareUrl && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                style={{ display: "flex", flexDirection: "column", gap: 12 }}
              >
                <div style={{ fontSize: 12, fontWeight: 500, color: "#93c5fd" }}>
                  Public Share Link:
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    background: "rgba(0, 0, 0, 0.3)",
                    border: "1px solid rgba(96, 165, 250, 0.25)",
                    borderRadius: 8,
                    padding: "6px 8px 6px 12px",
                  }}
                >
                  <input
                    type="text"
                    readOnly
                    value={shareUrl}
                    style={{
                      flex: 1,
                      background: "transparent",
                      border: "none",
                      color: "#e2e8f0",
                      fontSize: 12,
                      fontFamily: "monospace",
                      outline: "none",
                    }}
                    onFocus={(e) => e.target.select()}
                  />

                  <motion.button
                    type="button"
                    onClick={handleCopy}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "6px 12px",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      background: copied ? "#10b981" : "#3b82f6",
                      color: "#fff",
                      border: "none",
                      cursor: "pointer",
                      transition: "background 0.2s",
                    }}
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                    {copied ? "Copied!" : "Copy Link"}
                  </motion.button>

                  <a
                    href={shareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: 7,
                      borderRadius: 6,
                      background: "rgba(255, 255, 255, 0.08)",
                      color: "rgba(255, 255, 255, 0.8)",
                      textDecoration: "none",
                    }}
                    title="Open share preview in new tab"
                  >
                    <ExternalLink size={14} />
                  </a>
                </div>

                {/* Privacy & Grounding Guarantees */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: "rgba(59, 130, 246, 0.06)",
                    border: "1px solid rgba(59, 130, 246, 0.15)",
                    fontSize: 11,
                    color: "rgba(255, 255, 255, 0.7)",
                    lineHeight: 1.45,
                    marginTop: 4,
                  }}
                >
                  <ShieldCheck size={16} color="#60a5fa" style={{ flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <strong>Privacy Protected:</strong> Your private API keys, account credentials,
                    and unrelated conversations are never exposed. Visitors can only read this
                    specific transcript and its citations.
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
