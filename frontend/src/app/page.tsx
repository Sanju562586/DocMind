"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  FileText,
  Upload,
  Sparkles,
  Layers,
  Search,
  BarChart3,
  Database,
  Trash2,
  Plus,
  Zap,
  PanelLeft,
  PanelLeftClose,
  RefreshCw,
  Sliders,
  CheckCircle2,
  Paperclip,
  ArrowUp,
  Cpu,
  Download,
  Edit3,
  X,
  Share2,
  Globe,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Sidebar from "@/components/Sidebar";
import { MessageBubble, StreamingMessage, TypingIndicator } from "@/components/MessageBubble";
import EmptyState from "@/components/EmptyState";
import { ApiKeyModal, DocumentUploadModal } from "@/components/Modals";
import { GlobalMemoryModal } from "@/components/GlobalMemoryModal";
import { PipelineModal } from "@/components/PipelineModal";
import { ShareModal } from "@/components/ShareModal";
import KeyboardShortcutsModal from "@/components/KeyboardShortcutsModal";
import InteractiveBackground from "@/components/InteractiveBackground";
import { QuizModal } from "@/components/QuizModal";
import { CompareModal } from "@/components/CompareModal";
import { UrlIngestModal } from "@/components/UrlIngestModal";
import { DocumentViewerModal } from "@/components/DocumentViewerModal";
import { CommandPaletteModal } from "@/components/CommandPaletteModal";
import {
  listSessions,
  createSession,
  getSession,
  getMessages,
  sendMessage,
  summarizeSession,
  deleteDocument,
  retryDocument,
  checkBackendHealth,
  listSessionDocuments,
  renameSession,
  uploadDocumentToSession,
  ingestUrl,
  compareDocuments,
  generateQuiz,
  listAllMemories,
  deleteMemoryItem,
  clearAllMemories,
  saveSecureKeys,
  QuizQuestion,
} from "@/lib/api";
import { exportSessionToPdf } from "@/lib/pdfExporter";
import { ApiKeys, Document, Message, Session, Source, MemoryItem } from "@/lib/types";
import { AuthModal } from "@/components/AuthModal";
import { useAuth } from "@/lib/auth";

function purgeLegacyPlaintextKeys() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem("docmind_api_keys");
    localStorage.removeItem("docmind_api_keys");
  } catch {
    // ignore
  }
}

function loadSidebarState(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const saved = localStorage.getItem("docmind_sidebar_open");
    if (saved !== null) return JSON.parse(saved);
    return window.innerWidth >= 768;
  } catch {
    return true;
  }
}

function saveSidebarState(isOpen: boolean) {
  if (typeof window !== "undefined") {
    localStorage.setItem("docmind_sidebar_open", JSON.stringify(isOpen));
  }
}

type ModalType = "none" | "upload" | "settings" | "memory" | "pipeline" | "shortcuts";

