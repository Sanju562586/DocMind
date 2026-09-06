"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Shield,
  UserCheck,
  Sparkles,
  LogIn,
  LogOut,
  Mail,
  User,
  ArrowRight,
  CheckCircle2,
  Lock,
  Globe,
} from "lucide-react";
import { useAuth, DEMO_PROFILES } from "@/lib/auth";

export function AuthModal() {
  const {
    user,
    isAuthenticated,
    isAuthModalOpen,
    closeAuthModal,
    loginDemo,
    loginWithCredentials,
    loginWithOAuth,
    logout,
  } = useAuth();

  const [tab, setTab] = useState<"demo" | "oauth" | "email">("demo");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  if (!isAuthModalOpen) return null;

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setIsLoading(true);
    setTimeout(() => {
      loginWithCredentials(email, name);
      setIsLoading(false);
    }, 250);
  };

  const handleOAuthClick = async (provider: "google" | "github") => {
    setIsLoading(true);
    await loginWithOAuth(provider);
    setIsLoading(false);
  };

  return (
    <AnimatePresence>
      <motion.div
        className="upload-modal-overlay"
        onClick={closeAuthModal}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        style={{ zIndex: 99999 }}
      >
        <motion.div
          className="upload-modal modal-3d"
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.94, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 20 }}
          transition={{ type: "spring", stiffness: 450, damping: 30 }}
          style={{ maxWidth: 540 }}
        >
          {/* Header */}
          <div className="modal-header">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <motion.div
                className="modal-icon-badge"
                whileHover={{ rotate: 15, scale: 1.1 }}
                transition={{ type: "spring", stiffness: 400, damping: 20 }}
              >
                <Shield size={16} color="#60a5fa" />
              </motion.div>
              <div>
                <span className="modal-title">DocMind Security &amp; Identity</span>
                <div className="modal-subtitle">Private, User-Isolated Workspaces</div>
              </div>
            </div>
            <motion.button
              className="modal-close"
              onClick={closeAuthModal}
              aria-label="Close modal"
              whileHover={{ scale: 1.15, rotate: 90 }}
              whileTap={{ scale: 0.85 }}
            >
              <X size={15} />
            </motion.button>
          </div>

          {/* Current User Status Banner */}
          <div
            style={{
              marginTop: 12,
              marginBottom: 16,
              padding: "12px 14px",
              borderRadius: 12,
              background: "rgba(255, 255, 255, 0.03)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  fontSize: 18,
                  width: 38,
                  height: 38,
                  borderRadius: "50%",
                  background: "rgba(99, 102, 241, 0.15)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid rgba(99, 102, 241, 0.3)",
                  flexShrink: 0,
                }}
              >
                {user?.image === "🌐" ? <Globe size={20} color="#60a5fa" /> : user?.image || "👤"}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>
                  {user?.name || "Guest User"}
                </div>
                <div style={{ fontSize: 11, color: "rgba(255, 255, 255, 0.55)" }}>
                  {user?.email} • <span style={{ color: "#60a5fa", fontWeight: 600 }}>{user?.role || "Active"}</span>
                </div>
              </div>
            </div>
            {isAuthenticated ? (
              <button
                onClick={logout}
                style={{
                  background: "rgba(239, 68, 68, 0.1)",
                  border: "1px solid rgba(239, 68, 68, 0.35)",
                  color: "#f87171",
                  borderRadius: 8,
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  transition: "all 0.15s ease",
                }}
              >
                <LogOut size={13} /> Sign Out
              </button>
            ) : (
              <span
                style={{
                  fontSize: 10,
                  padding: "4px 10px",
                  borderRadius: 12,
                  background: "rgba(234, 179, 8, 0.15)",
                  color: "#facc15",
                  border: "1px solid rgba(234, 179, 8, 0.3)",
                }}
              >
                Guest Mode
              </span>
            )}
          </div>

          {/* Navigation Tabs */}
          <div
            style={{
              display: "flex",
              gap: 6,
              marginBottom: 16,
              background: "rgba(0, 0, 0, 0.25)",
              padding: 4,
              borderRadius: 8,
            }}
          >
            <button
              onClick={() => setTab("demo")}
              style={{
                flex: 1,
                padding: "7px 10px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                background: tab === "demo" ? "rgba(99, 102, 241, 0.25)" : "transparent",
                color: tab === "demo" ? "#ffffff" : "rgba(255, 255, 255, 0.6)",
                border: tab === "demo" ? "1px solid rgba(99, 102, 241, 0.4)" : "1px solid transparent",
                transition: "all 0.15s ease",
              }}
            >
              1-Click Demo Profiles
            </button>
            <button
              onClick={() => setTab("oauth")}
              style={{
                flex: 1,
                padding: "7px 10px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                background: tab === "oauth" ? "rgba(99, 102, 241, 0.25)" : "transparent",
                color: tab === "oauth" ? "#ffffff" : "rgba(255, 255, 255, 0.6)",
                border: tab === "oauth" ? "1px solid rgba(99, 102, 241, 0.4)" : "1px solid transparent",
                transition: "all 0.15s ease",
              }}
            >
              OAuth Providers
            </button>
            <button
              onClick={() => setTab("email")}
              style={{
                flex: 1,
                padding: "7px 10px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                background: tab === "email" ? "rgba(99, 102, 241, 0.25)" : "transparent",
                color: tab === "email" ? "#ffffff" : "rgba(255, 255, 255, 0.6)",
                border: tab === "email" ? "1px solid rgba(99, 102, 241, 0.4)" : "1px solid transparent",
                transition: "all 0.15s ease",
              }}
            >
              Custom Login
            </button>
          </div>

          {/* Tab 1: Demo Profiles */}
          {tab === "demo" && (
            <div>
              <p style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.65)", marginBottom: 12 }}>
                Switch between isolated user accounts instantly to verify cross-user isolation:
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {DEMO_PROFILES.map((profile) => {
                  const isActive = user?.email === profile.email;
                  return (
                    <div
                      key={profile.key}
                      onClick={() => loginDemo(profile.key)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 8,
                        background: isActive ? "rgba(99, 102, 241, 0.15)" : "rgba(255, 255, 255, 0.03)",
                        border: isActive ? "1px solid #6366f1" : "1px solid rgba(255, 255, 255, 0.08)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 22 }}>{profile.avatar}</span>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>
                            {profile.name}{" "}
                            <span style={{ fontSize: 11, fontWeight: 400, color: "#60a5fa" }}>
                              ({profile.role})
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: "rgba(255, 255, 255, 0.5)" }}>
                            {profile.description}
                          </div>
                        </div>
                      </div>
                      {isActive ? (
                        <CheckCircle2 size={16} color="#60a5fa" />
                      ) : (
                        <ArrowRight size={14} color="rgba(255, 255, 255, 0.4)" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tab 2: OAuth Single Sign-On */}
          {tab === "oauth" && (
            <div>
              <p style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.65)", marginBottom: 14 }}>
                Sign in with your enterprise or developer identity provider via NextAuth.js:
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {/* Google */}
                <button
                  type="button"
                  onClick={() => handleOAuthClick("google")}
                  disabled={isLoading}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    padding: "11px 16px",
                    borderRadius: 8,
                    background: "rgba(255, 255, 255, 0.08)",
                    border: "1px solid rgba(255, 255, 255, 0.15)",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  Continue with Google
                </button>

                {/* GitHub */}
                <button
                  type="button"
                  onClick={() => handleOAuthClick("github")}
                  disabled={isLoading}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    padding: "11px 16px",
                    borderRadius: 8,
                    background: "rgba(255, 255, 255, 0.08)",
                    border: "1px solid rgba(255, 255, 255, 0.15)",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      clipRule="evenodd"
                      d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                    />
                  </svg>
                  Continue with GitHub
                </button>
              </div>
            </div>
          )}

          {/* Tab 3: Custom Login */}
          {tab === "email" && (
            <form onSubmit={handleCustomSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "rgba(255, 255, 255, 0.7)", display: "block", marginBottom: 4 }}>
                  Full Name
                </label>
                <div style={{ position: "relative" }}>
                  <User size={14} style={{ position: "absolute", left: 10, top: 11, color: "rgba(255, 255, 255, 0.4)" }} />
                  <input
                    type="text"
                    placeholder="e.g. Dr. Jane Doe"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 10px 8px 32px",
                      borderRadius: 6,
                      background: "rgba(255, 255, 255, 0.05)",
                      border: "1px solid rgba(255, 255, 255, 0.12)",
                      color: "#fff",
                      fontSize: 12,
                      outline: "none",
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "rgba(255, 255, 255, 0.7)", display: "block", marginBottom: 4 }}>
                  Email Address *
                </label>
                <div style={{ position: "relative" }}>
                  <Mail size={14} style={{ position: "absolute", left: 10, top: 11, color: "rgba(255, 255, 255, 0.4)" }} />
                  <input
                    type="email"
                    required
                    placeholder="jane@university.edu"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 10px 8px 32px",
                      borderRadius: 6,
                      background: "rgba(255, 255, 255, 0.05)",
                      border: "1px solid rgba(255, 255, 255, 0.12)",
                      color: "#fff",
                      fontSize: 12,
                      outline: "none",
                    }}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading || !email}
                style={{
                  marginTop: 6,
                  padding: "10px",
                  borderRadius: 6,
                  background: "linear-gradient(135deg, #6366f1, #3b82f6)",
                  border: "none",
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                <LogIn size={14} /> Sign In to Private Workspace
              </button>
            </form>
          )}

          {/* Cross-Device Sync Info Banner */}
          <div
            style={{
              marginBottom: 14,
              padding: "10px 12px",
              borderRadius: 8,
              background: "rgba(96, 165, 250, 0.08)",
              border: "1px solid rgba(96, 165, 250, 0.2)",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <Sparkles size={16} color="#60a5fa" style={{ flexShrink: 0 }} />
            <div style={{ fontSize: 11, color: "rgba(255, 255, 255, 0.8)", lineHeight: 1.4 }}>
              <strong style={{ color: "#60a5fa" }}>Multi-Device Cloud Sync:</strong> Sign in with the same email or profile across your phone, tablet, or laptop to instantly access all your conversations and documents.
            </div>
          </div>

          {/* Footer Security Note */}
          <div
            style={{
              marginTop: 18,
              paddingTop: 12,
              borderTop: "1px solid rgba(255, 255, 255, 0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 11,
              color: "rgba(255, 255, 255, 0.45)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Lock size={12} color="#10b981" />
              Private user-isolated encryption
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, color: "#60a5fa" }}>
              <Globe size={11} />
              Cross-device sync active
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
export default AuthModal;
