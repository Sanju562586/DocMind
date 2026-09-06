"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { User } from "./types";

export interface DemoProfile {
  key: string;
  name: string;
  email: string;
  role: string;
  avatar: string;
  description: string;
}

export const DEMO_PROFILES: DemoProfile[] = [
  {
    key: "alex",
    name: "Alex Rivera",
    email: "alex.rivera@docmind.io",
    role: "AI & ML Researcher",
    avatar: "🧠",
    description: "Deep research, comparative analysis & paper summarization workspace.",
  },
  {
    key: "sophia",
    name: "Sophia Chen",
    email: "sophia.chen@docmind.io",
    role: "Student & Analyst",
    avatar: "🎓",
    description: "Course notes, exam revision, flashcards & interactive quizzes.",
  },
  {
    key: "marcus",
    name: "Marcus Vance",
    email: "marcus.vance@docmind.io",
    role: "Executive Lead",
    avatar: "💼",
    description: "Executive summaries, legal contracts, reports & financial data.",
  },
];

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isAuthModalOpen: boolean;
  openAuthModal: () => void;
  closeAuthModal: () => void;
  loginDemo: (profileKey: string) => void;
  loginWithCredentials: (email: string, name: string) => void;
  loginWithOAuth: (provider: "google" | "github") => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function emailToUserId(email: string): string {
  const clean = email.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 32);
  return `user_${clean}`;
}

function setCookie(name: string, value: string, days = 30) {
  if (typeof document === "undefined") return;
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

function deleteCookie(name: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax`;
}

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    const val = parts.pop()?.split(";").shift();
    return val ? decodeURIComponent(val) : null;
  }
  return null;
}

function saveUserStorage(user: User) {
  if (typeof window === "undefined") return;
  const userJson = JSON.stringify(user);
  setCookie("docmind_user", userJson);
  try {
    localStorage.setItem("docmind_user", userJson);
  } catch {
    // ignore localStorage exceptions
  }
}

function clearUserStorage() {
  if (typeof window === "undefined") return;
  deleteCookie("docmind_user");
  deleteCookie("docmind_session");
  try {
    localStorage.removeItem("docmind_user");
    localStorage.removeItem("docmind_session");
  } catch {
    // ignore
  }
}

function loadSavedUser(): User | null {
  if (typeof window === "undefined") return null;
  // 1. Try cookie
  try {
    const savedCookie = getCookie("docmind_user");
    if (savedCookie) {
      const parsed = JSON.parse(savedCookie);
      if (parsed && parsed.id) return parsed;
    }
  } catch {
    // ignore
  }
  // 2. Try localStorage fallback
  try {
    const ls = localStorage.getItem("docmind_user");
    if (ls) {
      const parsed = JSON.parse(ls);
      if (parsed && parsed.id) return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // Initialize user from cookie or localStorage or default demo profile
  useEffect(() => {
    const saved = loadSavedUser();
    if (saved) {
      setUser(saved);
      saveUserStorage(saved);
      return;
    }

    // Default to Alex Rivera demo account for immediate interactive experience
    const defaultProfile = DEMO_PROFILES[0];
    const defaultUser: User = {
      id: emailToUserId(defaultProfile.email),
      name: defaultProfile.name,
      email: defaultProfile.email,
      role: defaultProfile.role,
      image: defaultProfile.avatar,
      isDemo: true,
    };
    setUser(defaultUser);
    saveUserStorage(defaultUser);
  }, []);

  const loginDemo = useCallback((profileKey: string) => {
    const profile = DEMO_PROFILES.find((p) => p.key === profileKey) || DEMO_PROFILES[0];
    const demoUser: User = {
      id: emailToUserId(profile.email),
      name: profile.name,
      email: profile.email,
      role: profile.role,
      image: profile.avatar,
      isDemo: true,
    };
    setUser(demoUser);
    saveUserStorage(demoUser);
    setIsAuthModalOpen(false);
  }, []);

  const loginWithCredentials = useCallback((email: string, name: string) => {
    const cleanEmail = email.trim();
    const cleanName = name.trim() || cleanEmail.split("@")[0] || "User";
    const newUser: User = {
      id: emailToUserId(cleanEmail),
      name: cleanName,
      email: cleanEmail,
      role: "Member",
      image: "👤",
      isDemo: false,
    };
    setUser(newUser);
    saveUserStorage(newUser);
    setIsAuthModalOpen(false);
  }, []);

  const loginWithOAuth = useCallback(async (provider: "google" | "github") => {
    setIsAuthModalOpen(false);
    if (typeof window !== "undefined") {
      window.location.href = `/api/auth/signin/${provider}`;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/signout", { method: "POST" });
    } catch {
      // ignore
    }
    clearUserStorage();
    // Switch to anonymous guest
    const guestUser: User = {
      id: `guest_${Date.now().toString(36)}`,
      name: "Guest User",
      email: "guest@docmind.local",
      role: "Guest",
      image: "👤",
      provider: "guest",
      isDemo: true,
    };
    setUser(guestUser);
    saveUserStorage(guestUser);
  }, []);

  const openAuthModal = useCallback(() => setIsAuthModalOpen(true), []);
  const closeAuthModal = useCallback(() => setIsAuthModalOpen(false), []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: Boolean(user && !user.email.includes("guest@")),
        isAuthModalOpen,
        openAuthModal,
        closeAuthModal,
        loginDemo,
        loginWithCredentials,
        loginWithOAuth,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
