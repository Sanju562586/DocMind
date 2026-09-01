"use client";

import React, { useState } from "react";
import { MemoryItem } from "@/lib/types";

interface MemoryInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  memories: MemoryItem[];
  onDeleteMemory: (memoryId: string) => Promise<void>;
  onClearAll: () => Promise<void>;
  isLoading: boolean;
}

export function MemoryInspectorModal({
  isOpen,
  onClose,
  memories,
  onDeleteMemory,
  onClearAll,
  isLoading,
}: MemoryInspectorModalProps) {
  const [searchTerm, setSearchTerm] = useState("");

  if (!isOpen) return null;

  const filtered = memories.filter(
    (m) =>
      m.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.session_title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-3xl w-full p-6 shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-100">Global Cross-Session Memory Inspector</h3>
              <p className="text-xs text-slate-400">Manage facts and context DocMind remembers across chats</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Toolbar */}
        <div className="py-4 flex items-center justify-between gap-3 border-b border-slate-800">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search saved cross-session memories..."
            className="flex-1 bg-slate-800 border border-slate-700/80 rounded-lg px-3.5 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
          />
          <button
            onClick={onClearAll}
            disabled={memories.length === 0}
            className="px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs hover:bg-rose-500/20 disabled:opacity-40 transition-colors"
          >
            Clear All Memory
          </button>
        </div>

        {/* Content list */}
        <div className="py-4 flex-1 overflow-y-auto space-y-3">
          {isLoading ? (
            <div className="text-center py-10 text-slate-400 text-sm">Loading memories...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10 text-slate-500 text-xs">
              {memories.length === 0 ? "No global memories saved yet." : "No memories matching search query."}
            </div>
          ) : (
            filtered.map((item, idx) => (
              <div
                key={item.id || idx}
                className="p-3.5 bg-slate-800/40 border border-slate-700/40 rounded-xl flex items-start justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] font-semibold">
                      {item.session_title || "Past Session"}
                    </span>
                    <span className="text-[10px] text-slate-500 uppercase font-bold">{item.role}</span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">{item.content}</p>
                </div>
                {item.id && (
                  <button
                    onClick={() => onDeleteMemory(item.id!)}
                    className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-700 transition-colors"
                    title="Delete memory item"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
