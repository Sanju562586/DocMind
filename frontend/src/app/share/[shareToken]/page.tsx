"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { format } from "date-fns";
import {
  Sparkles,
  Copy,
  Check,
  FileText,
  Lock,
  Globe,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  ExternalLink,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Clock,
  MessageSquare,
} from "lucide-react";
import { getSharedChat } from "@/lib/api";
import { SharedSession, Source } from "@/lib/types";
import { preprocessMarkdown } from "@/lib/markdown";

// ── Copyable Code Block Component ─────────────────────────────────────────────

function CodeBlock({ children, className }: { children: React.ReactNode; className?: string }) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || "");
  const language = match ? match[1] : "";
  const codeText = String(children).replace(/\n$/, "");

  const handleCopy = () => {
    navigator.clipboard.writeText(codeText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <span className="code-block-lang">{language || "code"}</span>
        <motion.button
          className="code-copy-btn"
          onClick={handleCopy}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          title="Copy code snippet"
          type="button"
        >
          {copied ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#22C55E" }}>
              <Check size={12} />
              <span>Copied</span>
            </span>
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Copy size={12} />
              <span>Copy</span>
            </span>
          )}
        </motion.button>
      </div>
      <pre className="code-block-pre">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

// ── Source Citation Card ──────────────────────────────────────────────────────

function SharedSourceCard({ source }: { source: Source }) {
  const matchScore = source.score !== undefined ? source.score : source.rerank_score;
  const textSnippet = source.snippet || source.child_text || "";

  return (
    <div
      style={{
        padding: "10px 14px",
        background: "rgba(255, 255, 255, 0.03)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: "var(--radius-md, 8px)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: "#FFFFFF" }}>
          <FileText size={12} color="#A3A3A3" />
          <span>{source.title || "Document Source"}</span>
          {source.section && (
            <span style={{ color: "rgba(255, 255, 255, 0.4)", fontWeight: 400 }}>• {source.section}</span>
          )}
        </div>
        {matchScore !== undefined && matchScore > 0 && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "2px 6px",
              borderRadius: 4,
              background: "rgba(255, 255, 255, 0.08)",
              color: "#E5E5E5",
            }}
          >
            {(matchScore * (matchScore <= 1 ? 100 : 1)).toFixed(0)}% Match
          </span>
        )}
      </div>
      {textSnippet && (
        <p
          style={{
            fontSize: 11.5,
            color: "rgba(255, 255, 255, 0.7)",
            lineHeight: 1.5,
            margin: 0,
            fontStyle: "italic",
          }}
        >
          &ldquo;{textSnippet}&rdquo;
        </p>
      )}
    </div>
  );
}

// ── Main Shared Transcript Page ───────────────────────────────────────────────

