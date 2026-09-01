"use client";

import { useState, useEffect } from "react";
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

// ── LaTeX & Math Preprocessor ─────────────────────────────────────────────────

/**
 * Preprocesses markdown text to ensure LaTeX math syntax is parsed reliably by remark-math & KaTeX:
 * 1. Converts \[ ... \] into $$ ... $$ (display equations)
 * 2. Converts \( ... \) into $ ... $ (inline math)
 * 3. Normalizes mismatched single-line delimiters like `$ ... $$` or `$$ ... $`
 * 4. Fixes whitespace around inline dollar signs: `$ formula $` -> `$formula$`
 * 5. Formats single-line `$$...$$` blocks cleanly without ever spanning across lines or markdown headings
 */
function preprocessLaTeX(content: string): string {
  if (!content) return "";

  let processed = content
    // 1. Convert \[ ... \] display math to $$ ... $$
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => `\n\n$$\n${math.trim()}\n$$\n\n`)
    // 2. Convert \( ... \) inline math to $ ... $
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => `$${math.trim()}$`);

  // 3. Fix single-line mismatched $ ... $$ or $$ ... $ (e.g. $ w_{t+1} = w_t - v_{t+1} $$)
  processed = processed.replace(/(?<=^|[\s(])\$(?!\$)([^$\n]+?)\$\$(?=[\s.,!?;:)\]]|$)/gm, "$$$1$$");
  processed = processed.replace(/(?<=^|[\s(])\$\$(?!\$)([^$\n]+?)\$(?=[\s.,!?;:)\]]|$)/gm, "$$$1$$");

  // 4. Normalize single-line display equations: `$$ formula $$` -> `\n$$\nformula\n$$\n`
  // IMPORTANT: Match strictly within a single line ([^\n$]+?) so it NEVER spans across paragraphs or headings!
  processed = processed.replace(/^[ \t]*\$\$([^\n$]+?)\$\$[ \t]*$/gm, (_, math) => `\n$$\n${math.trim()}\n$$\n`);

  // 5. Fix spaces inside inline math delimiters: `$ formula $` -> `$formula$`
  processed = processed.replace(/(?<=^|[\s(])\$ +([^$\n]+?) +\$(?=[\s.,!?;:)\]]|$)/gm, "$$$1$$");
  processed = processed.replace(/(?<=^|[\s(])\$ +([^$\n]+?)\$(?=[\s.,!?;:)\]]|$)/gm, "$$$1$$");
  processed = processed.replace(/(?<=^|[\s(])\$([^$\n]+?) +\$(?=[\s.,!?;:)\]]|$)/gm, "$$$1$$");

  return processed;
}

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
  return (
    <TiltCard maxTilt={6} scale={1.015} className="source-tilt-wrapper">
      <div className="source-card">
        <div className="source-card-header">
          <div className="source-section-badge">
            <BookOpen size={12} color="#FFFFFF" />
            <span>Chunk {index + 1}: {source.section || "Document Context"}</span>
          </div>
          <div className="source-scores-group">
            <span
              className="source-score-badge"
              title={`Cross-Encoder Joint Reranker score: ${source.rerank_score.toFixed(3)}`}
            >
              <Cpu size={10} color="#FFFFFF" />
              Rerank: {source.rerank_score.toFixed(3)}
            </span>
            <span
              className="source-score-badge"
              title={`Dense Vector Semantic Similarity: ${source.dense_score.toFixed(3)}`}
            >
              <Search size={10} color="#FFFFFF" />
              Dense: {source.dense_score.toFixed(3)}
            </span>
          </div>
        </div>
        <div className="source-text">{source.child_text}</div>
      </div>
    </TiltCard>
  );
}

// ── Recalled Cross-Session Memory Card Component ──────────────────────────────

function MemoryCard({ memory }: { memory: MemoryItem }) {
  return (
    <TiltCard maxTilt={5} scale={1.015} className="memory-tilt-wrapper">
      <div className="memory-card">
        <div className="memory-card-header">
          <Database size={12} color="#FFFFFF" />
          <span>Cross-Session Insight &bull; &ldquo;{memory.session_title}&rdquo;</span>
        </div>
        <div className="memory-card-text">{memory.content}</div>
      </div>
    </TiltCard>
  );
}

// ── Message Bubble Component ──────────────────────────────────────────────────

import { Volume2, VolumeX } from "lucide-react";

interface MessageBubbleProps {
  message: Message;
  onOpenCitation?: (docId?: string, pageNumber?: number) => void;
}

