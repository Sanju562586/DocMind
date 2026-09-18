"use client";

import {
  Brain,
  Upload,
  Search,
  Layers,
  MessageSquare,
  Sparkles,
  Zap,
  ShieldCheck,
  FileText,
  CheckCircle2,
  Sliders,
  ArrowRight,
} from "lucide-react";
import { motion, Variants } from "framer-motion";
import TiltCard from "./TiltCard";

interface EmptyStateProps {
  onStartNewChat: () => void;
  onOpenSettings: () => void;
  onSelectPrompt?: (prompt: string) => void;
  onUploadDocument?: () => void;
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
  onUploadDocument,
}: EmptyStateProps) {
  const howItWorks = [
    {
      step: "01",
      title: "Upload Any File",
      desc: "Drag and drop your PDF, Word document, spreadsheet, or report.",
      icon: <Upload size={18} strokeWidth={2.2} color="#FFFFFF" />,
    },
    {
      step: "02",
      title: "Ask in Plain English",
      desc: "Ask any question, request a summary, or pick a starter prompt below.",
      icon: <MessageSquare size={18} strokeWidth={2.2} color="#FFFFFF" />,
    },
    {
      step: "03",
      title: "Get Instant Answers",
      desc: "Receive clear explanations with direct page references so you can verify facts.",
      icon: <CheckCircle2 size={18} strokeWidth={2.2} color="#FFFFFF" />,
    },
  ];

  const quickSparks = [
    {
      title: "Quick 5-Point Summary",
      prompt: "Provide a quick 5-bullet summary highlighting the main takeaways and essential findings.",
      icon: <FileText size={14} color="#FFFFFF" />,
    },
    {
      title: "Explain in Simple Terms",
      prompt: "Explain the main ideas and conclusions in clear, simple language that anyone can easily understand.",
      icon: <Sparkles size={14} color="#FFFFFF" />,
    },
    {
      title: "Action Items & Deadlines",
      prompt: "Extract all key decisions, action items, assigned owners, and upcoming deadlines.",
      icon: <CheckCircle2 size={14} color="#FFFFFF" />,
    },
    {
      title: "Key Facts & Numbers",
      prompt: "Find and list the most important facts, numbers, dates, and statistics mentioned.",
      icon: <Search size={14} color="#FFFFFF" />,
    },
  ];

  const features = [
    {
      icon: <Layers size={18} strokeWidth={2} color="#FFFFFF" />,
      title: "Works with Any Document",
      desc: "Supports PDFs, Word docs, Excel spreadsheets, and text notes with one click.",
      tag: "All Formats",
    },
    {
      icon: <CheckCircle2 size={18} strokeWidth={2} color="#FFFFFF" />,
      title: "Verified Page Citations",
      desc: "Every answer links directly to the exact page and paragraph so you can verify facts.",
      tag: "100% Sourced",
    },
    {
      icon: <FileText size={18} strokeWidth={2} color="#FFFFFF" />,
      title: "Effortless Summaries",
      desc: "Turn 50-page reports and complex contracts into clear, structured takeaways in seconds.",
      tag: "Time-Saving",
    },
    {
      icon: <Brain size={18} strokeWidth={2} color="#FFFFFF" />,
      title: "Connected Conversation",
      desc: "DocMind remembers past discussions in your workspace so you never have to repeat context.",
      tag: "Smart Memory",
    },
    {
      icon: <Zap size={18} strokeWidth={2} color="#FFFFFF" />,
      title: "Fast & Responsive",
      desc: "Get smooth real-time streaming answers and quick insights without delays.",
      tag: "Instant",
    },
    {
      icon: <ShieldCheck size={18} strokeWidth={2} color="#FFFFFF" />,
      title: "Private & Secure",
      desc: "Your files remain strictly private to your session and are never shared publicly.",
      tag: "Protected",
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
          title="Start a new conversation"
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
        <span>AI Reading &amp; Document Assistant</span>
      </motion.div>

      <motion.h1 variants={itemVariants} className="empty-state-title">
        Chat with your documents. <br />
        <span className="empty-state-title-highlight">Get instant answers in seconds.</span>
      </motion.h1>

      <motion.p variants={itemVariants} className="empty-state-description">
        Upload any PDF, Word file, or spreadsheet to ask questions, get quick summaries, and extract key facts. DocMind makes complex reading fast and easy for everyone.
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
          <span>Start a Conversation</span>
          <ArrowRight size={14} color="#000000" style={{ marginLeft: 2 }} />
        </motion.button>

        {onUploadDocument && (
          <motion.button
            className="btn btn-outline"
            onClick={onUploadDocument}
            whileHover={{ scale: 1.04, y: -2 }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
          >
            <Upload size={14} color="#FFFFFF" />
            <span>Upload Document</span>
          </motion.button>
        )}

        <motion.button
          className="btn btn-outline"
          onClick={onOpenSettings}
          whileHover={{ scale: 1.04, y: -2 }}
          whileTap={{ scale: 0.95 }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
          style={{
            border: "1px solid rgba(255, 255, 255, 0.15)",
            color: "var(--text-secondary)",
          }}
          title="Settings and preferences"
        >
          <Sliders size={13} color="var(--text-secondary)" />
          <span>Settings</span>
        </motion.button>
      </motion.div>

      {/* Quick Upload Drop Card */}
      {onUploadDocument && (
        <motion.div
          variants={itemVariants}
          className="landing-dropzone"
          onClick={onUploadDocument}
          whileHover={{
            scale: 1.01,
            borderColor: "rgba(255, 255, 255, 0.4)",
            boxShadow: "0 10px 30px rgba(0, 0, 0, 0.6)",
          }}
          whileTap={{ scale: 0.99 }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onUploadDocument();
            }
          }}
          title="Click to select a document to upload"
        >
          <div className="landing-dropzone-icon">
            <Upload size={20} color="#FFFFFF" />
          </div>
          <div className="landing-dropzone-text">
            <div className="landing-dropzone-title">Drop a file here to get started, or browse</div>
            <div className="landing-dropzone-subtitle">Supports PDF, Word, Excel, and text files</div>
          </div>
        </motion.div>
      )}

      {/* How It Works Section */}
      <motion.div variants={itemVariants} className="how-it-works-section">
        <div className="how-it-works-header">
          <span>How It Works</span>
        </div>
        <div className="how-it-works-grid">
          {howItWorks.map((item, idx) => (
            <motion.div
              key={idx}
              className="how-it-works-card"
              whileHover={{ y: -3, borderColor: "rgba(255, 255, 255, 0.3)" }}
              transition={{ type: "spring", stiffness: 350, damping: 25 }}
            >
              <div className="how-it-works-card-top">
                <span className="how-it-works-step-badge">{item.step}</span>
                <div className="how-it-works-icon-wrapper">{item.icon}</div>
              </div>
              <div className="how-it-works-title">{item.title}</div>
              <div className="how-it-works-desc">{item.desc}</div>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Quick Prompt Sparks */}
      <motion.div variants={itemVariants} className="prompt-sparks-section">
        <div className="prompt-sparks-header">
          <Sparkles size={12} color="#FFFFFF" />
          <span>Starter Questions to Try</span>
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
        <span>Why You&apos;ll Love DocMind</span>
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
