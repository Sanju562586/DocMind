// Types shared across the frontend

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
  created_at?: string;
}

export interface Session {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  documents: Document[];
  message_count: number;
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