export default function HomePage() {
  const { user } = useAuth();
  const [apiKeys, setApiKeys] = useState<ApiKeys>({ gemini: "", groq: "", openrouter: "" });
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingMemories, setStreamingMemories] = useState<MemoryItem[]>([]);
  const [modal, setModal] = useState<ModalType>("none");
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [error, setError] = useState("");
  const [toasts, setToasts] = useState<Array<{ id: string; message: string; type?: "info" | "success" | "error" }>>([]);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [backendStatus, setBackendStatus] = useState<"healthy" | "unreachable" | "checking">("checking");
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitleValue, setEditingTitleValue] = useState("");
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  // New Upgrade Feature States
  const [isQuizOpen, setIsQuizOpen] = useState(false);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [isQuizLoading, setIsQuizLoading] = useState(false);

  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const [isCompareLoading, setIsCompareLoading] = useState(false);
  const [compareResult, setCompareResult] = useState("");

  const [isMemoryInspectorOpen, setIsMemoryInspectorOpen] = useState(false);
  const [globalMemories, setGlobalMemories] = useState<MemoryItem[]>([]);
  const [isMemoryLoading, setIsMemoryLoading] = useState(false);

  const [isUrlModalOpen, setIsUrlModalOpen] = useState(false);
  const [urlInputValue, setUrlInputValue] = useState("");
  const [isUrlLoading, setIsUrlLoading] = useState(false);

  const [viewerDoc, setViewerDoc] = useState<Document | null>(null);
  const [viewerPage, setViewerPage] = useState(1);
  const [isViewerOpen, setIsViewerOpen] = useState(false);

  // Command Palette & In-Chat Search States
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isChatSearchOpen, setIsChatSearchOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingMidChat, setIsUploadingMidChat] = useState(false);
  const [useGlobalMemory, setUseGlobalMemory] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("docmind_use_global_memory");
      return saved !== null ? saved === "true" : true;
    }
    return true;
  });

  // Handler functions for upgrade tools
  const handleOpenQuiz = async () => {
    setIsQuizOpen(true);
    if (activeSession && activeSession.documents && activeSession.documents.length > 0 && quizQuestions.length === 0) {
      handleGenerateQuiz(activeSession.id, 5);
    }
  };

  const handleGenerateQuiz = async (sessionId: string, numQ: number = 5) => {
    setIsQuizLoading(true);
    try {
      const questions = await generateQuiz(sessionId, apiKeys, numQ);
      setQuizQuestions(questions);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to generate quiz. Please check API keys.");
    } finally {
      setIsQuizLoading(false);
    }
  };

  const handleStartComparison = async (docIds: string[], focusTopic: string) => {
    let targetSession = activeSession;
    if (!targetSession) {
      try {
        const newId = await createSession("Document Comparison");
        const updatedList = await listSessions();
        setSessions(updatedList);
        targetSession = updatedList.find((s) => s.id === newId) || null;
        if (targetSession) setActiveSession(targetSession);
      } catch {
        showToast("Failed to initialize session for comparison");
        return;
      }
    }
    if (!targetSession) return;

    setIsCompareLoading(true);
    setCompareResult("");
    try {
      await compareDocuments(targetSession.id, docIds, focusTopic, apiKeys, {
        onToken: (t) => setCompareResult((prev) => prev + t),
        onDone: () => setIsCompareLoading(false),
        onError: (err) => {
          showToast(err);
          setIsCompareLoading(false);
        },
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Comparison failed");
      setIsCompareLoading(false);
    }
  };

  const handleIngestUrl = async (url: string) => {
    setIsUrlLoading(true);
    try {
      let targetSession = activeSession;
      if (!targetSession) {
        const domain = url.split("//")[1]?.split("/")[0] || "Web Article";
        const newId = await createSession(`Web: ${domain}`);
        const updatedList = await listSessions();
        setSessions(updatedList);
        targetSession = updatedList.find((s) => s.id === newId) || null;
        if (targetSession) setActiveSession(targetSession);
      }

      if (!targetSession) throw new Error("Could not initialize conversation session");

      const doc = await ingestUrl(targetSession.id, url);
      const updatedDocs = [...(targetSession.documents || []), doc];
      const updatedSession = { ...targetSession, documents: updatedDocs };
      setActiveSession(updatedSession);
      setSessions((prev) =>
        prev.map((s) => (s.id === targetSession!.id ? updatedSession : s))
      );
      showToast(`Ingested and indexed "${doc.filename}"`);
      setIsUrlModalOpen(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "URL ingestion failed");
      throw err;
    } finally {
      setIsUrlLoading(false);
    }
  };

  const handleExportChat = async (formatType: "pdf" | "markdown" | "json" | "print" = "pdf") => {
    if (!activeSession || messages.length === 0) return;

    if (formatType === "pdf") {
      try {
        setIsExportingPdf(true);
        showToast("Generating PDF document…");
        await exportSessionToPdf(activeSession, messages, (status) => {
          showToast(status);
        });
        showToast("PDF exported successfully!");
      } catch (err: any) {
        console.error("PDF export error:", err);
        showToast("Exporting via print engine…");
        window.print();
      } finally {
        setIsExportingPdf(false);
      }
      return;
    }

    if (formatType === "print") {
      window.print();
      return;
    }

    let textContent = "";
    let mimeType = "text/plain";
    let extension = "txt";

    if (formatType === "markdown") {
      mimeType = "text/markdown; charset=utf-8";
      extension = "md";
      const lines: string[] = [];
      lines.push(`# ${activeSession.title}`);
      lines.push(`*Exported from DocMind AI — ${new Date().toLocaleString()}*`);
      lines.push("");
      if (activeSession.documents && activeSession.documents.length > 0) {
        lines.push(`## Attached Documents`);
        activeSession.documents.forEach((d) => lines.push(`- ${d.filename} (${d.chunk_count} chunks)`));
        lines.push("");
      }
      lines.push(`## Conversation`);
      lines.push("");
      messages.forEach((msg) => {
        const role = msg.role === "user" ? "**You**" : "**DocMind AI**";
        const time = (() => {
          try { return new Date(msg.created_at).toLocaleTimeString(); } catch { return ""; }
        })();
        lines.push(`### ${role}${time ? ` — ${time}` : ""}`);
        lines.push("");
        lines.push(msg.content);
        lines.push("");
      });
      textContent = lines.join("\n");
    } else if (formatType === "json") {
      mimeType = "application/json";
      extension = "json";
      textContent = JSON.stringify({ session: activeSession, messages }, null, 2);
    }

    const blob = new Blob([textContent], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `DocMind_Export_${activeSession.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_${Date.now()}.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Session exported as .${extension}`);
  };

  const handleOpenCitation = (docId?: string, pageNum?: number) => {
    if (!activeSession) return;
    const doc =
      activeSession.documents?.find((d) => d.doc_id === docId || (d as any).id === docId) ||
      sessions.flatMap((s) => s.documents || []).find((d) => d.doc_id === docId || (d as any).id === docId) ||
      activeSession.documents?.[0];
    if (doc) {
      setViewerDoc(doc);
      setViewerPage(pageNum || 1);
      setIsViewerOpen(true);
    }
  };

  const showToast = useCallback((msg: string, type: "info" | "success" | "error" = "info") => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    setToasts((prev) => [...prev.slice(-3), { id, message: msg, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ── Load initial data & keyboard shortcuts ──────────────────────────────────
  useEffect(() => {
    purgeLegacyPlaintextKeys();
    setIsSidebarOpen(loadSidebarState());
    loadSessionsList();
    verifyHealth();

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || "").toLowerCase();
      const isInputActive = activeTag === "input" || activeTag === "textarea";

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setIsChatSearchOpen((prev) => !prev);
      } else if (e.key === "?" && !isInputActive && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setModal((prev) => (prev === "shortcuts" ? "none" : "shortcuts"));
      } else if (e.key === "Escape") {
        setIsEditingTitle(false);
        setIsCommandPaletteOpen(false);
        setIsChatSearchOpen(false);
        setModal("none");
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // ── Auto-reconnect health check polling when backend is unreachable ──────────
  useEffect(() => {
    if (backendStatus !== "unreachable") return;
    const interval = setInterval(async () => {
      try {
        await checkBackendHealth();
        setBackendStatus("healthy");
        loadSessionsList();
        showToast("Connected to DocMind backend server");
      } catch {
        // still unreachable, will retry
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [backendStatus]);

  // ── Sync user-isolated sessions when identity changes ──────────────────────
  useEffect(() => {
    if (user?.id) {
      loadSessionsList();
      setActiveSession(null);
      setMessages([]);
    }
  }, [user?.id]);

  const toggleSidebar = () => {
    setIsSidebarOpen((prev) => {
      const next = !prev;
      saveSidebarState(next);
      return next;
    });
  };

  const verifyHealth = async () => {
    try {
      await checkBackendHealth();
      setBackendStatus("healthy");
      loadSessionsList();
    } catch {
      setBackendStatus("unreachable");
    }
  };

  const loadSessionsList = async () => {
    try {
      const sessList = await listSessions();
      setSessions(sessList);
      setBackendStatus("healthy");
    } catch (err) {
      console.warn("Backend server not reachable during session loading:", err);
      setBackendStatus("unreachable");
    }
  };

  // ── Scroll to bottom ────────────────────────────────────────────────────────
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // Only auto-scroll if user is near the bottom (within 200px)
    if (distFromBottom < 200) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      setShowScrollToBottom(false);
    } else {
      setShowScrollToBottom(true);
    }
  }, [messages, streamingContent]);

  // ── Scroll detection for scroll-to-bottom button ─────────────────────────────
  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollToBottom(distFromBottom > 200);
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setShowScrollToBottom(false);
  };

  // ── Auto-resize textarea ────────────────────────────────────────────────────
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };

  // ── Select a session ────────────────────────────────────────────────────────
  const handleSelectSession = useCallback(async (session: Session) => {
    setActiveSession(session);
    setIsLoadingMessages(true);
    setMessages([]);
    setError("");
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setIsSidebarOpen(false);
      saveSidebarState(false);
    }
    try {
      const fullSession = await getSession(session.id);
      setActiveSession(fullSession);
      const msgs = await getMessages(session.id);
      setMessages(msgs);
    } catch {
      setError("Failed to load messages for this conversation");
    } finally {
      setIsLoadingMessages(false);
    }
  }, []);

  // ── Start a new chat ────────────────────────────────────────────────────────
  const handleNewChat = async () => {
    try {
      const newId = await createSession("New Conversation");
      const updatedList = await listSessions();
      setSessions(updatedList);
      const created = updatedList.find((s) => s.id === newId) || {
        id: newId,
        title: "New Conversation",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        documents: [],
        message_count: 0,
      };
      setActiveSession(created);
      setMessages([]);
      setInputValue("");
      setError("");
      if (typeof window !== "undefined" && window.innerWidth < 768) {
        setIsSidebarOpen(false);
        saveSidebarState(false);
      }
    } catch (err) {
      console.warn("Failed to create new chat session:", err);
      setError("Unable to connect to backend server. Please verify backend is running on port 8000.");
    }
  };

  const handleOpenUploadModal = async () => {
    let session = activeSession;
    if (!session) {
      try {
        const newId = await createSession("New Conversation");
        const updatedList = await listSessions();
        setSessions(updatedList);
        session = updatedList.find((s) => s.id === newId) || {
          id: newId,
          title: "New Conversation",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          documents: [],
          message_count: 0,
        };
        setActiveSession(session);
      } catch (err) {
        console.warn("Failed to create session for upload:", err);
      }
    }
    setModal("upload");
  };

  // ── Start with Prompt Spark ─────────────────────────────────────────────────
  const handleStartWithPrompt = async (promptText: string) => {
    let session = activeSession;
    if (!session) {
      try {
        const newId = await createSession(promptText.slice(0, 35) + (promptText.length > 35 ? "…" : ""));
        const updatedList = await listSessions();
        setSessions(updatedList);
        session = updatedList.find((s) => s.id === newId) || null;
        if (session) setActiveSession(session);
      } catch (err) {
        console.warn("Failed to create session for spark prompt:", err);
      }
    }
    setInputValue(promptText);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  // ── Send Message ────────────────────────────────────────────────────────────
  const handleSend = async (overrideText?: string | React.MouseEvent) => {
    const text = (typeof overrideText === "string" ? overrideText : inputValue).trim();
    if (!text || isStreaming) return;

    let session = activeSession;
    if (!session) {
      try {
        const newId = await createSession(text.slice(0, 35) + (text.length > 35 ? "…" : ""));
        const updatedList = await listSessions();
        setSessions(updatedList);
        session = updatedList.find((s) => s.id === newId) || null;
        if (session) setActiveSession(session);
      } catch (err) {
        setError("Failed to initialize conversation. Please check backend connection.");
        return;
      }
    }

    if (!session) return;

    setInputValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    const userMsg: Message = {
      id: `temp-${Date.now()}`,
      session_id: session.id,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    setIsStreaming(true);
    setStreamingContent("");
    setStreamingMemories([]);
    setError("");

    let fullContent = "";
    let capturedSources: Source[] = [];
    let capturedMemories: MemoryItem[] = [];

    try {
      await sendMessage(
        session.id,
        text,
        apiKeys,
        {
          onToken: (token) => {
            fullContent += token;
            setStreamingContent(fullContent);
          },
          onSources: (srcs) => {
            capturedSources = srcs;
          },
          onMemoryRecalled: (mems) => {
            capturedMemories = mems;
            setStreamingMemories(mems);
          },
          onDone: () => {
            setIsStreaming(false);
            setStreamingContent("");
            setStreamingMemories([]);
            const assistantMsg: Message = {
              id: `assistant-${Date.now()}`,
              session_id: session!.id,
              role: "assistant",
              content: fullContent,
              created_at: new Date().toISOString(),
              sources: capturedSources,
              memory_recalled: capturedMemories,
            };
            setMessages((prev) => [...prev, assistantMsg]);
            listSessions().then(setSessions).catch((err) => console.warn("Failed to refresh sessions list:", err));
          },
          onError: (errMsg) => {
            setIsStreaming(false);
            setStreamingContent("");
            setStreamingMemories([]);
            setError(errMsg);
            if (errMsg.toLowerCase().includes("no api key") || errMsg.toLowerCase().includes("api keys")) {
              setModal("settings");
            }
          },
        },
        useGlobalMemory
      );
    } catch (err) {
      console.warn("Chat transmission error:", err);
      setIsStreaming(false);
      setStreamingContent("");
      setStreamingMemories([]);
      setError("An unexpected error occurred during chat transmission.");
    } finally {
      setTimeout(() => setIsStreaming(false), 200);
    }
  };

  // ── Summarize Session Documents ─────────────────────────────────────────────
  const handleSummarize = async () => {
    if (!activeSession || isStreaming) return;
    if (!activeSession.documents || activeSession.documents.length === 0) {
      setError("Please attach at least one document to this chat before summarizing.");
      return;
    }

    setIsStreaming(true);
    setStreamingContent("");
    setStreamingMemories([]);
    setError("");

    let fullContent = "";

    try {
      await summarizeSession(activeSession.id, apiKeys, {
        onToken: (token) => {
          fullContent += token;
          setStreamingContent(fullContent);
        },
        onDone: () => {
          setIsStreaming(false);
          setStreamingContent("");
          const summaryMsg: Message = {
            id: `summary-${Date.now()}`,
            session_id: activeSession.id,
            role: "assistant",
            content: fullContent,
            created_at: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, summaryMsg]);
          listSessions().then(setSessions).catch((err) => console.warn("Failed to refresh sessions list:", err));
        },
        onError: (errMsg) => {
          setIsStreaming(false);
          setStreamingContent("");
          setError(errMsg);
        },
      });
    } catch (err) {
      console.warn("Summarization error:", err);
      setIsStreaming(false);
      setStreamingContent("");
      setError("An unexpected error occurred while generating summary.");
    } finally {
      setTimeout(() => setIsStreaming(false), 200);
    }
  };

  // ── Session Title Editing ───────────────────────────────────────────────────
  const handleStartTitleEdit = () => {
    if (!activeSession) return;
    setEditingTitleValue(activeSession.title);
    setIsEditingTitle(true);
    setTimeout(() => titleInputRef.current?.select(), 50);
  };

  const handleSaveTitle = async () => {
    const newTitle = editingTitleValue.trim();
    if (newTitle && activeSession && newTitle !== activeSession.title) {
      const updated = { ...activeSession, title: newTitle };
      setActiveSession(updated);
      setSessions((prev) =>
        prev.map((s) => (s.id === activeSession.id ? { ...s, title: newTitle } : s))
      );
      try {
        await renameSession(activeSession.id, newTitle);
      } catch (err) {
        console.warn("Failed to persist session rename to backend:", err);
      }
    }
    setIsEditingTitle(false);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSaveTitle();
    if (e.key === "Escape") setIsEditingTitle(false);
  };

  // ── All Sessions Deleted ───────────────────────────────────────────────────
  const handleAllSessionsDeleted = () => {
    setSessions([]);
    setActiveSession(null);
    setMessages([]);
    setInputValue("");
    setError("");
    showToast("All conversations deleted successfully");
  };

  // ── Regenerate Last Message ────────────────────────────────────────────────
  const handleRegenerate = async () => {
    if (isStreaming || messages.length === 0 || !activeSession) return;
    // Find last user message
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return;

    // Remove the trailing assistant message if present
    const trimmed = messages[messages.length - 1].role === "assistant"
      ? messages.slice(0, -1)
      : messages;
    setMessages(trimmed);

    setIsStreaming(true);
    setStreamingContent("");
    setStreamingMemories([]);
    setError("");

    let fullContent = "";
    let capturedSources: Source[] = [];
    let capturedMemories: MemoryItem[] = [];

    try {
      await sendMessage(activeSession.id, lastUserMsg.content, apiKeys, {
        onToken: (token) => {
          fullContent += token;
          setStreamingContent(fullContent);
        },
        onSources: (srcs) => {
          capturedSources = srcs;
        },
        onMemoryRecalled: (mems) => {
          capturedMemories = mems;
          setStreamingMemories(mems);
        },
        onDone: () => {
          setIsStreaming(false);
          setStreamingContent("");
          setStreamingMemories([]);
          const assistantMsg: Message = {
            id: `assistant-${Date.now()}`,
            session_id: activeSession.id,
            role: "assistant",
            content: fullContent,
            created_at: new Date().toISOString(),
            sources: capturedSources,
            memory_recalled: capturedMemories,
          };
          setMessages((prev) => [...prev, assistantMsg]);
        },
        onError: (errMsg) => {
          setIsStreaming(false);
          setStreamingContent("");
          setStreamingMemories([]);
          setError(errMsg);
        },
      });
    } catch (err) {
      setIsStreaming(false);
      setError("Failed to regenerate response.");
    }
  };

  // ── Document Added ──────────────────────────────────────────────────────────
  const handleDocumentAttached = (doc: Document) => {
    if (activeSession) {
      const updatedDocs = [...(activeSession.documents || []), doc];
      const updatedSession = { ...activeSession, documents: updatedDocs };
      setActiveSession(updatedSession);
      setSessions((prev) =>
        prev.map((s) => (s.id === activeSession.id ? updatedSession : s))
      );

      // Post in-chat system notification announcing document attachment mid-conversation
      const sysMsg: Message = {
        id: `doc-attach-${doc.doc_id || Date.now()}`,
        session_id: activeSession.id,
        role: "system",
        content: `Attached "${doc.filename}" to this conversation. The knowledge has been indexed for Q&A.`,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, sysMsg]);
    }
    showToast(`Attached ${doc.filename} successfully`, "success");
  };

  // ── Background Polling ──────────────────────────────────────────────────────
  const docStatusKey = activeSession?.documents
    ? activeSession.documents.map((d) => `${d.doc_id || (d as any).id}:${d.status}`).join(",")
    : "";

  useEffect(() => {
    if (!activeSession) return;
    const hasProcessing = activeSession.documents?.some(
      (d) => d.status === "processing"
    );
    if (!hasProcessing) return;

    let attempts = 0;
    let consecutiveErrors = 0;
    const maxAttempts = 40;
    let timerId: NodeJS.Timeout | null = null;
    let isCancelled = false;

    const poll = async () => {
      if (isCancelled) return;
      attempts++;
      let nextDelay = 3000; // 3 seconds baseline interval

      try {
        const docs = await listSessionDocuments(activeSession.id);
        consecutiveErrors = 0;
        const stillProcessing = docs.some((d) => d.status === "processing");
        setActiveSession((prev) => {
          if (!prev || prev.id !== activeSession.id) return prev;
          return { ...prev, documents: docs };
        });
        setSessions((prev) =>
          prev.map((s) => (s.id === activeSession.id ? { ...s, documents: docs } : s))
        );

        if (!stillProcessing) {
          return;
        }

        if (attempts >= maxAttempts) {
          showToast("Document processing is taking longer than usual. You can check status or retry.", "info");
          return;
        }
      } catch (err: unknown) {
        consecutiveErrors++;
        console.warn("Background document polling notice:", err);
        // Exponential backoff if encountering errors/rate limits (up to 12s)
        nextDelay = Math.min(12000, 3000 * Math.pow(1.5, consecutiveErrors));
        if (consecutiveErrors >= 5) {
          console.warn("Pausing background polling due to repeated errors.");
          return;
        }
      }

      if (!isCancelled) {
        timerId = setTimeout(poll, nextDelay);
      }
    };

    // Initial slight delay before first poll to allow server queue to settle
    timerId = setTimeout(poll, 2000);

    return () => {
      isCancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, [activeSession?.id, docStatusKey]);

  // ── Retry Document Processing ───────────────────────────────────────────────
  const [retryingDocId, setRetryingDocId] = useState<string | null>(null);

  const handleRetryDocument = async (docId: string) => {
    if (!activeSession) return;
    setRetryingDocId(docId);
    showToast("Retrying document processing…", "info");
    try {
      const updatedDoc = await retryDocument(docId);
      const updatedDocs = (activeSession.documents || []).map((d) =>
        d.doc_id === docId || (d as any).id === docId
          ? { ...d, ...updatedDoc, status: "processing" as const }
          : d
      );
      const updatedSession = { ...activeSession, documents: updatedDocs };
      setActiveSession(updatedSession);
      setSessions((prev) =>
        prev.map((s) => (s.id === activeSession.id ? updatedSession : s))
      );
    } catch (err: any) {
      showToast(err?.message || "Failed to retry document processing", "error");
    } finally {
      setRetryingDocId(null);
    }
  };

  // ── Delete Document ─────────────────────────────────────────────────────────
  const handleDeleteDocument = async (docId: string) => {
    if (!activeSession) return;
    setDeletingDocId(docId);
    try {
      await deleteDocument(docId);
      const updatedDocs = (activeSession.documents || []).filter(
        (d) => d.doc_id !== docId && (d as any).id !== docId
      );
      const updatedSession = { ...activeSession, documents: updatedDocs };
      setActiveSession(updatedSession);
      setSessions((prev) =>
        prev.map((s) => (s.id === activeSession.id ? updatedSession : s))
      );
      showToast("Document deleted");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to delete document");
    } finally {
      setDeletingDocId(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSaveKeys = (keys: ApiKeys) => {
    setApiKeys(keys);
    saveSecureKeys(keys).catch((err) => console.warn("Failed to persist secure keys:", err));
    showToast("Multi-LLM API Keys updated");
  };

  // ── Drag & Drop Anywhere on Workspace ──────────────────────────────────────
  const handleWorkspaceDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes("Files")) {
      setIsDraggingFile(true);
    }
  };

  const handleWorkspaceDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDraggingFile(false);
  };

  const handleWorkspaceDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    let targetSessionId = activeSession?.id;
    if (!targetSessionId) {
      try {
        const newId = await createSession(files[0].name.replace(/\.[^/.]+$/, ""));
        const updatedList = await listSessions();
        setSessions(updatedList);
        const s = updatedList.find((item) => item.id === newId);
        if (s) setActiveSession(s);
        targetSessionId = newId;
      } catch {
        setError("Failed to create conversation for uploaded document");
        return;
      }
    }

    setIsUploadingMidChat(true);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        showToast(`Uploading ${file.name}…`, "info");
        const doc = await uploadDocumentToSession(targetSessionId, file, apiKeys);
        handleDocumentAttached(doc);
      } catch (err) {
        setError((err as Error).message || `Upload failed for ${file.name}`);
      }
    }
    setIsUploadingMidChat(false);
  };

  // ── Native File Input (Paperclip Click) ─────────────────────────────────────
  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    let targetSessionId = activeSession?.id;
    if (!targetSessionId) {
      try {
        const newId = await createSession(files[0].name.replace(/\.[^/.]+$/, ""));
        const updatedList = await listSessions();
        setSessions(updatedList);
        const s = updatedList.find((item) => item.id === newId);
        if (s) setActiveSession(s);
        targetSessionId = newId;
      } catch {
        setError("Failed to create conversation for uploaded document");
        return;
      }
    }

    setIsUploadingMidChat(true);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        showToast(`Uploading ${file.name}…`, "info");
        const doc = await uploadDocumentToSession(targetSessionId, file, apiKeys);
        handleDocumentAttached(doc);
      } catch (err: any) {
        setError(err?.message || `Upload failed for ${file.name}`);
      }
    }
    setIsUploadingMidChat(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const hasSession = !!activeSession;
  const currentDocs = activeSession?.documents || [];
  const configuredKeyCount = Object.values(apiKeys).filter(Boolean).length;

  return (
    <>
      {/* Monochromatic 3D Background */}
      <InteractiveBackground isStreaming={isStreaming} />

      <div className={`app-shell ${isSidebarOpen ? "sidebar-expanded" : "sidebar-collapsed"}`}>
        {/* Mobile Backdrop Overlay */}
        {isSidebarOpen && (
          <div
            className="sidebar-backdrop"
            onClick={() => {
              setIsSidebarOpen(false);
              saveSidebarState(false);
            }}
          />
        )}

        {/* Sidebar */}
        <Sidebar
          isOpen={isSidebarOpen}
          sessions={sessions}
          activeSessionId={activeSession?.id || null}
          apiKeys={apiKeys}
          backendStatus={backendStatus}
          onNewChat={handleNewChat}
          onSelectSession={handleSelectSession}
          onSessionDeleted={(id) => {
            setSessions((prev) => prev.filter((s) => s.id !== id));
            if (activeSession?.id === id) {
              setActiveSession(null);
              setMessages([]);
            }
          }}
          onSessionRenamed={(id, newTitle) => {
            setSessions((prev) =>
              prev.map((s) => (s.id === id ? { ...s, title: newTitle } : s))
            );
            if (activeSession?.id === id) {
              setActiveSession((prev) => (prev ? { ...prev, title: newTitle } : prev));
            }
          }}
          onAllSessionsDeleted={handleAllSessionsDeleted}
          onOpenSettings={() => setModal("settings")}
          onOpenShortcuts={() => setModal("shortcuts")}
          onOpenCompare={() => setIsCompareOpen(true)}
          onOpenQuiz={handleOpenQuiz}
          onOpenMemoryInspector={() => setModal("memory")}
          onOpenUrlIngest={() => setIsUrlModalOpen(true)}
          onCloseSidebar={() => {
            setIsSidebarOpen(false);
            saveSidebarState(false);
          }}
        />

        {/* Main Workspace */}
        <main
          className="main-content"
          onDragOver={handleWorkspaceDragOver}
          onDragLeave={handleWorkspaceDragLeave}
          onDrop={handleWorkspaceDrop}
        >
          {/* Workspace Drag Overlay */}
          <AnimatePresence>
            {isDraggingFile && (
              <motion.div
                className="workspace-drag-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <div className="workspace-drag-content">
                  <Upload size={38} color="#FFFFFF" />
                  <div className="workspace-drag-title">Drop document here to attach</div>
                  <div className="workspace-drag-subtitle">PDF, DOCX, TXT, MD, CSV, XLSX supported</div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {/* Responsive Topbar Header */}
          <header className="topbar">
            <div className="topbar-left">
              <motion.button
                className="topbar-icon-btn"
                onClick={toggleSidebar}
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.92 }}
                transition={{ type: "spring", stiffness: 400, damping: 20 }}
                title={isSidebarOpen ? "Collapse sidebar (Ctrl+B)" : "Expand sidebar (Ctrl+B)"}
                aria-label="Toggle sidebar"
              >
                <PanelLeft size={16} />
              </motion.button>

              <div className="topbar-title-group">
                {isEditingTitle && hasSession ? (
                  <input
                    ref={titleInputRef}
                    type="text"
                    value={editingTitleValue}
                    onChange={(e) => setEditingTitleValue(e.target.value)}
                    onBlur={handleSaveTitle}
                    onKeyDown={handleTitleKeyDown}
                    className="topbar-title-input"
                    maxLength={80}
                    aria-label="Edit conversation title"
                  />
                ) : (
                  <motion.div
                    className="topbar-title"
                    onClick={hasSession ? handleStartTitleEdit : undefined}
                    title={hasSession ? "Double-click to rename" : undefined}
                    style={{ cursor: hasSession ? "text" : "default" }}
                    whileHover={hasSession ? { opacity: 0.8 } : {}}
                  >
                    {hasSession ? activeSession.title : "DocMind AI"}
                  </motion.div>
                )}
                {hasSession && currentDocs.length > 0 && !isEditingTitle && (
                  <span className="topbar-doc-pill">
                    <FileText size={10.5} />
                    <span>{currentDocs.length} {currentDocs.length === 1 ? "doc" : "docs"}</span>
                  </span>
                )}
              </div>
            </div>

            <div className="topbar-actions">
              <motion.button
                className="topbar-action-btn"
                onClick={() => setIsCommandPaletteOpen(true)}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.95 }}
                title="Launch Command Palette (Cmd+K)"
              >
                <Search size={13} />
                <span className="hide-on-tablet">Launch</span>
                <kbd style={{ fontSize: 9, padding: "1px 4px", background: "rgba(255,255,255,0.1)", borderRadius: 3 }}>⌘K</kbd>
              </motion.button>

              {hasSession && messages.length > 0 && (
                <motion.button
                  className="topbar-icon-btn"
                  onClick={() => {
                    setIsChatSearchOpen((prev) => !prev);
                    if (isChatSearchOpen) setChatSearchQuery("");
                  }}
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.92 }}
                  title="Search conversation (Ctrl+F)"
                  aria-label="Search conversation"
                >
                  <Search size={14} color={isChatSearchOpen ? "#60A5FA" : "#FFFFFF"} />
                </motion.button>
              )}

              {hasSession && currentDocs.length > 0 && (
                <motion.button
                  className="topbar-action-btn summarize-btn"
                  onClick={handleSummarize}
                  disabled={isStreaming}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.95 }}
                  title="Synthesize and summarize active conversation documents"
                >
                  <Sparkles size={13} color="#000000" />
                  <span className="hide-on-mobile">Summarize</span>
                </motion.button>
              )}

              {hasSession && messages.length > 0 && (
                <motion.button
                  className="topbar-action-btn hide-on-tablet"
                  onClick={() => handleExportChat("pdf")}
                  disabled={isExportingPdf}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.95 }}
                  title="Export conversation as styled PDF"
                >
                  {isExportingPdf ? (
                    <div className="spin" style={{ width: 13, height: 13, border: "1.5px solid #FFFFFF", borderTopColor: "transparent", borderRadius: "50%" }} />
                  ) : (
                    <Download size={13.5} />
                  )}
                  <span>Export</span>
                </motion.button>
              )}

              {hasSession && (
                <motion.button
                  className="topbar-action-btn"
                  onClick={() => setIsShareModalOpen(true)}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.95 }}
                  title="Share conversation transcript via public link"
                >
                  <Share2 size={13.5} />
                  <span className="hide-on-tablet">Share</span>
                </motion.button>
              )}

              <motion.button
                className="topbar-action-btn"
                onClick={() => setModal("pipeline")}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.95 }}
                title="View AI Pipeline Architecture"
              >
                <Layers size={13.5} />
                <span className="hide-on-tablet">Pipeline</span>
              </motion.button>

              <motion.button
                className="topbar-action-btn"
                onClick={() => setModal("memory")}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.95 }}
                title="View Global Cross-Session Memory"
              >
                <Database size={13.5} />
                <span className="hide-on-tablet">Memory</span>
              </motion.button>

              <motion.button
                className="topbar-icon-btn"
                onClick={() => setModal("settings")}
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.92 }}
                title="Configure Multi-LLM API Keys"
                aria-label="Settings"
              >
                <Cpu size={15} />
              </motion.button>

              <motion.button
                className="topbar-icon-btn mobile-new-chat-btn"
                onClick={handleNewChat}
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.92 }}
                title="Start New Conversation"
                aria-label="New chat"
              >
                <Plus size={16} />
              </motion.button>
            </div>
          </header>

          {/* In-Chat Search Bar */}
          <AnimatePresence>
            {isChatSearchOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 20px",
                  background: "rgba(12, 12, 16, 0.96)",
                  borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
                  backdropFilter: "blur(12px)",
                  zIndex: 20,
                }}
              >
                <Search size={13} color="rgba(255, 255, 255, 0.5)" />
                <input
                  type="text"
                  value={chatSearchQuery}
                  onChange={(e) => setChatSearchQuery(e.target.value)}
                  placeholder="Find in this chat…"
                  autoFocus
                  style={{
                    flex: 1,
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    color: "#FFFFFF",
                    fontSize: 12,
                    fontFamily: "inherit",
                  }}
                />
                {chatSearchQuery && (
                  <span style={{ fontSize: 11, color: "rgba(255, 255, 255, 0.5)" }}>
                    {messages.filter((m) => m.content.toLowerCase().includes(chatSearchQuery.toLowerCase())).length} found
                  </span>
                )}
                <button
                  className="icon-btn"
                  onClick={() => {
                    setIsChatSearchOpen(false);
                    setChatSearchQuery("");
                  }}
                  style={{ width: 20, height: 20 }}
                  title="Close search"
                >
                  <X size={12} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {hasSession ? (
            <>
              {/* Session Documents Context Header Strip */}
              {currentDocs.length > 0 && (
                <div className="context-strip">
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flex: 1 }}>
                    <span className="context-strip-label">
                      Active Chat Context:
                    </span>
                    <AnimatePresence>
                      {currentDocs.map((d, dIdx) => (
                        <motion.div
                          key={d.doc_id || `doc-chip-${dIdx}-${d.filename}`}
                          layout
                          initial={{ scale: 0.8, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.8, opacity: 0 }}
                          whileHover={{ scale: 1.03, y: -1 }}
                          transition={{ type: "spring", stiffness: 400, damping: 25 }}
                          className="doc-chip"
                        >
                          <FileText size={13} color="#FFFFFF" />
                          <span style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>
                            {d.filename}
                          </span>
                          {d.status === "processing" ? (
                            <span style={{ fontSize: 10, color: "#FFFFFF", display: "inline-flex", alignItems: "center", gap: 4, background: "rgba(255, 255, 255, 0.1)", padding: "1px 6px", borderRadius: 4 }}>
                              <div className="spin" style={{ width: 8, height: 8, border: "1.2px solid #FFFFFF", borderTopColor: "transparent", borderRadius: "50%" }} />
                              Processing…
                            </span>
                          ) : d.status === "error" ? (
                            <span
                              style={{ fontSize: 10, color: "#FFA07A", display: "inline-flex", alignItems: "center", gap: 4, background: "rgba(255, 99, 71, 0.15)", padding: "1px 6px", borderRadius: 4, cursor: "pointer" }}
                              title={d.error_message || "Processing failed or timed out. Click refresh icon to retry."}
                              onClick={() => handleRetryDocument(d.doc_id || (d as any).id)}
                            >
                              Failed
                              <motion.span
                                style={{ display: "inline-flex", alignItems: "center" }}
                                title="Retry processing"
                                whileHover={{ scale: 1.25 }}
                                whileTap={{ scale: 0.85 }}
                              >
                                {retryingDocId === (d.doc_id || (d as any).id) ? (
                                  <div className="spin" style={{ width: 7, height: 7, border: "1px solid #FFA07A", borderTopColor: "transparent", borderRadius: "50%" }} />
                                ) : (
                                  <RefreshCw size={9} color="#FFA07A" />
                                )}
                              </motion.span>
                            </span>
                          ) : (
                            <span style={{ fontSize: 10, color: "var(--text-muted-alt)" }}>
                              ({d.chunk_count} chunks)
                            </span>
                          )}
                          <motion.button
                            className="icon-btn"
                            style={{ width: 18, height: 18, marginLeft: 2 }}
                            onClick={() => handleDeleteDocument(d.doc_id)}
                            disabled={deletingDocId === d.doc_id}
                            title="Remove document from this chat"
                            whileHover={{ scale: 1.25 }}
                            whileTap={{ scale: 0.8 }}
                          >
                            {deletingDocId === d.doc_id ? (
                              <div className="spin" style={{ width: 8, height: 8, border: "1px solid #FFFFFF", borderTopColor: "transparent", borderRadius: "50%" }} />
                            ) : (
                              <Trash2 size={11} color="#FFFFFF" />
                            )}
                          </motion.button>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>

                  <motion.button
                    className="btn btn-outline"
                    style={{ padding: "4px 10px", fontSize: 11 }}
                    onClick={handleOpenUploadModal}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <Plus size={11} color="#FFFFFF" /> Add Document
                  </motion.button>
                </div>
              )}

              {/* Chat Message Stream */}
              <div
                ref={chatScrollRef}
                className="chat-scrollable"
                onScroll={handleChatScroll}
              >
                {/* Scroll To Bottom Button */}
                <AnimatePresence>
                  {showScrollToBottom && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0.85, y: 10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.85, y: 10 }}
                      transition={{ type: "spring", stiffness: 400, damping: 25 }}
                      onClick={scrollToBottom}
                      className="scroll-to-bottom-btn"
                      title="Scroll to bottom"
                      aria-label="Scroll to latest message"
                    >
                      ↓
                    </motion.button>
                  )}
                </AnimatePresence>
                <div className="chat-container">
                  {currentDocs.length === 0 && messages.length === 0 && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95, y: 20 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      transition={{ type: "spring", stiffness: 350, damping: 25 }}
                      style={{
                        padding: "36px 24px",
                        textAlign: "center",
                        border: "1px dashed rgba(255, 255, 255, 0.25)",
                        borderRadius: "var(--radius-xl)",
                        background: "#080808",
                        maxWidth: 640,
                        margin: "40px auto 0",
                        backdropFilter: "blur(20px)",
                        boxShadow: "var(--shadow-md)",
                      }}
                    >
                      <motion.div
                        style={{
                          width: 52,
                          height: 52,
                          borderRadius: "var(--radius-lg)",
                          background: "#141414",
                          border: "1px solid rgba(255, 255, 255, 0.3)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          margin: "0 auto 16px",
                          color: "#FFFFFF",
                        }}
                        whileHover={{ rotate: 10, scale: 1.1 }}
                      >
                        <FileText size={26} color="#FFFFFF" />
                      </motion.div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "#FFFFFF", marginBottom: 6 }}>
                        No Documents Attached to This Conversation
                      </div>
                      <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 20 }}>
                        Attach PDF, DOCX, TXT, CSV, or XLSX files to activate hierarchical hybrid retrieval, or chat freely with continuous cross-session memory.
                      </p>
                      <motion.button
                        className="btn btn-primary"
                        onClick={handleOpenUploadModal}
                        whileHover={{ scale: 1.04, y: -2 }}
                        whileTap={{ scale: 0.95 }}
                      >
                        <Upload size={14} color="#000000" />
                        <span>Attach Document to Chat</span>
                      </motion.button>
                    </motion.div>
                  )}

                  {isLoadingMessages && (
                    <div style={{ textAlign: "center", color: "var(--text-muted-alt)", padding: 24, fontSize: 13 }}>
                      Loading conversation history…
                    </div>
                  )}

                  <AnimatePresence initial={false}>
                    {messages.map((msg, idx) => (
                      <MessageBubble
                        key={msg.id}
                        message={msg}
                        isLatest={idx === messages.length - 1}
                        onOpenCitation={handleOpenCitation}
                        onSelectFollowUp={(q: string) => handleSend(q)}
                      />
                    ))}
                  </AnimatePresence>

                  {isStreaming && streamingContent && (
                    <StreamingMessage
                      content={streamingContent}
                      memories={streamingMemories}
                    />
                  )}

                  {isStreaming && !streamingContent && <TypingIndicator />}

                  <AnimatePresence>
                    {error && (
                      <motion.div
                        className="error-banner"
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        style={{ marginTop: 12 }}
                      >
                        <span>{error}</span>
                        <button
                          onClick={() => setError("")}
                          style={{ marginLeft: "auto", background: "none", border: "none", color: "#FFFFFF", cursor: "pointer", fontSize: 12 }}
                        >
                          Dismiss
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <AnimatePresence>
                    {messages.length > 0 && !isStreaming && messages[messages.length - 1].role === "assistant" && (
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        style={{ display: "flex", justifyContent: "flex-end", marginTop: -10, paddingRight: 4 }}
                      >
                        <motion.button
                          className="regenerate-btn"
                          onClick={handleRegenerate}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          title="Regenerate the latest AI response"
                        >
                          <RefreshCw size={11} />
                          <span>Regenerate</span>
                        </motion.button>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div ref={messagesEndRef} />
                </div>
              </div>

              {/* Chat Input Floating Command Bar */}
              <div className="input-area">
                <div className="input-container">
                  {/* Knowledge Scope Toggle Bar & Mid-Chat Upload Indicator */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "0 6px 8px",
                      fontSize: 11,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: "rgba(255, 255, 255, 0.4)", fontWeight: 500 }}>
                        Memory Scope:
                      </span>
                      <div
                        style={{
                          display: "inline-flex",
                          background: "rgba(255, 255, 255, 0.05)",
                          borderRadius: 7,
                          padding: 2,
                          border: "1px solid rgba(255, 255, 255, 0.09)",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setUseGlobalMemory(true);
                            if (typeof window !== "undefined") {
                              localStorage.setItem("docmind_use_global_memory", "true");
                            }
                            showToast("Global Knowledge active: all previous documents & chats will be searched", "info");
                          }}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            padding: "3px 8px",
                            borderRadius: 5,
                            border: "none",
                            background: useGlobalMemory ? "#FFFFFF" : "transparent",
                            color: useGlobalMemory ? "#000000" : "rgba(255, 255, 255, 0.6)",
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                          title="Search knowledge from all previously uploaded documents + past conversation insights"
                        >
                          <Globe size={11} color={useGlobalMemory ? "#000000" : "currentColor"} />
                          <span>Global Knowledge (All Docs)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setUseGlobalMemory(false);
                            if (typeof window !== "undefined") {
                              localStorage.setItem("docmind_use_global_memory", "false");
                            }
                            showToast("Current Chat Only active: strictly queries this conversation", "info");
                          }}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            padding: "3px 8px",
                            borderRadius: 5,
                            border: "none",
                            background: !useGlobalMemory ? "#FFFFFF" : "transparent",
                            color: !useGlobalMemory ? "#000000" : "rgba(255, 255, 255, 0.6)",
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                          title="Strictly query only documents and messages belonging to this current chat"
                        >
                          <FileText size={11} color={!useGlobalMemory ? "#000000" : "currentColor"} />
                          <span>Current Chat Only</span>
                        </button>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {isUploadingMidChat && (
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#60A5FA", fontSize: 11 }}>
                          <div className="spin" style={{ width: 10, height: 10, border: "1.5px solid #60A5FA", borderTopColor: "transparent", borderRadius: "50%" }} />
                          <span>Uploading &amp; Indexing…</span>
                        </div>
                      )}
                      {currentDocs.length > 0 && !isUploadingMidChat && (
                        <span style={{ color: "rgba(255, 255, 255, 0.4)", fontSize: 10.5 }}>
                          {currentDocs.length} {currentDocs.length === 1 ? "document" : "documents"} attached
                        </span>
                      )}
                    </div>
                  </div>

                  <input
                    type="file"
                    multiple
                    ref={fileInputRef}
                    onChange={handleFileInputChange}
                    style={{ display: "none" }}
                  />

                  <div className="input-box-wrapper">
                    <motion.button
                      className="input-action-btn"
                      onClick={() => fileInputRef.current?.click()}
                      title="Attach documents to this conversation at any time (PDF, PPT, DOCX, Code, or any file)"
                      disabled={isStreaming || isUploadingMidChat}
                      whileHover={{ scale: 1.15 }}
                      whileTap={{ scale: 0.88 }}
                      transition={{ type: "spring", stiffness: 450, damping: 20 }}
                    >
                      <Paperclip size={16} color="#FFFFFF" />
                    </motion.button>

                    <textarea
                      ref={textareaRef}
                      className="chat-textarea"
                      placeholder={
                        currentDocs.length > 0
                          ? "Ask about attached documents or past conversation insights…"
                          : "Type a prompt or attach documents to this conversation…"
                      }
                      value={inputValue}
                      onChange={handleInputChange}
                      onKeyDown={handleKeyDown}
                      rows={1}
                      disabled={isStreaming}
                    />

                    <motion.button
                      className="input-action-btn send-btn"
                      onClick={handleSend}
                      disabled={!inputValue.trim() || isStreaming}
                      title="Send message (Enter)"
                      whileHover={{ scale: !inputValue.trim() || isStreaming ? 1 : 1.1 }}
                      whileTap={{ scale: !inputValue.trim() || isStreaming ? 1 : 0.88 }}
                      transition={{ type: "spring", stiffness: 450, damping: 20 }}
                    >
                      {isStreaming ? (
                        <div
                          className="spin"
                          style={{
                            width: 13,
                            height: 13,
                            border: "1.5px solid #000000",
                            borderTopColor: "transparent",
                            borderRadius: "50%",
                          }}
                        />
                      ) : (
                        <ArrowUp size={16} strokeWidth={2.5} color="#000000" />
                      )}
                    </motion.button>
                  </div>

                  <div className="input-footer-hints">
                    <span className="hide-on-mobile">Press <strong>Enter</strong> to send &bull; <strong>Shift+Enter</strong> for newline</span>
                    <span className="hide-on-mobile"><strong>Ctrl+B</strong> to toggle sidebar</span>
                    {inputValue.length > 0 && (
                      <span
                        className={`char-counter ${
                          inputValue.length > 3000 ? "limit" :
                          inputValue.length > 2000 ? "warn" : ""
                        }`}
                      >
                        {inputValue.length.toLocaleString()} chars
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="chat-scrollable">
              <EmptyState
                onStartNewChat={handleNewChat}
                onOpenSettings={() => setModal("settings")}
                onSelectPrompt={handleStartWithPrompt}
              />
            </div>
          )}
        </main>
      </div>

      {/* Modals with AnimatePresence */}
      <AnimatePresence>
        {modal === "settings" && (
          <ApiKeyModal
            apiKeys={apiKeys}
            onSave={handleSaveKeys}
            onClose={() => setModal("none")}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {modal === "upload" && activeSession && (
          <DocumentUploadModal
            sessionId={activeSession.id}
            apiKeys={apiKeys}
            onClose={() => setModal("none")}
            onUploaded={handleDocumentAttached}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {modal === "memory" && (
          <GlobalMemoryModal
            sessions={sessions}
            onClose={() => setModal("none")}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {modal === "pipeline" && (
          <PipelineModal
            onClose={() => setModal("none")}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {modal === "shortcuts" && (
          <KeyboardShortcutsModal
            onClose={() => setModal("none")}
          />
        )}
      </AnimatePresence>

      {/* Upgrade Feature Modals with AnimatePresence */}
      <AnimatePresence>
        {isQuizOpen && (
          <QuizModal
            isOpen={isQuizOpen}
            onClose={() => setIsQuizOpen(false)}
            activeSession={activeSession}
            sessions={sessions}
            onSelectSession={handleSelectSession}
            onOpenUpload={handleOpenUploadModal}
            onGenerateQuiz={handleGenerateQuiz}
            questions={quizQuestions}
            isLoading={isQuizLoading}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isCompareOpen && (
          <CompareModal
            isOpen={isCompareOpen}
            onClose={() => setIsCompareOpen(false)}
            activeSession={activeSession}
            sessions={sessions}
            onOpenUpload={handleOpenUploadModal}
            onStartComparison={handleStartComparison}
            isLoading={isCompareLoading}
            resultMarkdown={compareResult}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isViewerOpen && (
          <DocumentViewerModal
            isOpen={isViewerOpen}
            onClose={() => setIsViewerOpen(false)}
            document={viewerDoc}
            pageNumber={viewerPage}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isUrlModalOpen && (
          <UrlIngestModal
            isOpen={isUrlModalOpen}
            onClose={() => setIsUrlModalOpen(false)}
            onIngest={handleIngestUrl}
            isLoading={isUrlLoading}
          />
        )}
      </AnimatePresence>

      {/* Global Command Palette (Cmd+K / Ctrl+K) */}
      <AnimatePresence>
        {isCommandPaletteOpen && (
          <CommandPaletteModal
            isOpen={isCommandPaletteOpen}
            onClose={() => setIsCommandPaletteOpen(false)}
            sessions={sessions}
            onSelectSession={handleSelectSession}
            onNewChat={handleNewChat}
            onOpenQuiz={() => handleOpenQuiz()}
            onOpenCompare={() => setIsCompareOpen(true)}
            onOpenUrlIngest={() => setIsUrlModalOpen(true)}
            onOpenUpload={handleOpenUploadModal}
            onOpenMemory={() => setModal("memory")}
            onExport={handleExportChat}
            onOpenSettings={() => setModal("settings")}
            onOpenShare={hasSession ? () => setIsShareModalOpen(true) : undefined}
          />
        )}
      </AnimatePresence>

      {/* Share Modal */}
      <AnimatePresence>
        {isShareModalOpen && (
          <ShareModal
            isOpen={isShareModalOpen}
            onClose={() => setIsShareModalOpen(false)}
            session={activeSession}
            onSessionUpdated={(updated) => {
              if (activeSession) {
                const upd = { ...activeSession, ...updated };
                setActiveSession(upd);
                setSessions((prev) => prev.map((s) => (s.id === upd.id ? upd : s)));
              }
            }}
          />
        )}
      </AnimatePresence>

      {/* Multi-Toast Notification System */}
      <div
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          pointerEvents: "none",
        }}
      >
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 16, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 450, damping: 26 }}
              style={{
                pointerEvents: "auto",
                padding: "10px 16px",
                background: "#0C0C0E",
                border: t.type === "error"
                  ? "1px solid rgba(239, 68, 68, 0.45)"
                  : t.type === "success"
                  ? "1px solid rgba(34, 197, 94, 0.45)"
                  : "1px solid rgba(255, 255, 255, 0.25)",
                borderRadius: "var(--radius-md)",
                color: "#FFFFFF",
                fontSize: 12.5,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: 10,
                boxShadow: "0 12px 36px rgba(0, 0, 0, 0.9), 0 0 1px rgba(255, 255, 255, 0.15)",
                backdropFilter: "blur(20px)",
                maxWidth: 360,
              }}
            >
              {t.type === "error" ? (
                <span style={{ color: "#EF4444", fontSize: 14 }}>⚠️</span>
              ) : t.type === "success" ? (
                <CheckCircle2 size={15} color="#22C55E" />
              ) : (
                <CheckCircle2 size={15} color="#FFFFFF" />
              )}
              <span style={{ flex: 1, wordBreak: "break-word" }}>{t.message}</span>
              <button
                onClick={() => removeToast(t.id)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-muted-alt)",
                  cursor: "pointer",
                  marginLeft: 6,
                  padding: 2,
                  fontSize: 12,
                }}
              >
                ✕
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Full-Screen Drag & Drop Overlay */}
      <AnimatePresence>
        {isDraggingFile && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 9999,
              background: "rgba(0, 0, 0, 0.88)",
              backdropFilter: "blur(16px)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
              border: "2px dashed rgba(255, 255, 255, 0.4)",
              margin: 16,
              borderRadius: 24,
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: "rgba(255, 255, 255, 0.1)",
                border: "1px solid rgba(255, 255, 255, 0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 0 30px rgba(255, 255, 255, 0.2)",
              }}
            >
              <Upload size={28} color="#FFFFFF" />
            </div>
            <div style={{ textAlign: "center" }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: "#FFFFFF", marginBottom: 4 }}>
                Drop files to upload to DocMind
              </h3>
              <p style={{ fontSize: 12, color: "#A3A3A3" }}>
                PDF, DOCX, TXT, CSV, or Markdown files will be processed and indexed automatically
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* User Authentication & Profile Modal */}
      <AuthModal />
    </>
  );
}