export function MessageBubble({ message, onOpenCitation }: MessageBubbleProps) {
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [memoryExpanded, setMemoryExpanded] = useState(false);
  const [copiedBubble, setCopiedBubble] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const isUser = message.role === "user";

  const handleTTS = () => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    } else {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(message.content);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      setIsSpeaking(true);
      window.speechSynthesis.speak(utterance);
    }
  };

  const timestamp = (() => {
    try {
      return format(parseISO(message.created_at), "h:mm a");
    } catch {
      return "";
    }
  })();

  const hasSources = !isUser && message.sources && message.sources.length > 0;
  const hasMemory = !isUser && message.memory_recalled && message.memory_recalled.length > 0;

  const handleCopyMessage = () => {
    navigator.clipboard.writeText(message.content);
    setCopiedBubble(true);
    setTimeout(() => setCopiedBubble(false), 2000);
  };

  return (
    <motion.div
      className={`message ${isUser ? "user" : "assistant"}`}
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 350, damping: 26 }}
    >
      <div className="message-avatar-container">
        <motion.div
          className="message-avatar"
          whileHover={{ scale: 1.12, rotate: isUser ? -8 : 8 }}
          whileTap={{ scale: 0.92 }}
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
              }}
            >
              {preprocessLaTeX(message.content)}
            </ReactMarkdown>
          )}
        </motion.div>

        {/* Global Cross-Session Memory Recalled Accordion */}
        {hasMemory && (
          <div className="memory-recalled-container">
            <motion.button
              className={`memory-recalled-toggle ${memoryExpanded ? "active" : ""}`}
              onClick={() => setMemoryExpanded(!memoryExpanded)}
              whileHover={{ scale: 1.02, x: 2 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
            >
              <Database size={12} color="#FFFFFF" />
              <span>Cross-Session Memory Recalled ({message.memory_recalled!.length})</span>
              {memoryExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </motion.button>

            <AnimatePresence>
              {memoryExpanded && (
                <motion.div
                  className="memory-list"
                  initial={{ opacity: 0, height: 0, scale: 0.98 }}
                  animate={{ opacity: 1, height: "auto", scale: 1 }}
                  exit={{ opacity: 0, height: 0, scale: 0.98 }}
                  transition={{ type: "spring", stiffness: 350, damping: 28 }}
                >
                  {message.memory_recalled!.map((mem, i) => (
                    <MemoryCard key={i} memory={mem} />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Source Citations Accordion */}
        {hasSources && (
          <div className="sources-container">
            <motion.button
              className={`sources-toggle ${sourcesExpanded ? "active" : ""}`}
              onClick={() => setSourcesExpanded(!sourcesExpanded)}
              whileHover={{ scale: 1.02, x: 2 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
            >
              <BookOpen size={12} color="#FFFFFF" />
              <span>{message.sources!.length} document chunk{message.sources!.length !== 1 ? "s" : ""} cited</span>
              {sourcesExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </motion.button>

            <AnimatePresence>
              {sourcesExpanded && (
                <motion.div
                  className="sources-list"
                  initial={{ opacity: 0, height: 0, scale: 0.98 }}
                  animate={{ opacity: 1, height: "auto", scale: 1 }}
                  exit={{ opacity: 0, height: 0, scale: 0.98 }}
                  transition={{ type: "spring", stiffness: 350, damping: 28 }}
                >
                  {message.sources!.map((src, i) => (
                    <SourceCard key={i} source={src} index={i} />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", marginTop: 4, padding: "0 4px" }}>
          <div className="message-timestamp">{timestamp}</div>
          {!isUser && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <motion.button
                onClick={handleTTS}
                className="icon-btn"
                style={{ width: 22, height: 22, opacity: 0.7 }}
                whileHover={{ opacity: 1, scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                title={isSpeaking ? "Stop audio reading" : "Read message aloud (Text-to-Speech)"}
              >
                {isSpeaking ? <VolumeX size={11} color="#EF4444" /> : <Volume2 size={11} color="#FFFFFF" />}
              </motion.button>

              <motion.button
                onClick={handleCopyMessage}
                className="icon-btn"
                style={{ width: 22, height: 22, opacity: 0.7 }}
                whileHover={{ opacity: 1, scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                title="Copy message text"
              >
                {copiedBubble ? <Check size={11} color="#FFFFFF" /> : <Copy size={11} color="#FFFFFF" />}
              </motion.button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ── Monochromatic AI Thinking State ──────────────────────────────────────────

export function TypingIndicator() {
  const [statusIndex, setStatusIndex] = useState(0);
  const statusMessages = [
    "Synthesizing hierarchical semantic vectors…",
    "Searching dense embeddings & BM25 index…",
    "Evaluating Cross-Encoder relevance scores…",
    "Generating multi-LLM response…",
  ];

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

// ── Monochromatic Streaming Message Component ────────────────────────────────

interface StreamingMessageProps {
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
            }}
          >
            {preprocessLaTeX(content)}
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
