"use client";

import { useState } from "react";
import { Lightbulb, X, Check, HelpCircle, Sparkles, RefreshCw, Upload, FileText } from "lucide-react";
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
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOptions, setSelectedOptions] = useState<Record<number, number>>({});
  const [showExplanation, setShowExplanation] = useState<Record<number, boolean>>({});
  const [numQuestions, setNumQuestions] = useState(5);

  if (!isOpen) return null;

  const currentDocs = activeSession?.documents || [];
  const currentQ = questions[currentIndex];
  const total = questions.length;

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
        style={{ maxWidth: 650, maxHeight: "90vh", display: "flex", flexDirection: "column" }}
      >
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <motion.div
              className="modal-icon-badge"
              whileHover={{ rotate: 15, scale: 1.1 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
            >
              <Lightbulb size={16} />
            </motion.div>
            <div>
              <span className="modal-title">Interactive Document Quiz</span>
              <div className="modal-subtitle">AI-Powered Concept Knowledge Assessment</div>
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

        {/* Body */}
        <div style={{ overflowY: "auto", padding: "16px 0", flex: 1 }}>
          {currentDocs.length === 0 ? (
            <div style={{ textAlign: "center", padding: "30px 20px" }}>
              <FileText size={32} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
              <h4 style={{ fontSize: 14, color: "#FFFFFF", marginBottom: 6 }}>No Documents in Active Conversation</h4>
              <p style={{ fontSize: 12, color: "var(--text-muted-alt)", maxWidth: 380, margin: "0 auto 18px" }}>
                DocMind requires at least one uploaded document or web page to synthesize quiz questions.
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
                Synthesizing Concept Quiz Questions…
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted-alt)" }}>
                Analyzing grounded facts from &ldquo;{activeSession?.title}&rdquo;
              </div>
            </div>
          ) : questions.length === 0 ? (
            <div style={{ textAlign: "center", padding: "30px 20px" }}>
              <Sparkles size={28} style={{ margin: "0 auto 10px", color: "#FFFFFF" }} />
              <h4 style={{ fontSize: 14, color: "#FFFFFF", marginBottom: 6 }}>Ready to Generate Quiz</h4>
              <p style={{ fontSize: 12, color: "var(--text-muted-alt)", marginBottom: 18 }}>
                Generate an instant self-assessment quiz grounded in {currentDocs.length} uploaded document{currentDocs.length !== 1 ? "s" : ""}.
              </p>
              <button
                className="btn btn-primary"
                onClick={handleRegenerate}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Sparkles size={13} />
                <span>Generate 5-Question Quiz</span>
              </button>
            </div>
          ) : (
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
        {questions.length > 0 && !isLoading && (
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
                <span>New Quiz</span>
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
