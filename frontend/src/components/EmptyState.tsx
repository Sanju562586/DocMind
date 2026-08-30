"use client";

import {
  Brain,
  Upload,
  Search,
  Layers,
  BarChart3,
  MessageSquare,
  Database,
  RefreshCw,
  Sparkles,
  Zap,
  ShieldCheck,
  Cpu,
  ArrowRight,
} from "lucide-react";
import { motion, Variants } from "framer-motion";
import TiltCard from "./TiltCard";

interface EmptyStateProps {
  onStartNewChat: () => void;
  onOpenSettings: () => void;
  onSelectPrompt?: (prompt: string) => void;
}

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.07,
      delayChildren: 0.04,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      type: "spring" as const,
      stiffness: 320,
      damping: 24,
    },
  },
};

export default function EmptyState({
  onStartNewChat,
  onOpenSettings,
  onSelectPrompt,
}: EmptyStateProps) {
  const quickSparks = [
    {
      title: "Executive Synthesis",
      prompt: "Provide an executive summary highlighting the top 5 core takeaways, strategic impacts, and key metrics from the context.",
      icon: <Sparkles size={14} color="#FFFFFF" />,
    },
    {
      title: "Risk & Compliance Audit",
      prompt: "Identify any risk factors, regulatory obligations, and compliance caveats mentioned in the documents.",
      icon: <ShieldCheck size={14} color="#FFFFFF" />,
    },
    {
      title: "Action Items & Deadlines",
      prompt: "Extract all actionable decisions, milestones, responsibilities, and timeline deadlines from the context.",
      icon: <Zap size={14} color="#FFFFFF" />,
    },
    {
      title: "Cross-Topic Q&A",
      prompt: "Compare and contrast the primary findings across different sections, incorporating past conversation insights.",
      icon: <Cpu size={14} color="#FFFFFF" />,
    },
  ];

  const features = [
    {
      icon: <Layers size={18} strokeWidth={2} color="#FFFFFF" />,
      title: "Session-Scoped Documents",
      desc: "Upload PDFs, DOCX, TXT, MD, CSV, or XLSX isolated specifically to this conversation.",
      tag: "Data Isolation",
    },
    {
      icon: <Database size={18} strokeWidth={2} color="#FFFFFF" />,
      title: "Global Cross-Session Memory",
      desc: "Recalls relevant conclusions, answers, and facts from previous chats automatically.",
      tag: "Continuous Learning",
    },
    {
      icon: <Search size={18} strokeWidth={2} color="#FFFFFF" />,
      title: "Hierarchical RAG Chunking",
      desc: "Parent-child semantic chunks (~512 & ~128 tokens) with contextual metadata headers.",
      tag: "Context Preservation",
    },
    {
      icon: <BarChart3 size={18} strokeWidth={2} color="#FFFFFF" />,
      title: "Hybrid BM25 + Dense RRF",
      desc: "Reciprocal Rank Fusion merges exact keyword matching with dense neural embeddings.",
      tag: "Dual Retrieval",
    },
    {
      icon: <Cpu size={18} strokeWidth={2} color="#FFFFFF" />,
      title: "Cross-Encoder Joint Reranker",
      desc: "High-precision cross-attention scoring on candidate pairs for optimal relevance.",
      tag: "Precision Scoring",
    },
    {
      icon: <RefreshCw size={18} strokeWidth={2} color="#FFFFFF" />,
      title: "Multi-LLM Auto Failover",
      desc: "Cascades seamlessly across Gemini → Groq → OpenRouter on rate limits or quotas.",
      tag: "Zero Downtime",
    },
  ];

  return (
    <motion.div
      className="empty-state"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* 3D Floating Hero Core */}
      <motion.div variants={itemVariants} className="hero-3d-wrapper">
        <div className="hero-3d-glow" />
        <motion.div
          className="hero-icon-3d"
          whileHover={{
            scale: 1.12,
            rotate: 8,
            boxShadow: "0 0 35px rgba(255, 255, 255, 0.4)",
          }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
          onClick={onStartNewChat}
        >
          <Brain size={36} strokeWidth={2.2} color="#FFFFFF" />
        </motion.div>
      </motion.div>

      <motion.div
        variants={itemVariants}
        className="empty-state-badge"
        whileHover={{ scale: 1.05, y: -1 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
      >
        <Sparkles size={12} color="#FFFFFF" />
        <span>Next-Gen Neural Document Intelligence</span>
      </motion.div>

      <motion.h1 variants={itemVariants} className="empty-state-title">
        High-Precision Document Intelligence <br />
        <span className="empty-state-title-highlight">&amp; Global Cross-Chat Memory</span>
      </motion.h1>

      <motion.p variants={itemVariants} className="empty-state-description">
        Upload contracts, research papers, or spreadsheets for instant semantic Q&amp;A. DocMind seamlessly synthesizes document context while retaining memory across all your conversations.
      </motion.p>

      {/* Main Action Buttons */}
      <motion.div variants={itemVariants} className="empty-state-actions">
        <motion.button
          className="btn btn-primary hero-cta-btn"
          onClick={onStartNewChat}
          whileHover={{ scale: 1.04, y: -2 }}
          whileTap={{ scale: 0.95 }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
        >
          <MessageSquare size={15} color="#000000" />
          <span>Start New Conversation</span>
          <ArrowRight size={14} color="#000000" style={{ marginLeft: 2 }} />
        </motion.button>

        <motion.button
          className="btn btn-outline"
          onClick={onOpenSettings}
          whileHover={{ scale: 1.04, y: -2 }}
          whileTap={{ scale: 0.95 }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
        >
          <Cpu size={14} color="#FFFFFF" />
          <span>Configure Multi-LLM Keys</span>
        </motion.button>
      </motion.div>

      {/* Quick Prompt Sparks */}
      <motion.div variants={itemVariants} className="prompt-sparks-section">
        <div className="prompt-sparks-header">
          <Sparkles size={12} color="#FFFFFF" />
          <span>Quick Prompt Sparks</span>
        </div>
        <div className="prompt-sparks-grid">
          {quickSparks.map((spark, idx) => (
            <motion.button
              key={idx}
              className="prompt-spark-card"
              onClick={() => onSelectPrompt?.(spark.prompt)}
              whileHover={{
                scale: 1.025,
                y: -2,
                borderColor: "rgba(255, 255, 255, 0.45)",
                boxShadow: "0 10px 25px rgba(0, 0, 0, 0.8)",
              }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              title="Click to insert prompt into chat"
            >
              <motion.div
                className="prompt-spark-icon"
                whileHover={{ rotate: 12, scale: 1.15 }}
                transition={{ type: "spring", stiffness: 400, damping: 20 }}
              >
                {spark.icon}
              </motion.div>
              <div className="prompt-spark-content">
                <div className="prompt-spark-title">{spark.title}</div>
                <div className="prompt-spark-desc">{spark.prompt}</div>
              </div>
            </motion.button>
          ))}
        </div>
      </motion.div>

      {/* Feature Grid */}
      <motion.div variants={itemVariants} className="feature-grid-header">
        <span>Architectural Capabilities</span>
      </motion.div>
      <motion.div variants={itemVariants} className="feature-grid">
        {features.map((f, i) => (
          <TiltCard key={i} className="feature-tilt-card" maxTilt={10} scale={1.03}>
            <div className="feature-card-inner">
              <div className="feature-card-top">
                <motion.div
                  className="feature-icon-wrapper"
                  whileHover={{ scale: 1.15, rotate: 6 }}
                  transition={{ type: "spring", stiffness: 400, damping: 20 }}
                >
                  {f.icon}
                </motion.div>
                <span className="feature-card-tag">{f.tag}</span>
              </div>
              <div className="feature-card-title">{f.title}</div>
              <div className="feature-card-desc">{f.desc}</div>
            </div>
          </TiltCard>
        ))}
      </motion.div>
    </motion.div>
  );
}
