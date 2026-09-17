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

export interface AuthErrorDetails {
  error: string;
  description?: string;
  redirectUri?: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isAuthModalOpen: boolean;
  authNotification: { type: "success" | "error" | "info"; message: string } | null;
  clearAuthNotification: () => void;
  authErrorDetails: AuthErrorDetails | null;
  clearAuthErrorDetails: () => void;
  googleClientId: string | null;
  googleConfigured: boolean;
  openAuthModal: () => void;
  closeAuthModal: () => void;
  loginDemo: (profileKey: string) => void;
  loginWithCredentials: (email: string, name: string) => void;
  loginWithOAuth: (provider: "google" | "github", isDemo?: boolean) => Promise<void>;
  loginWithGoogleCredential: (credential: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function emailToUserId(email: string): string {
  const clean = email.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 32);
  return `user_${clean}`;
}

function setCookie(name: string, value: string, days = 365) {
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
  const cookies = document.cookie.split(";");
  for (let c of cookies) {
    c = c.trim();
    if (c.startsWith(`${name}=`)) {
      const val = c.substring(name.length + 1);
      try {
        return decodeURIComponent(val);
      } catch {
        return val;
      }
    }
  }
  return null;
}

function saveUserStorage(user: User) {
  if (typeof window === "undefined") return;
  const userJson = JSON.stringify(user);
  setCookie("docmind_user", userJson, 365);
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

function parseUser(jsonStr: string | null): User | null {
  if (!jsonStr) return null;
  try {
    const raw = jsonStr.trim();
    const str = raw.startsWith("{") ? raw : decodeURIComponent(raw);
    const parsed = JSON.parse(str);
    if (parsed && parsed.id) return parsed;
  } catch {
    // ignore
  }
  return null;
}

function loadSavedUser(): User | null {
  if (typeof window === "undefined") return null;
  // 1. Authoritative check: cookie docmind_user (set directly by server on OAuth redirect)
  const cookieUser = parseUser(getCookie("docmind_user"));

  // 2. Check localStorage
  let lsUser: User | null = null;
  try {
    lsUser = parseUser(localStorage.getItem("docmind_user"));
  } catch {
    // ignore
  }

  // If cookie user is a real authenticated login (!isDemo), it ALWAYS overrides demo localStorage
  if (cookieUser && !cookieUser.isDemo) {
    return cookieUser;
  }
  // If cookie user has a non-credentials provider (google, github), it ALWAYS overrides generic guest
  if (cookieUser && (cookieUser.provider === "google" || cookieUser.provider === "github")) {
    return cookieUser;
  }
  // Otherwise, use localStorage user if present, or fallback to cookie user
  if (lsUser) {
    return lsUser;
  }
  return cookieUser;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authNotification, setAuthNotification] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const [authErrorDetails, setAuthErrorDetails] = useState<AuthErrorDetails | null>(null);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const [googleConfigured, setGoogleConfigured] = useState(false);

  const clearAuthNotification = useCallback(() => setAuthNotification(null), []);
  const clearAuthErrorDetails = useCallback(() => setAuthErrorDetails(null), []);

  // Initialize user from cookie or localStorage, hydrate from server, and handle OAuth callbacks
  useEffect(() => {
    // 1. Synchronously load saved user
    const saved = loadSavedUser();
    if (saved) {
      setUser(saved);
      saveUserStorage(saved);
    } else {
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
    }

    // 2. Hydrate from server session endpoint
    fetch("/api/auth/session")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.user?.id) {
          setUser(data.user);
          saveUserStorage(data.user);
        }
      })
      .catch(() => {});

