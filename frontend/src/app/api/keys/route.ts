import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_URL = (
  process.env.BACKEND_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://127.0.0.1:8000"
)
  .replace(/\/+$/, "")
  .replace(/\/api$/, "");

function safeParseJson(str: string): any {
  try {
    return JSON.parse(str);
  } catch {
    try {
      return JSON.parse(decodeURIComponent(str));
    } catch {
      return null;
    }
  }
}

function getUserIdFromRequest(req: NextRequest): string {
  const userHeader = req.headers.get("X-User-Id");
  if (userHeader) return userHeader.trim();

  const userCookie = req.cookies.get("docmind_user")?.value;
  if (userCookie) {
    const user = safeParseJson(userCookie);
    if (user?.id) return user.id.trim();
  }
  return "default_user";
}

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req);

  // 1. Check user-scoped cookie first, then fallback to global docmind_keys
  const userScopedCookie = userId && userId !== "default_user" ? req.cookies.get(`docmind_keys_${userId}`)?.value : null;
  const globalCookie = req.cookies.get("docmind_keys")?.value;
  const cookieVal = userScopedCookie || globalCookie;

  let customKeys: { gemini?: string; groq?: string; openrouter?: string } = {};

  if (cookieVal) {
    const parsed = safeParseJson(cookieVal);
    if (parsed) {
      customKeys = (userId && parsed[userId]) ? parsed[userId] : parsed;
    }
  }

  // 2. If cookie keys are empty, try fetching from backend user store
  if (!customKeys.gemini && !customKeys.groq && !customKeys.openrouter && userId) {
    try {
      const backendRes = await fetch(`${BACKEND_URL}/api/user/keys`, {
        headers: { "X-User-Id": userId },
        cache: "no-store",
      });
      if (backendRes.ok) {
        const backendData = await backendRes.json();
        if (backendData.keys) {
          customKeys = {
            gemini: backendData.keys.gemini || "",
            groq: backendData.keys.groq || "",
            openrouter: backendData.keys.openrouter || "",
          };
        }
      }
    } catch {
      // ignore backend connection failure
    }
  }

  // Check if backend environment has pre-configured keys
  const serverGemini = Boolean(process.env.GEMINI_API_KEY);
  const serverGroq = Boolean(process.env.GROQ_API_KEY);
  const serverOpenRouter = Boolean(process.env.OPENROUTER_API_KEY);

  const hasGemini = Boolean(customKeys.gemini?.trim() || serverGemini);
  const hasGroq = Boolean(customKeys.groq?.trim() || serverGroq);
  const hasOpenRouter = Boolean(customKeys.openrouter?.trim() || serverOpenRouter);

  const hasCustomKeys = Boolean(
    customKeys.gemini?.trim() || customKeys.groq?.trim() || customKeys.openrouter?.trim()
  );
  const hasServerKeys = Boolean(serverGemini || serverGroq || serverOpenRouter);

  return NextResponse.json({
    user_id: userId,
    gemini_configured: hasGemini,
    groq_configured: hasGroq,
    openrouter_configured: hasOpenRouter,
    has_custom_keys: hasCustomKeys,
    has_server_keys: hasServerKeys,
    keys: {
      gemini: customKeys.gemini || "",
      groq: customKeys.groq || "",
      openrouter: customKeys.openrouter || "",
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userId = getUserIdFromRequest(req);
    const { gemini = "", groq = "", openrouter = "" } = body;

    const payload = {
      gemini: String(gemini).trim(),
      groq: String(groq).trim(),
      openrouter: String(openrouter).trim(),
    };

    // Forward to backend database to persist for user account
    if (userId) {
      try {
        await fetch(`${BACKEND_URL}/api/user/keys`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-User-Id": userId,
          },
          body: JSON.stringify(payload),
        });
      } catch (backendErr) {
        console.warn("Backend user key persist notice:", backendErr);
      }
    }

    const res = NextResponse.json({
      success: true,
      user_id: userId,
      message: "API keys stored securely with 1-year persistence for this profile.",
      status: {
        gemini_configured: Boolean(payload.gemini),
        groq_configured: Boolean(payload.groq),
        openrouter_configured: Boolean(payload.openrouter),
      },
      keys: payload,
    });

    const cookiePayloadStr = encodeURIComponent(JSON.stringify(payload));

    // 1. Set global keys cookie with 1-year persistence (365 days)
    res.cookies.set("docmind_keys", cookiePayloadStr, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 365 * 86400,
    });

    // 2. Set user-scoped keys cookie with 1-year persistence (365 days)
    if (userId && userId !== "default_user") {
      res.cookies.set(`docmind_keys_${userId}`, cookiePayloadStr, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 365 * 86400,
      });
    }

    return res;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to store API keys";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const userId = getUserIdFromRequest(req);

  // Clear in backend database as well
  if (userId) {
    try {
      await fetch(`${BACKEND_URL}/api/user/keys`, {
        method: "DELETE",
        headers: { "X-User-Id": userId },
      });
    } catch {
      // ignore
    }
  }

  const res = NextResponse.json({
    success: true,
    user_id: userId,
    message: "Custom API keys cleared.",
  });

  res.cookies.delete("docmind_keys");
  if (userId && userId !== "default_user") {
    res.cookies.delete(`docmind_keys_${userId}`);
  }
  return res;
}

