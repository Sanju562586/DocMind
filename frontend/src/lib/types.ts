// Types shared across the frontend

export interface User {
  id: string;
  name: string;
  email: string;
  image?: string;
  role?: string;
  provider?: string;
  isDemo?: boolean;
}

export interface KeyStatus {
  user_id?: string;
  gemini_configured: boolean;
  groq_configured: boolean;
  openrouter_configured: boolean;
  has_custom_keys: boolean;
  has_server_keys: boolean;
  keys?: ApiKeys;
}

export interface Document {
  doc_id: string;
  session_id: string;
  filename: string;
  chunk_count: number;
  char_count: number;
  word_count?: number;
  page_count?: number;
  file_type?: string;
  status?: "processing" | "ready" | "error";
  message?: string;
  error_message?: string;
  created_at?: string;
}

export interface Session {
  id: string;
  user_id?: string;
  title: string;
  created_at: string;
  updated_at: string;
  documents: Document[];
  message_count: number;
  is_shared?: boolean;
  share_token?: string;
  shared_at?: string;
}

export interface SharedDocument {
  id: string;
  filename: string;
  file_type: string;
  word_count?: number;
  chunk_count?: number;
}

export interface SharedMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  sources?: Source[];
  created_at: string;
}

export interface SharedSession {
  session_id: string;
  title: string;
  created_at: string;
  shared_at: string;
  documents: SharedDocument[];
  messages: SharedMessage[];
  is_shared: boolean;
}

export interface MemoryItem {
  id?: string;
  session_id: string;
  session_title: string;
  role: string;
  content: string;
  created_at?: string;
  score?: number;
}

export interface SystemStats {
  status: string;
  neural_models_ready: boolean;
  total_sessions: number;
  total_documents: number;
  total_messages: number;
  total_memory_items: number;
  total_words_indexed: number;
  total_chunks_indexed: number;
  user_id?: string;
}

export interface Source {
  child_text: string;
  section: string;
  doc_id?: string;
  title?: string;
  page_number?: number;
  rerank_score: number;
  bm25_score: number;
  dense_score: number;
  score?: number;
  snippet?: string;
}

export interface Message {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  sources?: Source[];
  memory_recalled?: MemoryItem[];
}

export interface ApiKeys {
  gemini: string;
  groq: string;
  openrouter: string;
}

export type UploadStatus =
  | "idle"
  | "uploading"
  | "parsing"
  | "chunking"
  | "indexing"
  | "done"
  | "error";

export interface HealthStatus {
  status: string;
  service: string;
  version: string;
  neural_models_ready: boolean;
  rate_limiter?: string;
  storage_backend?: string;
  task_queue?: {
    max_workers: number;
    queue_size: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    total_tasks: number;
  };
  providers_available?: string[];
}

