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

async function handleProxy(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const resolvedParams = await params;
  const path = resolvedParams?.path;
  const targetPath = path ? path.join("/") : "";
  const targetUrl = new URL(`${BACKEND_URL}/api/${targetPath}`);

  // Forward search query params
  req.nextUrl.searchParams.forEach((val, key) => {
    targetUrl.searchParams.set(key, val);
  });

  // Forward incoming headers (except host, content-length, connection)
  const headers = new Headers();
  req.headers.forEach((val, key) => {
    const lower = key.toLowerCase();
    if (
      lower !== "host" &&
      lower !== "content-length" &&
      lower !== "connection"
    ) {
      headers.set(key, val);
    }
  });

  // 1. Inject Authenticated User Identity from signed JWT or verified cookie
  const sessionToken = req.cookies.get("docmind_session")?.value;
  if (sessionToken) {
    headers.set("Authorization", `Bearer ${sessionToken}`);
  }

  let userId = "";
  const userCookie = req.cookies.get("docmind_user")?.value;
  if (userCookie) {
    const user = safeParseJson(userCookie);
    if (user?.id) {
      userId = user.id;
      headers.set("X-User-Id", user.id);
    }
    if (user?.email) headers.set("X-User-Email", user.email);
    if (user?.name) headers.set("X-User-Name", user.name);
  }

  // 2. Inject Secure HTTP-only API Keys server-to-server (User-scoped cookie first)
  const userKeysCookie = userId && userId !== "default_user" ? req.cookies.get(`docmind_keys_${userId}`)?.value : null;
  const keysCookie = userKeysCookie || req.cookies.get("docmind_keys")?.value;
  if (keysCookie) {
    const parsed = safeParseJson(keysCookie);
    const keys = (userId && parsed && parsed[userId]) ? parsed[userId] : parsed;
    if (keys?.gemini && (!headers.get("X-Gemini-Key") || !headers.get("X-Gemini-Key")?.trim())) {
      headers.set("X-Gemini-Key", keys.gemini);
    }
    if (keys?.groq && (!headers.get("X-Groq-Key") || !headers.get("X-Groq-Key")?.trim())) {
      headers.set("X-Groq-Key", keys.groq);
    }
    if (keys?.openrouter && (!headers.get("X-OpenRouter-Key") || !headers.get("X-OpenRouter-Key")?.trim())) {
      headers.set("X-OpenRouter-Key", keys.openrouter);
    }
  }

  const method = req.method;
  const isBodyAllowed = method !== "GET" && method !== "HEAD";
  const body = isBodyAllowed ? req.body : undefined;

  try {
    const res = await fetch(targetUrl.toString(), {
      method,
      headers,
      body,
      // @ts-expect-error - duplex is required for streaming request bodies in Node fetch
      duplex: isBodyAllowed && body ? "half" : undefined,
      cache: "no-store",
    });

    const isSSE = res.headers.get("content-type")?.includes("text/event-stream");

    const responseHeaders = new Headers();
    // Headers that must not be forwarded because Node.js fetch decodes the response body,
    // or because they are hop-by-hop transport headers.
    const strippedHeaders = new Set([
      "content-encoding",
      "content-length",
      "transfer-encoding",
      "connection",
      "keep-alive",
    ]);

    res.headers.forEach((val, key) => {
      const lower = key.toLowerCase();
      if (strippedHeaders.has(lower)) {
        return;
      }
      responseHeaders.set(key, val);
    });

    if (isSSE) {
      responseHeaders.set("Content-Type", "text/event-stream; charset=utf-8");
      responseHeaders.set("Cache-Control", "no-cache, no-transform");
      responseHeaders.set("Connection", "keep-alive");
      responseHeaders.set("X-Accel-Buffering", "no");
    }

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Proxy connection failed";
    return NextResponse.json(
      { detail: `Backend proxy error: ${errorMsg}. Please verify backend server is running.` },
      { status: 502 }
    );
  }
}

export const GET = handleProxy;
export const POST = handleProxy;
export const PATCH = handleProxy;
export const DELETE = handleProxy;
export const PUT = handleProxy;
export const HEAD = handleProxy;
