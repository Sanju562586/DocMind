"use client";

import { useState, useEffect, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  ChevronUp,
  BookOpen,
  Cpu,
  Search,
  Database,
  Sparkles,
  Copy,
  Check,
  Zap,
  Layers,
  FileText,
} from "lucide-react";
import { Message, Source, MemoryItem } from "@/lib/types";
import { format, parseISO } from "date-fns";
import TiltCard from "./TiltCard";
import NeuralWaveform from "./NeuralWaveform";

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
        <span className="code-block-lang">{language || "text"}</span>
        <motion.button
          className="code-copy-btn"
          onClick={handleCopy}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          title="Copy code to clipboard"
        >
          <AnimatePresence mode="wait" initial={false}>
            {copied ? (
              <motion.span
                key="copied"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#FFFFFF" }}
              >
                <Check size={12} color="#FFFFFF" />
                <span>Copied</span>
              </motion.span>
            ) : (
              <motion.span
                key="copy"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                <Copy size={12} color="#FFFFFF" />
                <span>Copy</span>
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>
      </div>
      <pre className="code-block-pre">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

// ── Interactive Source Card Component with Monochromatic Depth ────────────────

function SourceCard({ source, index }: { source: Source; index: number }) {
  const matchScore = source.score !== undefined ? source.score : source.rerank_score;
  const textSnippet = source.snippet || source.child_text || "";

  return (
    <TiltCard maxTilt={6} scale={1.015} className="source-tilt-wrapper">
      <div className="source-card">
        <div className="source-card-header">
          <div className="source-section-badge">
            <FileText size={11} color="#FFFFFF" />
            <span>{source.title || "Document"}</span>
            {source.section && <span style={{ opacity: 0.6 }}>• {source.section}</span>}
          </div>
          {matchScore !== undefined && matchScore > 0 && (
            <span className="source-score-badge">
              {(matchScore * (matchScore <= 1 ? 100 : 1)).toFixed(0)}% Match
            </span>
          )}
        </div>
        {textSnippet && <p className="source-snippet">"{textSnippet}"</p>}
      </div>
    </TiltCard>
  );
}

// ── Inline Citation Chip Component ──────────────────────────────────────────

function InlineCitationChip({ source, index }: { source: Source; index: number }) {
  const [isOpen, setIsOpen] = useState(false);
  const textSnippet = source.snippet || source.child_text || "";

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "2px 8px",
          background: "rgba(255, 255, 255, 0.07)",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          borderRadius: 4,
          fontSize: 10,
          color: "#D4D4D4",
          cursor: "pointer",
          transition: "all 0.15s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.4)";
          e.currentTarget.style.color = "#FFFFFF";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.15)";
          e.currentTarget.style.color = "#D4D4D4";
        }}
      >
        <BookOpen size={10} color="#FFFFFF" />
        <span style={{ fontWeight: 600 }}>{source.title || `Source ${index + 1}`}</span>
        {source.section && <span style={{ opacity: 0.6 }}>• {source.section}</span>}
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            bottom: "100%",
            left: 0,
            marginBottom: 6,
            width: 260,
            padding: 10,
            background: "#111111",
            border: "1px solid rgba(255, 255, 255, 0.25)",
            borderRadius: 8,
            boxShadow: "0 10px 30px rgba(0,0,0,0.8)",
            zIndex: 100,
            fontSize: 11,
            color: "#E5E5E5",
          }}
        >
          <div style={{ fontWeight: 700, color: "#FFFFFF", marginBottom: 4 }}>
            {source.title || "Extracted Source"}
          </div>
          {textSnippet && (
            <div style={{ fontSize: 10.5, color: "#AAAAAA", lineHeight: 1.45 }}>
              "{textSnippet}"
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── MessageBubble Main Component ─────────────────────────────────────────────

export interface MessageBubbleProps {
  message: Message;
  isLatest?: boolean;
  onOpenCitation?: (docId?: string, pageNum?: number) => void;
  onSelectFollowUp?: (q: string) => void;
}

export function MessageBubble({ message, isLatest, onOpenCitation, onSelectFollowUp }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const timeStr = useMemo(() => {
    try {
      return format(new Date(message.created_at), "h:mm a");
    } catch {
      return "";
    }
  }, [message.created_at]);

  const hasSources = !isUser && message.sources && message.sources.length > 0;

  return (
    <motion.div
      className={`message ${isUser ? "user" : "assistant"}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 28 }}
    >
      <div className="message-avatar-container">
        <motion.div
          className="message-avatar"
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.94 }}
          transition={{ type: "spring", stiffness: 450, damping: 20 }}
        >
          {isUser ? "U" : <Sparkles size={15} strokeWidth={2.2} color="#FFFFFF" />}
        </motion.div>
      </div>

      <div className="message-body">
        <motion.div
          className="message-bubble"
          whileHover={{ boxShadow: "0 10px 35px rgba(0, 0, 0, 0.9)" }}
          transition={{ duration: 0.2 }}
        >
          {isUser ? (
            <span style={{ whiteSpace: "pre-wrap" }}>{message.content}</span>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false, errorColor: "inherit" }]]}
              components={{
                table({ children, ...props }) {
                  return (
                    <div style={{ width: "100%", overflowX: "auto", margin: "10px 0", WebkitOverflowScrolling: "touch" }}>
                      <table style={{ margin: 0 }} {...props}>{children}</table>
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
                  return <hr style={{ border: "none", borderTop: "1px solid rgba(255, 255, 255, 0.16)", margin: "16px 0" }} />;
                },
              }}
            >
              {preprocessMarkdown(message.content)}
            </ReactMarkdown>
          )}
        </motion.div>

        {/* Inline Citation Pills with Peek Popovers */}
        {hasSources && (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 8, padding: "0 2px" }}>
            <span style={{ fontSize: 10, color: "rgba(255, 255, 255, 0.4)", display: "flex", alignItems: "center", gap: 3 }}>
              <BookOpen size={10} /> Sources:
            </span>
            {message.sources!.slice(0, 4).map((src, i) => (
              <InlineCitationChip key={i} source={src} index={i} />
            ))}
          </div>
        )}

        <div className="message-timestamp">
          {isUser ? "You" : "DocMind AI"} {timeStr && `• ${timeStr}`}
        </div>
      </div>
    </motion.div>
  );
}

// ── Streaming Message Component ──────────────────────────────────────────────

export interface StreamingMessageProps {
  content: string;
  sources?: Source[];
  memories?: MemoryItem[];
}

export function StreamingMessage({ content, sources, memories }: StreamingMessageProps) {
  return (
    <motion.div
      className="message assistant streaming-active"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 350, damping: 26 }}
    >
      <div className="message-avatar-container">
        <div className="message-avatar pulse-glow">
          <Sparkles size={15} color="#FFFFFF" />
        </div>
      </div>
      <div className="message-body">
        <div className="message-bubble">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false, errorColor: "inherit" }]]}
            components={{
              table({ children, ...props }) {
                return (
                  <div style={{ width: "100%", overflowX: "auto", margin: "10px 0", WebkitOverflowScrolling: "touch" }}>
                    <table style={{ margin: 0 }} {...props}>{children}</table>
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
                return <hr style={{ border: "none", borderTop: "1px solid rgba(255, 255, 255, 0.16)", margin: "16px 0" }} />;
              },
            }}
          >
            {preprocessMarkdown(content)}
          </ReactMarkdown>
          <span className="streaming-cursor" />
        </div>

        {memories && memories.length > 0 && (
          <motion.div
            className="streaming-memory-pill"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
          >
            <Database size={11} color="#FFFFFF" />
            <span>Cross-session memory connected ({memories.length} item{memories.length !== 1 ? "s" : ""})</span>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

// ── Monochromatic AI Thinking State ──────────────────────────────────────────

export function TypingIndicator() {
  const [statusIndex, setStatusIndex] = useState(0);
  const statusMessages = useMemo(
    () => [
      "Synthesizing hierarchical semantic vectors…",
      "Searching dense embeddings & BM25 index…",
      "Evaluating Cross-Encoder relevance scores…",
      "Generating multi-LLM response…",
    ],
    []
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setStatusIndex((prev) => (prev + 1) % statusMessages.length);
    }, 1800);
    return () => clearInterval(interval);
  }, [statusMessages.length]);

  return (
    <motion.div
      className="message assistant"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ type: "spring", stiffness: 350, damping: 26 }}
    >
      <div className="message-avatar-container">
        <div className="message-avatar pulse-glow">
          <Sparkles size={15} color="#FFFFFF" />
        </div>
      </div>
      <div className="message-body">
        <div
          className="message-bubble"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 18px",
            background: "#080808",
            borderColor: "rgba(255, 255, 255, 0.25)",
            boxShadow: "0 0 16px rgba(0, 0, 0, 0.9)",
          }}
        >
          <NeuralWaveform
            label={statusMessages[statusIndex]}
            barCount={14}
            active={true}
          />
        </div>
      </div>
    </motion.div>
  );
}

