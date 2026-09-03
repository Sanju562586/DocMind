"use client";

import { useState, useEffect } from "react";
import {
  Lightbulb,
  X,
  Check,
  HelpCircle,
  Sparkles,
  RefreshCw,
  Upload,
  FileText,
  Layers,
  RotateCw,
  ChevronLeft,
  ChevronRight,
  ThumbsUp,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { QuizQuestion } from "@/lib/api";
import { Session } from "@/lib/types";

interface QuizModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeSession: Session | null;
  sessions: Session[];
  onSelectSession: (s: Session) => void;
  onOpenUpload: () => void;
  onGenerateQuiz: (sessionId: string, numQuestions: number) => Promise<void>;
  questions: QuizQuestion[];
  isLoading: boolean;
}

export function QuizModal({
  isOpen,
  onClose,
  activeSession,
  sessions,
  onSelectSession,
  onOpenUpload,
  onGenerateQuiz,
  questions,
  isLoading,
}: QuizModalProps) {
  const [studyMode, setStudyMode] = useState<"quiz" | "flashcards">("quiz");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOptions, setSelectedOptions] = useState<Record<number, number>>({});
  const [showExplanation, setShowExplanation] = useState<Record<number, boolean>>({});
  const [isFlipped, setIsFlipped] = useState(false);
  const [cardRatings, setCardRatings] = useState<Record<number, "easy" | "good" | "hard">>({});
  const [numQuestions, setNumQuestions] = useState(5);

  if (!isOpen) return null;

  const currentDocs = activeSession?.documents || [];
  const currentQ = questions[currentIndex];
  const total = questions.length;

  // Spacebar and Arrow Key controls for Flashcards mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (studyMode !== "flashcards" || total === 0) return;

      if (e.code === "Space") {
        e.preventDefault();
        setIsFlipped((prev) => !prev);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (currentIndex < total - 1) {
          setCurrentIndex((p) => p + 1);
          setIsFlipped(false);
        }
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (currentIndex > 0) {
          setCurrentIndex((p) => p - 1);
          setIsFlipped(false);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [studyMode, currentIndex, total]);

  const handleSelect = (qIdx: number, optIdx: number) => {
    if (selectedOptions[qIdx] !== undefined) return;
    setSelectedOptions((prev) => ({ ...prev, [qIdx]: optIdx }));
    setShowExplanation((prev) => ({ ...prev, [qIdx]: true }));
  };

  const score = Object.entries(selectedOptions).reduce((acc, [qIdxStr, optIdx]) => {
    const qIdx = parseInt(qIdxStr, 10);
    return questions[qIdx]?.correct_index === optIdx ? acc + 1 : acc;
  }, 0);

  const handleRegenerate = () => {
    if (!activeSession) return;
    setSelectedOptions({});
    setShowExplanation({});
    setCurrentIndex(0);
    setIsFlipped(false);
    onGenerateQuiz(activeSession.id, numQuestions);
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
        style={{ maxWidth: 680, maxHeight: "90vh", display: "flex", flexDirection: "column" }}
      >
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <motion.div
              className="modal-icon-badge"
              whileHover={{ rotate: 15, scale: 1.1 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
            >
              {studyMode === "quiz" ? <Lightbulb size={16} /> : <Layers size={16} />}
            </motion.div>
            <div>
              <span className="modal-title">Study &amp; Knowledge Assessment</span>
              <div className="modal-subtitle">AI-Grounded Exam Revision Studio</div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* Mode Switcher */}
            <div
              style={{
                display: "inline-flex",
                background: "rgba(255, 255, 255, 0.06)",
                padding: "3px",
                borderRadius: 8,
                border: "1px solid rgba(255, 255, 255, 0.1)",
              }}
            >
              <button
                type="button"
                onClick={() => setStudyMode("quiz")}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: "none",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  background: studyMode === "quiz" ? "#FFFFFF" : "transparent",
                  color: studyMode === "quiz" ? "#000000" : "#A1A1AA",
                  transition: "all 0.15s ease",
                }}
              >
                💡 Quiz (MCQ)
              </button>
              <button
                type="button"
                onClick={() => {
                  setStudyMode("flashcards");
                  setIsFlipped(false);
                }}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: "none",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  background: studyMode === "flashcards" ? "#FFFFFF" : "transparent",
                  color: studyMode === "flashcards" ? "#000000" : "#A1A1AA",
                  transition: "all 0.15s ease",
                }}
              >
                🃏 3D Flashcards
              </button>
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
        </div>

        {/* Body */}
        <div style={{ overflowY: "auto", padding: "16px 0", flex: 1 }}>
          {currentDocs.length === 0 ? (
            <div style={{ textAlign: "center", padding: "30px 20px" }}>
              <FileText size={32} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
              <h4 style={{ fontSize: 14, color: "#FFFFFF", marginBottom: 6 }}>No Documents in Active Conversation</h4>
              <p style={{ fontSize: 12, color: "var(--text-muted-alt)", maxWidth: 380, margin: "0 auto 18px" }}>
                DocMind requires at least one uploaded document or web page to synthesize exam flashcards &amp; quizzes.
              </p>
              <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    onClose();
                    onOpenUpload();
                  }}
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <Upload size={13} />
                  <span>Attach Document</span>
                </button>
              </div>
            </div>
          ) : isLoading ? (
            <div style={{ textAlign: "center", padding: "40px 20px" }}>
              <div
                className="spin"
                style={{
                  width: 28,
                  height: 28,
                  border: "2.5px solid #FFFFFF",
                  borderTopColor: "transparent",
                  borderRadius: "50%",
                  margin: "0 auto 14px",
                }}
              />
              <div style={{ fontSize: 14, fontWeight: 600, color: "#FFFFFF", marginBottom: 4 }}>
                Synthesizing Exam Concepts &amp; Flashcards…
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted-alt)" }}>
                Extracting core definitions, principles, and high-yield facts
              </div>
            </div>
          ) : questions.length === 0 ? (
            <div style={{ textAlign: "center", padding: "30px 20px" }}>
              <Sparkles size={28} style={{ margin: "0 auto 10px", color: "#FFFFFF" }} />
              <h4 style={{ fontSize: 14, color: "#FFFFFF", marginBottom: 6 }}>Ready to Generate Study Material</h4>
              <p style={{ fontSize: 12, color: "var(--text-muted-alt)", marginBottom: 18 }}>
                Generate instant self-assessment quizzes and 3D flashcards grounded in {currentDocs.length} document{currentDocs.length !== 1 ? "s" : ""}.
              </p>
              <button
                className="btn btn-primary"
                onClick={handleRegenerate}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Sparkles size={13} />
                <span>Generate 5 Study Cards</span>
              </button>
            </div>
          ) : studyMode === "flashcards" ? (
            /* ── 3D FLIP FLASHCARD MODE ── */
            <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "center" }}>
              <div style={{ display: "flex", justifyContent: "space-between", width: "100%", fontSize: 12, color: "var(--text-muted-alt)" }}>
                <span>Card {currentIndex + 1} of {total}</span>
                <span>Press <strong>Space</strong> to flip &bull; <strong>← →</strong> to navigate</span>
              </div>

              {/* 3D Flip Card Container */}
              <div
                onClick={() => setIsFlipped(!isFlipped)}
                style={{
                  perspective: "1000px",
                  width: "100%",
                  minHeight: 260,
                  cursor: "pointer",
                }}
              >
                <motion.div
                  animate={{ rotateY: isFlipped ? 180 : 0 }}
                  transition={{ duration: 0.45, ease: "easeInOut" }}
                  style={{
                    position: "relative",
                    width: "100%",
                    minHeight: 260,
                    transformStyle: "preserve-3d",
                  }}
                >
                  {/* Front Face (Concept / Question) */}
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      backfaceVisibility: "hidden",
                      background: "#0c0c10",
                      border: "1px solid rgba(255, 255, 255, 0.16)",
                      borderRadius: 14,
                      padding: "24px 28px",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5)",
                    }}
                  >
                    <div>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "#60A5FA", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>
                        <Lightbulb size={12} />
                        <span>Question &bull; Core Concept</span>
                      </div>
                      <div style={{ fontSize: 16, fontWeight: 600, color: "#FFFFFF", lineHeight: 1.5 }}>
                        {currentQ.question}
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid rgba(255, 255, 255, 0.08)", paddingTop: 12 }}>
                      <span style={{ fontSize: 11, color: "rgba(255, 255, 255, 0.4)" }}>
                        Click card or press Space to reveal answer
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, color: "rgba(255, 255, 255, 0.6)", fontSize: 11 }}>
                        <RotateCw size={12} />
                        <span>Flip</span>
                      </div>
                    </div>
                  </div>

                  {/* Back Face (Answer & Explanation) */}
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      backfaceVisibility: "hidden",
                      transform: "rotateY(180deg)",
                      background: "#080c14",
                      border: "1px solid rgba(96, 165, 250, 0.3)",
                      borderRadius: 14,
                      padding: "24px 28px",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      boxShadow: "0 10px 30px rgba(0, 0, 0, 0.7)",
                    }}
                  >
                    <div>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "#4ADE80", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
                        <Check size={12} />
                        <span>Exam Answer</span>
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "#FFFFFF", marginBottom: 10 }}>
                        {currentQ.options[currentQ.correct_index]}
                      </div>
                      <div style={{ fontSize: 12, color: "#D1D5DB", lineHeight: 1.55 }}>
                        {currentQ.explanation}
                      </div>
                    </div>

                    {/* Self Rating Bar */}
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        borderTop: "1px solid rgba(255, 255, 255, 0.08)",
                        paddingTop: 10,
                      }}
                    >
                      <span style={{ fontSize: 11, color: "rgba(255, 255, 255, 0.45)" }}>
                        How well did you know this?
                      </span>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => setCardRatings((prev) => ({ ...prev, [currentIndex]: "hard" }))}
                          style={{
                            padding: "3px 8px",
                            borderRadius: 6,
                            fontSize: 10,
                            fontWeight: 600,
                            border: "none",
                            cursor: "pointer",
                            background: cardRatings[currentIndex] === "hard" ? "#EF4444" : "rgba(239, 68, 68, 0.15)",
                            color: cardRatings[currentIndex] === "hard" ? "#FFFFFF" : "#F87171",
                          }}
                        >
                          Hard
                        </button>
                        <button
                          type="button"
                          onClick={() => setCardRatings((prev) => ({ ...prev, [currentIndex]: "good" }))}
                          style={{
                            padding: "3px 8px",
                            borderRadius: 6,
                            fontSize: 10,
                            fontWeight: 600,
                            border: "none",
                            cursor: "pointer",
                            background: cardRatings[currentIndex] === "good" ? "#F59E0B" : "rgba(245, 158, 11, 0.15)",
                            color: cardRatings[currentIndex] === "good" ? "#FFFFFF" : "#FBBF24",
                          }}
                        >
                          Good
                        </button>
                        <button
                          type="button"
                          onClick={() => setCardRatings((prev) => ({ ...prev, [currentIndex]: "easy" }))}
                          style={{
                            padding: "3px 8px",
                            borderRadius: 6,
                            fontSize: 10,
                            fontWeight: 600,
                            border: "none",
                            cursor: "pointer",
                            background: cardRatings[currentIndex] === "easy" ? "#10B981" : "rgba(16, 185, 129, 0.15)",
                            color: cardRatings[currentIndex] === "easy" ? "#FFFFFF" : "#34D399",
                          }}
                        >
                          Easy
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              </div>

              {/* Flashcard Navigation Bar */}
              <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center", marginTop: 6 }}>
                <button
                  className="btn btn-outline"
                  onClick={() => {
                    setCurrentIndex((p) => Math.max(0, p - 1));
                    setIsFlipped(false);
                  }}
                  disabled={currentIndex === 0}
                  style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  <ChevronLeft size={13} />
                  <span>Previous</span>
                </button>

                <button
                  className="btn btn-outline"
                  onClick={() => setIsFlipped(!isFlipped)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  <RotateCw size={12} />
                  <span>{isFlipped ? "Show Question" : "Flip Answer"}</span>
                </button>

                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setCurrentIndex((p) => Math.min(total - 1, p + 1));
                    setIsFlipped(false);
                  }}
                  disabled={currentIndex === total - 1}
                  style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  <span>Next Card</span>
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          ) : (
            /* ── INTERACTIVE MCQ QUIZ MODE ── */
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Progress & Score */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "var(--text-muted-alt)" }}>
                <span>Question {currentIndex + 1} of {total}</span>
                <span style={{ color: "#FFFFFF", fontWeight: 700 }}>
                  Score: {score} / {Object.keys(selectedOptions).length}
                </span>
              </div>
              <div style={{ width: "100%", height: 3, background: "rgba(255,255,255,0.1)", borderRadius: 2, overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    background: "#FFFFFF",
                    width: `${((currentIndex + 1) / total) * 100}%`,
                    transition: "width 0.3s ease",
                  }}
                />
              </div>

              {/* Question Card */}
              <div
                style={{
                  background: "#080808",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  borderRadius: "var(--radius-md)",
                  padding: "16px 18px",
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, color: "#FFFFFF", marginBottom: 14, lineHeight: 1.5 }}>
                  {currentQ.question}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {currentQ.options.map((opt, optIdx) => {
                    const isSelected = selectedOptions[currentIndex] === optIdx;
                    const isCorrect = currentQ.correct_index === optIdx;
                    const hasAnswered = selectedOptions[currentIndex] !== undefined;

                    let bg = "#111114";
                    let border = "1px solid rgba(255, 255, 255, 0.12)";
                    let color = "#E0E0E0";

                    if (hasAnswered) {
                      if (isCorrect) {
                        bg = "rgba(34, 197, 94, 0.15)";
                        border = "1px solid rgba(34, 197, 94, 0.6)";
                        color = "#4ADE80";
                      } else if (isSelected) {
                        bg = "rgba(239, 68, 68, 0.15)";
                        border = "1px solid rgba(239, 68, 68, 0.6)";
                        color = "#F87171";
                      } else {
                        color = "var(--text-muted-alt)";
                      }
                    }

                    return (
                      <button
                        key={optIdx}
                        onClick={() => handleSelect(currentIndex, optIdx)}
                        disabled={hasAnswered}
                        style={{
                          background: bg,
                          border,
                          color,
                          padding: "10px 14px",
                          borderRadius: "var(--radius-sm)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          textAlign: "left",
                          fontSize: 13,
                          cursor: hasAnswered ? "default" : "pointer",
                          transition: "all 0.2s ease",
                        }}
                      >
                        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span
                            style={{
                              width: 20,
                              height: 20,
                              borderRadius: "50%",
                              background: "rgba(255, 255, 255, 0.08)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 10,
                              fontWeight: 700,
                            }}
                          >
                            {String.fromCharCode(65 + optIdx)}
                          </span>
                          <span>{opt}</span>
                        </span>
                        {hasAnswered && isCorrect && <Check size={14} color="#4ADE80" />}
                      </button>
                    );
                  })}
                </div>

                {/* Explanation */}
                {showExplanation[currentIndex] && (
                  <div
                    style={{
                      marginTop: 14,
                      padding: "10px 14px",
                      background: "rgba(255, 255, 255, 0.04)",
                      border: "1px solid rgba(255, 255, 255, 0.12)",
                      borderRadius: "var(--radius-sm)",
                      fontSize: 12,
                      lineHeight: 1.5,
                      color: "#FFFFFF",
                    }}
                  >
                    <span style={{ fontWeight: 700, color: "#FFFFFF", display: "block", marginBottom: 3 }}>
                      💡 Explanation:
                    </span>
                    {currentQ.explanation}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {questions.length > 0 && !isLoading && studyMode === "quiz" && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 14, borderTop: "1px solid rgba(255, 255, 255, 0.1)" }}>
            <button
              className="btn btn-outline"
              onClick={() => setCurrentIndex((p) => Math.max(0, p - 1))}
              disabled={currentIndex === 0}
            >
              Previous
            </button>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-outline" onClick={handleRegenerate} title="Generate new questions">
                <RefreshCw size={12} />
                <span>New Set</span>
              </button>
              <button
                className="btn btn-primary"
                onClick={() => setCurrentIndex((p) => Math.min(total - 1, p + 1))}
                disabled={currentIndex === total - 1}
              >
                Next Question
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
