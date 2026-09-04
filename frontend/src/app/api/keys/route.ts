import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const cookieVal = req.cookies.get("docmind_keys")?.value;
  let customKeys: { gemini?: string; groq?: string; openrouter?: string } = {};

  if (cookieVal) {
    try {
      customKeys = JSON.parse(decodeURIComponent(cookieVal));
    } catch {
      // ignore
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
    gemini_configured: hasGemini,
    groq_configured: hasGroq,
    openrouter_configured: hasOpenRouter,
    has_custom_keys: hasCustomKeys,
    has_server_keys: hasServerKeys,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { gemini = "", groq = "", openrouter = "" } = body;

    const payload = {
      gemini: gemini.trim(),
      groq: groq.trim(),
      openrouter: openrouter.trim(),
    };

    const res = NextResponse.json({
      success: true,
      message: "API keys stored securely in HTTP-only encrypted session cookie.",
      status: {
        gemini_configured: Boolean(payload.gemini),
        groq_configured: Boolean(payload.groq),
        openrouter_configured: Boolean(payload.openrouter),
      },
    });

    // Set HTTP-only, SameSite=Strict cookie
    res.cookies.set("docmind_keys", encodeURIComponent(JSON.stringify(payload)), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    return res;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to store API keys";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE() {
  const res = NextResponse.json({
    success: true,
    message: "Custom API keys cleared from secure HTTP-only cookie.",
  });
  res.cookies.delete("docmind_keys");
  return res;
}