export default function SharedChatPage() {
  const params = useParams();
  const shareToken = (params?.shareToken as string) || "";

  const [session, setSession] = useState<SharedSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  useEffect(() => {
    if (!shareToken) {
      setError("No share token provided in the URL.");
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    getSharedChat(shareToken)
      .then((data) => {
        if (isMounted) {
          setSession(data);
          setIsLoading(false);
        }
      })
      .catch((err: any) => {
        if (isMounted) {
          setError(
            err?.message ||
              "This shared conversation does not exist, has expired, or the owner revoked public access."
          );
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [shareToken]);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const top = el.scrollTop;
    const bottomDist = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollTop(top > 250);
    setShowScrollBottom(bottomDist > 250);
  }, []);

  const scrollToTop = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const scrollToBottom = () => {
    if (!scrollContainerRef.current) return;
    scrollContainerRef.current.scrollTo({
      top: scrollContainerRef.current.scrollHeight,
      behavior: "smooth",
    });
  };

  const handleCopyLink = () => {
    if (typeof window === "undefined") return;
    navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2200);
  };

  const handleCopyMessage = (msgId: string, text: string) => {
    if (typeof window === "undefined") return;
    navigator.clipboard.writeText(text);
    setCopiedMsgId(msgId);
    setTimeout(() => setCopiedMsgId(null), 2000);
  };

  const toggleSourceExpansion = (messageId: string) => {
    setExpandedSources((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }));
  };

  // ── Loading Skeleton ────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div
        className="shared-chat-page"
        style={{
          height: "100vh",
          height: "100dvh",
          width: "100%",
          overflowY: "auto",
          background: "#08080A",
          color: "#FFFFFF",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          fontFamily: "var(--font-inter, sans-serif)",
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            border: "2px solid rgba(255, 255, 255, 0.15)",
            borderTopColor: "#FFFFFF",
            animation: "spin 0.8s linear infinite",
            marginBottom: 18,
          }}
        />
        <div style={{ fontSize: 13.5, color: "rgba(255, 255, 255, 0.6)", fontWeight: 500 }}>
          Retrieving shared DocMind transcript...
        </div>
      </div>
    );
  }

  // ── Error / Revoked State ───────────────────────────────────────────────────
  if (error || !session) {
    return (
      <div
        className="shared-chat-page"
        style={{
          height: "100vh",
          height: "100dvh",
          width: "100%",
          overflowY: "auto",
          background: "#08080A",
          color: "#FFFFFF",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          fontFamily: "var(--font-inter, sans-serif)",
        }}
      >
        <div
          style={{
            maxWidth: 480,
            width: "100%",
            background: "#0F0F12",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            borderRadius: 16,
            padding: 32,
            textAlign: "center",
            boxShadow: "0 20px 50px rgba(0, 0, 0, 0.8)",
          }}
        >
          <div
            style={{
              width: 54,
              height: 54,
              borderRadius: "50%",
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.25)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 20px",
            }}
          >
            <Lock size={24} color="#EF4444" />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: "#FFFFFF" }}>
            Conversation Unavailable
          </h2>
          <p style={{ fontSize: 13, color: "rgba(255, 255, 255, 0.6)", lineHeight: 1.6, marginBottom: 24 }}>
            {error || "This conversation is no longer accessible or public sharing was revoked."}
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <Link
              href="/"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 20px",
                background: "#FFFFFF",
                color: "#000000",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                textDecoration: "none",
                transition: "opacity 0.15s",
              }}
            >
              <ArrowLeft size={14} />
              <span>Back to DocMind</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const formattedSharedAt = session.shared_at
    ? format(new Date(session.shared_at), "MMM d, yyyy • h:mm a")
    : "Recently";

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      className="shared-chat-page"
      style={{
        height: "100vh",
        height: "100dvh",
        width: "100%",
        overflowY: "auto",
        overflowX: "hidden",
        background: "#08080A",
        color: "#FFFFFF",
        fontFamily: "var(--font-inter, sans-serif)",
        display: "flex",
        flexDirection: "column",
        WebkitOverflowScrolling: "touch",
        overscrollBehaviorY: "contain",
        position: "relative",
      }}
    >
      {/* ── Top Navigation Bar ────────────────────────────────────────────── */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 40,
          background: "rgba(8, 8, 10, 0.88)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.09)",
          padding: "12px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexShrink: 0,
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.5)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <Link
            href="/"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              textDecoration: "none",
              color: "#FFFFFF",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: "#FFFFFF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Sparkles size={16} color="#000000" />
            </div>
            <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.02em" }}>
              DocMind AI
            </span>
          </Link>

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "3px 9px",
              background: "rgba(255, 255, 255, 0.06)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              borderRadius: 20,
              fontSize: 11,
              color: "rgba(255, 255, 255, 0.8)",
              fontWeight: 500,
              whiteSpace: "nowrap",
            }}
          >
            <Globe size={11} color="#38BDF8" />
            <span>Public Shared Transcript</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <motion.button
            onClick={handleCopyLink}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.95 }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 14px",
              background: "rgba(255, 255, 255, 0.08)",
              border: "1px solid rgba(255, 255, 255, 0.16)",
              borderRadius: 6,
              color: "#FFFFFF",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {copiedLink ? (
              <>
                <Check size={13} color="#22C55E" />
                <span style={{ color: "#22C55E" }}>Link Copied</span>
              </>
            ) : (
              <>
                <Copy size={13} />
                <span>Copy Link</span>
              </>
            )}
          </motion.button>

          <Link
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 14px",
              background: "#FFFFFF",
              color: "#000000",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 700,
              textDecoration: "none",
              boxShadow: "0 2px 10px rgba(255, 255, 255, 0.15)",
              whiteSpace: "nowrap",
            }}
          >
            <span>Start Your Own Chat</span>
            <ExternalLink size={12} />
          </Link>
        </div>
      </header>

      {/* ── Main Content Container ────────────────────────────────────────── */}
      <main
        style={{
          flex: 1,
          maxWidth: 900,
          width: "100%",
          margin: "0 auto",
          padding: "32px 20px 80px",
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        {/* ── Transcript Header Banner ────────────────────────────────────── */}
        <section
          style={{
            background: "#0D0D10",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            borderRadius: 14,
            padding: "24px 28px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            boxShadow: "0 8px 30px rgba(0, 0, 0, 0.6)",
          }}
        >
          <div>
            <h1
              style={{
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                margin: "0 0 8px 0",
                color: "#FFFFFF",
                wordBreak: "break-word",
              }}
            >
              {session.title || "Untitled Conversation"}
            </h1>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 14,
                fontSize: 12,
                color: "rgba(255, 255, 255, 0.5)",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <Clock size={12} />
                Shared: {formattedSharedAt}
              </span>
              <span>•</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <MessageSquare size={12} />
                {session.messages.length} {session.messages.length === 1 ? "message" : "messages"}
              </span>
              {session.documents && session.documents.length > 0 && (
                <>
                  <span>•</span>
                  <span>
                    {session.documents.length}{" "}
                    {session.documents.length === 1 ? "document referenced" : "documents referenced"}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Documents Referenced Chips */}
          {session.documents && session.documents.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "rgba(255, 255, 255, 0.4)",
                }}
              >
                Grounded on Documents
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {session.documents.map((doc) => (
                  <div
                    key={doc.id}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "5px 10px",
                      background: "rgba(255, 255, 255, 0.05)",
                      border: "1px solid rgba(255, 255, 255, 0.12)",
                      borderRadius: 6,
                      fontSize: 11.5,
                      color: "#E5E5E5",
                    }}
                  >
                    <FileText size={12} color="#94A3B8" />
                    <span style={{ fontWeight: 500 }}>{doc.filename}</span>
                    {doc.word_count ? (
                      <span style={{ fontSize: 10, color: "rgba(255, 255, 255, 0.4)" }}>
                        ({doc.word_count.toLocaleString()} words)
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Privacy Guarantee Pill */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              background: "rgba(34, 197, 94, 0.06)",
              border: "1px solid rgba(34, 197, 94, 0.2)",
              borderRadius: 8,
              fontSize: 11.5,
              color: "#86EFAC",
            }}
          >
            <ShieldCheck size={14} color="#22C55E" style={{ flexShrink: 0 }} />
            <span>
              <strong>Sanitized &amp; Verified:</strong> Private API keys, server directories, and user account
              data are stripped from this public view.
            </span>
          </div>
        </section>

        {/* ── Conversation Messages List ──────────────────────────────────── */}
        <section style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {session.messages.length === 0 ? (
            <div
              style={{
                padding: 40,
                textAlign: "center",
                color: "rgba(255, 255, 255, 0.4)",
                fontSize: 13,
                background: "#0D0D10",
                borderRadius: 12,
                border: "1px solid rgba(255, 255, 255, 0.06)",
              }}
            >
              No messages found in this shared conversation.
            </div>
          ) : (
            session.messages.map((msg, idx) => {
              const isUser = msg.role === "user";
              const timeStr = msg.created_at
                ? format(new Date(msg.created_at), "h:mm a")
                : "";
              const hasSources = !isUser && msg.sources && msg.sources.length > 0;
              const isSourcesExpanded = Boolean(expandedSources[msg.id]);
              const isCopied = copiedMsgId === msg.id;

              return (
                <div
                  key={msg.id || idx}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: isUser ? "flex-end" : "flex-start",
                    gap: 6,
                    width: "100%",
                  }}
                >
                  {/* Sender Header */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: isUser ? "flex-end" : "space-between",
                      width: isUser ? "auto" : "100%",
                      gap: 8,
                      fontSize: 11,
                      color: "rgba(255, 255, 255, 0.4)",
                      padding: "0 4px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 600, color: isUser ? "#E5E5E5" : "#FFFFFF" }}>
                        {isUser ? "User" : "DocMind AI"}
                      </span>
                      {timeStr && <span>{timeStr}</span>}
                    </div>

                    {/* 1-Click Copy Message Button */}
                    <button
                      type="button"
                      onClick={() => handleCopyMessage(msg.id || String(idx), msg.content)}
                      title="Copy message content"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        background: "transparent",
                        border: "none",
                        color: isCopied ? "#22C55E" : "rgba(255, 255, 255, 0.35)",
                        fontSize: 10.5,
                        cursor: "pointer",
                        padding: "2px 6px",
                        borderRadius: 4,
                        transition: "color 0.15s ease",
                      }}
                    >
                      {isCopied ? (
                        <>
                          <Check size={11} color="#22C55E" />
                          <span style={{ color: "#22C55E" }}>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy size={11} />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Bubble */}
                  <div
                    className="message-bubble"
                    style={{
                      maxWidth: "100%",
                      width: isUser ? "auto" : "100%",
                      background: isUser ? "#1E1E24" : "#101014",
                      border: isUser
                        ? "1px solid rgba(255, 255, 255, 0.16)"
                        : "1px solid rgba(255, 255, 255, 0.09)",
                      borderRadius: 12,
                      padding: isUser ? "12px 18px" : "18px 24px",
                      color: "#FFFFFF",
                      fontSize: 13.5,
                      lineHeight: 1.65,
                      boxShadow: "0 4px 20px rgba(0, 0, 0, 0.5)",
                      wordBreak: "break-word",
                      overflowWrap: "break-word",
                    }}
                  >
                    {isUser ? (
                      <span style={{ whiteSpace: "pre-wrap", color: "#F3F4F6" }}>
                        {msg.content}
                      </span>
                    ) : (
                      <div className="markdown-body" style={{ color: "#E5E5E5" }}>
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkMath]}
                          rehypePlugins={[
                            [
                              rehypeKatex,
                              { strict: false, throwOnError: false, errorColor: "inherit" },
                            ],
                          ]}
                          components={{
                            table({ children, ...props }) {
                              return (
                                <div
                                  style={{
                                    width: "100%",
                                    overflowX: "auto",
                                    margin: "12px 0",
                                  }}
                                >
                                  <table style={{ margin: 0 }} {...props}>
                                    {children}
                                  </table>
                                </div>
                              );
                            },
                            code({ className, children, ...props }) {
                              const isInline = !String(children).includes("\n") && !className;
                              return isInline ? (
                                <code className="inline-code" {...props}>
                                  {children}
                                </code>
                              ) : (
                                <CodeBlock className={className}>{children}</CodeBlock>
                              );
                            },
                            hr() {
                              return (
                                <hr
                                  style={{
                                    border: "none",
                                    borderTop: "1px solid rgba(255, 255, 255, 0.12)",
                                    margin: "18px 0",
                                  }}
                                />
                              );
                            },
                          }}
                        >
                          {preprocessMarkdown(msg.content)}
                        </ReactMarkdown>
                      </div>
                    )}

                    {/* Sources Toggle */}
                    {hasSources && (
                      <div
                        style={{
                          marginTop: 14,
                          paddingTop: 12,
                          borderTop: "1px solid rgba(255, 255, 255, 0.08)",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => toggleSourceExpansion(msg.id)}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "4px 10px",
                            background: "rgba(255, 255, 255, 0.05)",
                            border: "1px solid rgba(255, 255, 255, 0.12)",
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 600,
                            color: "#D4D4D4",
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                        >
                          <FileText size={11} color="#A3A3A3" />
                          <span>
                            {msg.sources!.length}{" "}
                            {msg.sources!.length === 1 ? "Source Reference" : "Source References"}
                          </span>
                          {isSourcesExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                        </button>

                        {isSourcesExpanded && (
                          <div
                            style={{
                              marginTop: 10,
                              display: "flex",
                              flexDirection: "column",
                              gap: 8,
                            }}
                          >
                            {msg.sources!.map((s, sIdx) => (
                              <SharedSourceCard key={s.doc_id ? `${s.doc_id}-${sIdx}` : sIdx} source={s} />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </section>

        {/* ── Footer Call to Action ────────────────────────────────────────── */}
        <section
          style={{
            marginTop: 24,
            padding: "28px 28px",
            background: "linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.01) 100%)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: 14,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: 14,
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: "#FFFFFF",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 4px 16px rgba(255, 255, 255, 0.2)",
            }}
          >
            <Sparkles size={22} color="#000000" />
          </div>
          <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: "#FFFFFF" }}>
            Experience Neural Document Intelligence with DocMind AI
          </h3>
          <p
            style={{
              fontSize: 13,
              color: "rgba(255, 255, 255, 0.6)",
              maxWidth: 540,
              margin: 0,
              lineHeight: 1.6,
            }}
          >
            Upload your own PDF, DOCX, CSV, or web pages and ask complex questions grounded with hybrid
            RAG, cross-encoder reranking, and cross-session memory.
          </p>
          <Link
            href="/"
            style={{
              marginTop: 6,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 22px",
              background: "#FFFFFF",
              color: "#000000",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
              textDecoration: "none",
              boxShadow: "0 4px 16px rgba(255, 255, 255, 0.2)",
              transition: "transform 0.15s ease",
            }}
          >
            <span>Get Started for Free</span>
            <ExternalLink size={13} />
          </Link>
        </section>
      </main>

      {/* ── Floating Quick Scroll Buttons ─────────────────────────────────── */}
      <div
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          zIndex: 50,
        }}
      >
        <AnimatePresence>
          {showScrollTop && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: 10 }}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.92 }}
              onClick={scrollToTop}
              title="Scroll to top of shared conversation"
              style={{
                width: 38,
                height: 38,
                borderRadius: "50%",
                background: "rgba(18, 18, 22, 0.92)",
                border: "1px solid rgba(255, 255, 255, 0.2)",
                color: "#FFFFFF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                boxShadow: "0 4px 20px rgba(0, 0, 0, 0.6)",
                backdropFilter: "blur(10px)",
              }}
            >
              <ArrowUp size={16} strokeWidth={2.5} />
            </motion.button>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showScrollBottom && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: -10 }}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.92 }}
              onClick={scrollToBottom}
              title="Scroll to latest chats at the bottom"
              style={{
                width: 38,
                height: 38,
                borderRadius: "50%",
                background: "rgba(18, 18, 22, 0.92)",
                border: "1px solid rgba(255, 255, 255, 0.2)",
                color: "#FFFFFF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                boxShadow: "0 4px 20px rgba(0, 0, 0, 0.6)",
                backdropFilter: "blur(10px)",
              }}
            >
              <ArrowDown size={16} strokeWidth={2.5} />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