    // 3. Query providers to detect Google OAuth configuration & client ID
    fetch("/api/auth/providers")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.google) {
          setGoogleConfigured(Boolean(data.google.configured));
          if (data.google.clientId) {
            setGoogleClientId(data.google.clientId);
          }
        }
      })
      .catch(() => {});

    // 4. Inspect URL for OAuth redirect query parameters
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      const authParam = url.searchParams.get("auth");
      const errorParam = url.searchParams.get("error");
      const descParam = url.searchParams.get("description") || url.searchParams.get("details");
      const redirectUriParam = url.searchParams.get("redirect_uri");

      if (authParam) {
        // Read fresh user from cookie
        const freshUser = parseUser(getCookie("docmind_user"));
        if (freshUser) {
          setUser(freshUser);
          saveUserStorage(freshUser);
        }
        if (authParam.includes("google")) {
          setAuthNotification({
            type: "success",
            message: `Connected Google account as ${freshUser?.name || "Google User"} (${freshUser?.email || ""})!`,
          });
        } else if (authParam.includes("github")) {
          setAuthNotification({
            type: "success",
            message: `Connected GitHub account as ${freshUser?.name || "GitHub User"}!`,
          });
        }
        url.searchParams.delete("auth");
        window.history.replaceState({}, "", url.pathname + (url.search ? `?${url.searchParams.toString()}` : ""));
      }

      if (errorParam) {
        let msg = "Sign-in encountered an issue.";
        if (errorParam.includes("access_denied")) {
          msg = "Google sign-in was cancelled by the user.";
        } else if (errorParam.includes("redirect_uri_mismatch")) {
          msg = "Google Cloud Console redirect URI mismatch. Please verify Authorized Redirect URIs in your Google Cloud project.";
        } else if (errorParam.includes("google")) {
          msg = `Google sign-in could not be completed (${descParam || errorParam}).`;
        } else if (errorParam.includes("github")) {
          msg = `GitHub sign-in was not completed (${descParam || errorParam}).`;
        }

        setAuthNotification({
          type: "error",
          message: msg,
        });

        if (errorParam.includes("google") || errorParam.includes("redirect_uri")) {
          setAuthErrorDetails({
            error: errorParam,
            description: descParam || undefined,
            redirectUri: redirectUriParam || `${window.location.origin}/api/auth/callback/google`,
          });
          // Auto-open modal so user sees diagnostic guide and can fix or demo
          setIsAuthModalOpen(true);
        }

        url.searchParams.delete("error");
        if (descParam) {
          url.searchParams.delete("description");
          url.searchParams.delete("details");
        }
        if (redirectUriParam) {
          url.searchParams.delete("redirect_uri");
        }
        window.history.replaceState({}, "", url.pathname + (url.search ? `?${url.searchParams.toString()}` : ""));
      }
    }
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
    // Mint session JWT cookie on server
    try {
      fetch("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: demoUser.id,
          email: demoUser.email,
          name: demoUser.name,
          image: demoUser.image,
          provider: "credentials",
          isDemo: true,
        }),
      }).catch(() => {});
    } catch {}
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
    // Mint session JWT cookie on server
    try {
      fetch("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
          image: newUser.image,
          provider: "credentials",
          isDemo: false,
        }),
      }).catch(() => {});
    } catch {}
    setIsAuthModalOpen(false);
  }, []);

  const loginWithOAuth = useCallback(async (provider: "google" | "github", isDemo: boolean = false) => {
    setIsAuthModalOpen(false);
    if (typeof window !== "undefined") {
      window.location.href = `/api/auth/signin/${provider}${isDemo ? "?demo=true" : ""}`;
    }
  }, []);

  const loginWithGoogleCredential = useCallback(async (credential: string): Promise<boolean> => {
    try {
      const res = await fetch("/api/auth/callback/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential, provider: "google" }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.details || data.error || "Google credential verification failed");
      }

      const data = await res.json();
      if (data?.user) {
        setUser(data.user);
        saveUserStorage(data.user);
        setAuthNotification({
          type: "success",
          message: `Signed in with Google as ${data.user.name} (${data.user.email})!`,
        });
        setIsAuthModalOpen(false);
        return true;
      }
      return false;
    } catch (err: any) {
      console.error("Google credential sign-in error:", err);
      setAuthNotification({
        type: "error",
        message: err?.message || "Failed to authenticate with Google credential.",
      });
      return false;
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
        isAuthenticated: Boolean(user && !user.isDemo && !user.email.includes("guest@")),
        isAuthModalOpen,
        authNotification,
        clearAuthNotification,
        authErrorDetails,
        clearAuthErrorDetails,
        googleClientId,
        googleConfigured,
        openAuthModal,
        closeAuthModal,
        loginDemo,
        loginWithCredentials,
        loginWithOAuth,
        loginWithGoogleCredential,
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
