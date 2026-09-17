import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { signJwt, verifyJwt } from "@/lib/auth-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function getBaseUrl(req: NextRequest): string {
  // If explicitly configured in environment, prefer it
  if (process.env.NEXTAUTH_URL && !process.env.NEXTAUTH_URL.includes("localhost")) {
    return process.env.NEXTAUTH_URL.replace(/\/+$/, "");
  }
  if (process.env.NEXT_PUBLIC_APP_URL && !process.env.NEXT_PUBLIC_APP_URL.includes("localhost")) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
  }

  // Derive from incoming request headers
  const forwardedHost = req.headers.get("x-forwarded-host");
  const hostHeader = req.headers.get("host");
  const rawHost = (forwardedHost || hostHeader || "localhost:3000").split(",")[0].trim();

  const forwardedProto = req.headers.get("x-forwarded-proto");
  const rawProto = (forwardedProto || (rawHost.includes("localhost") || rawHost.includes("127.0.0.1") ? "http" : "https"))
    .split(",")[0]
    .trim();

  return `${rawProto}://${rawHost}`;
}

function isRequestSecure(req: NextRequest): boolean {
  const proto = req.headers.get("x-forwarded-proto") || req.nextUrl.protocol;
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  if (host.includes("localhost") || host.includes("127.0.0.1")) {
    return false;
  }
  return proto.includes("https") || process.env.NODE_ENV === "production";
}

function sanitizeReturnUrl(urlStr: string | null, baseUrl: string): string {
  if (!urlStr) return "/";
  try {
    const base = new URL(baseUrl);
    const parsed = new URL(urlStr, baseUrl);
    if (parsed.origin === base.origin) {
      return parsed.pathname + parsed.search;
    }
  } catch {}
  if (urlStr.startsWith("/") && !urlStr.startsWith("//")) {
    return urlStr;
  }
  return "/";
}

interface StateData {
  nonce: string;
  returnTo: string;
  redirectUri: string;
  provider: string;
  ts: number;
}

function createOAuthState(returnTo: string, redirectUri: string, provider: string): { nonce: string; cookieValue: string } {
  const nonce = crypto.randomBytes(24).toString("hex");
  const payload: StateData = {
    nonce,
    returnTo,
    redirectUri,
    provider,
    ts: Date.now(),
  };
  const cookieValue = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { nonce, cookieValue };
}

function parseOAuthState(cookieValue?: string): StateData | null {
  if (!cookieValue) return null;
  try {
    const jsonStr = Buffer.from(cookieValue, "base64url").toString("utf8");
    const data = JSON.parse(jsonStr);
    // Expire state after 15 minutes
    if (data.ts && Date.now() - data.ts > 15 * 60 * 1000) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ nextauth: string[] }> }
) {
  const resolvedParams = await params;
  const parts = resolvedParams?.nextauth || [];
  const action = parts[0] || "";
  const subAction = parts[1] || "";
  const baseUrl = getBaseUrl(req);
  const secureCookie = isRequestSecure(req);

  // 1. Session check
  if (action === "session") {
    const sessionCookie = req.cookies.get("docmind_session")?.value;
    if (sessionCookie) {
      const verified = verifyJwt(sessionCookie);
      if (verified) {
        const user = {
          id: verified.sub,
          email: verified.email,
          name: verified.name,
          role: verified.role || "member",
          image: verified.image || "👤",
          provider: verified.provider || "credentials",
          emailVerified: Boolean(verified.emailVerified),
          isDemo: Boolean(verified.isDemo),
        };
        return NextResponse.json({ user, expires: new Date(Date.now() + 864e5 * 30).toISOString() });
      }
    }

    const userCookie = req.cookies.get("docmind_user")?.value;
    if (userCookie) {
      const user = safeParseJson(userCookie);
      if (user) {
        return NextResponse.json({ user, expires: new Date(Date.now() + 864e5 * 30).toISOString() });
      }
    }
    return NextResponse.json(null);
  }

  // 2. Providers list (used by frontend to configure Google GIS and OAuth buttons)
  if (action === "providers") {
    const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "";
    const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
    const githubClientId = process.env.GITHUB_CLIENT_ID || "";
    const githubClientSecret = process.env.GITHUB_CLIENT_SECRET || "";

    const googleConfigured = Boolean(
      googleClientId.trim() &&
      googleClientSecret.trim() &&
      !googleClientId.startsWith("your_")
    );

    const githubConfigured = Boolean(
      githubClientId.trim() &&
      githubClientSecret.trim() &&
      !githubClientId.startsWith("your_")
    );

    const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI || `${baseUrl}/api/auth/callback/google`;
    const githubRedirectUri = `${baseUrl}/api/auth/callback/github`;

    return NextResponse.json({
      google: {
        id: "google",
        name: "Google",
        type: "oauth",
        configured: googleConfigured,
        clientId: googleConfigured ? googleClientId.trim() : "",
        redirectUri: googleRedirectUri,
        origin: baseUrl,
      },
      github: {
        id: "github",
        name: "GitHub",
        type: "oauth",
        configured: githubConfigured,
        clientId: githubConfigured ? githubClientId.trim() : "",
        redirectUri: githubRedirectUri,
      },
      credentials: {
        id: "credentials",
        name: "Email Credentials",
        type: "credentials",
        configured: true,
      },
    });
  }

  // 3. CSRF token
  if (action === "csrf") {
    return NextResponse.json({ csrfToken: crypto.randomBytes(16).toString("hex") });
  }

  // 4. OAuth Initiate: /api/auth/signin/google
  if (action === "signin" && subAction === "google") {
    const isDemo = req.nextUrl.searchParams.get("demo") === "true";
    const clientId = (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "").trim();
    const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || "").trim();
    const rawReferer = req.headers.get("referer");
    const returnTo = sanitizeReturnUrl(rawReferer, baseUrl);

    // Fallback: If demo requested or credentials are not yet configured in env
    if (isDemo || !clientId || !clientSecret || clientId.startsWith("your_")) {
      const user = {
        id: "google_118234567890123456789",
        email: "google.user@gmail.com",
        name: "Google User",
        role: "Google Verified Member",
        image: "🌐",
        provider: "google",
        isDemo: true,
      };
      const token = signJwt({
        sub: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        image: user.image,
        provider: "google",
        isDemo: true,
      });

      const redirectTarget = `${baseUrl}${returnTo.startsWith("/") ? returnTo : `/${returnTo}`}`;
      const url = new URL(redirectTarget, baseUrl);
      url.searchParams.set("auth", "google_connected");

      const res = NextResponse.redirect(url.toString());
      res.cookies.set("docmind_session", token, {
        path: "/",
        httpOnly: true,
        secure: secureCookie,
        sameSite: "lax",
        maxAge: 365 * 86400,
      });
      res.cookies.set("docmind_user", encodeURIComponent(JSON.stringify(user)), {
        path: "/",
        httpOnly: false,
        sameSite: "lax",
        maxAge: 365 * 86400,
      });
      return res;
    }

    // Official Google OAuth 2.0 Authorization Code Flow
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${baseUrl}/api/auth/callback/google`;
    const { nonce, cookieValue } = createOAuthState(returnTo, redirectUri, "google");

    const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    googleAuthUrl.searchParams.set("client_id", clientId);
    googleAuthUrl.searchParams.set("redirect_uri", redirectUri);
    googleAuthUrl.searchParams.set("response_type", "code");
    googleAuthUrl.searchParams.set("scope", "openid email profile");
    googleAuthUrl.searchParams.set("access_type", "offline");
    googleAuthUrl.searchParams.set("prompt", "select_account");
    googleAuthUrl.searchParams.set("state", nonce);

    const res = NextResponse.redirect(googleAuthUrl.toString());
    res.cookies.set("docmind_oauth_state", cookieValue, {
      path: "/",
      httpOnly: true,
      secure: secureCookie,
      sameSite: "lax",
      maxAge: 15 * 60, // 15 minutes
    });
    return res;
  }

  // 5. OAuth Initiate: /api/auth/signin/github
  if (action === "signin" && subAction === "github") {
    const isDemo = req.nextUrl.searchParams.get("demo") === "true";
    const clientId = (process.env.GITHUB_CLIENT_ID || "").trim();
    const clientSecret = (process.env.GITHUB_CLIENT_SECRET || "").trim();
    const rawReferer = req.headers.get("referer");
    const returnTo = sanitizeReturnUrl(rawReferer, baseUrl);

    if (isDemo || !clientId || !clientSecret || clientId.startsWith("your_")) {
      const user = {
        id: "github_583231",
        email: "developer@github.com",
        name: "GitHub Developer",
        role: "GitHub Verified Member",
        image: "🐙",
        provider: "github",
        isDemo: true,
      };
      const token = signJwt({
        sub: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        image: user.image,
        provider: "github",
        isDemo: true,
      });

      const redirectTarget = `${baseUrl}${returnTo.startsWith("/") ? returnTo : `/${returnTo}`}`;
      const url = new URL(redirectTarget, baseUrl);
      url.searchParams.set("auth", "github_connected");

      const res = NextResponse.redirect(url.toString());
      res.cookies.set("docmind_session", token, {
        path: "/",
        httpOnly: true,
        secure: secureCookie,
        sameSite: "lax",
        maxAge: 365 * 86400,
      });
      res.cookies.set("docmind_user", encodeURIComponent(JSON.stringify(user)), {
        path: "/",
        httpOnly: false,
        sameSite: "lax",
        maxAge: 365 * 86400,
      });
      return res;
    }

    const redirectUri = `${baseUrl}/api/auth/callback/github`;
    const { nonce, cookieValue } = createOAuthState(returnTo, redirectUri, "github");

    const githubAuthUrl = new URL("https://github.com/login/oauth/authorize");
    githubAuthUrl.searchParams.set("client_id", clientId);
    githubAuthUrl.searchParams.set("redirect_uri", redirectUri);
    githubAuthUrl.searchParams.set("scope", "read:user user:email");
    githubAuthUrl.searchParams.set("state", nonce);

    const res = NextResponse.redirect(githubAuthUrl.toString());
    res.cookies.set("docmind_oauth_state", cookieValue, {
      path: "/",
      httpOnly: true,
      secure: secureCookie,
      sameSite: "lax",
      maxAge: 15 * 60,
    });
    return res;
  }

  // 6. OAuth Callback: /api/auth/callback/google
  if (action === "callback" && subAction === "google") {
    const code = req.nextUrl.searchParams.get("code");
    const oauthError = req.nextUrl.searchParams.get("error");
    const errorDesc = req.nextUrl.searchParams.get("error_description");
    const stateParam = req.nextUrl.searchParams.get("state");

    // Retrieve and validate OAuth state cookie
    const stateCookieVal = req.cookies.get("docmind_oauth_state")?.value;
    const stateData = parseOAuthState(stateCookieVal);

    const targetReturnTo = stateData?.returnTo || "/";
    const redirectUri = stateData?.redirectUri || process.env.GOOGLE_REDIRECT_URI || `${baseUrl}/api/auth/callback/google`;

    const redirectTarget = `${baseUrl}${targetReturnTo.startsWith("/") ? targetReturnTo : `/${targetReturnTo}`}`;
    const targetUrl = new URL(redirectTarget, baseUrl);

    // Handle Google OAuth errors (e.g. user cancelled or access denied)
    if (oauthError) {
      console.warn("Google OAuth callback error:", oauthError, errorDesc);
      targetUrl.searchParams.set("error", oauthError);
      if (errorDesc) targetUrl.searchParams.set("description", errorDesc);
      targetUrl.searchParams.set("redirect_uri", redirectUri);
      const res = NextResponse.redirect(targetUrl.toString());
      res.cookies.delete("docmind_oauth_state");
      return res;
    }

    // CSRF State validation
    if (!stateData || !stateParam || stateData.nonce !== stateParam) {
      console.warn("OAuth state validation mismatch or expired state cookie.");
      targetUrl.searchParams.set("error", "oauth_state_invalid");
      targetUrl.searchParams.set("description", "Session verification expired. Please try signing in again.");
      const res = NextResponse.redirect(targetUrl.toString());
      res.cookies.delete("docmind_oauth_state");
      return res;
    }

    const clientId = (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "").trim();
    const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || "").trim();

    if (code && clientId && clientSecret) {
      try {
        // Exchange authorization code for tokens
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
          }).toString(),
        });

        if (!tokenRes.ok) {
          const errBody = await tokenRes.text();
          console.error("Google OAuth token exchange failed:", tokenRes.status, errBody);
          targetUrl.searchParams.set("error", "google_token_exchange_failed");
          targetUrl.searchParams.set("description", errBody.slice(0, 140));
          targetUrl.searchParams.set("redirect_uri", redirectUri);
          const res = NextResponse.redirect(targetUrl.toString());
          res.cookies.delete("docmind_oauth_state");
          return res;
        }

        const tokenData = await tokenRes.json();
        let profile: any = null;

        // Fetch user profile from OpenID Connect userinfo endpoint
        if (tokenData.access_token) {
          try {
            const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
              headers: { Authorization: `Bearer ${tokenData.access_token}` },
            });
            if (userRes.ok) {
              profile = await userRes.json();
            }
          } catch (fetchErr) {
            console.warn("Error calling Google userinfo endpoint:", fetchErr);
          }
        }

        // Fallback: Decode Google id_token JWT payload if userinfo endpoint did not return
        if (!profile && tokenData.id_token) {
          try {
            const segments = tokenData.id_token.split(".");
            if (segments.length === 3) {
              const b64 = segments[1].replace(/-/g, "+").replace(/_/g, "/");
              profile = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
            }
          } catch (jwtErr) {
            console.warn("Error decoding Google id_token fallback:", jwtErr);
          }
        }

        if (profile) {
          const googleId = profile.sub || profile.id;
          const email = (profile.email || "").trim().toLowerCase();
          const name = (profile.name || profile.given_name || (email ? email.split("@")[0] : "Google User")).trim();
          const image = profile.picture || "🌐";
          const userId = googleId ? `google_${googleId}` : `google_${email.replace(/[^a-z0-9]/gi, "_")}`;

          const user = {
            id: userId,
            email: email || `${userId}@docmind.local`,
            name,
            role: "Google Member",
            image,
            provider: "google",
            emailVerified: Boolean(profile.email_verified),
            isDemo: false,
          };

          const token = signJwt({
            sub: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            image: user.image,
            provider: "google",
            emailVerified: user.emailVerified,
            isDemo: false,
          });

          targetUrl.searchParams.set("auth", "google_success");
          const res = NextResponse.redirect(targetUrl.toString());

          res.cookies.set("docmind_session", token, {
            path: "/",
            httpOnly: true,
            secure: secureCookie,
            sameSite: "lax",
            maxAge: 365 * 86400,
          });
          res.cookies.set("docmind_user", encodeURIComponent(JSON.stringify(user)), {
            path: "/",
            httpOnly: false,
            sameSite: "lax",
            maxAge: 365 * 86400,
          });
          res.cookies.delete("docmind_oauth_state");
          return res;
        }
      } catch (exc) {
        console.error("Google OAuth callback exception:", exc);
      }
    }

    targetUrl.searchParams.set("error", "google_oauth_failed");
    targetUrl.searchParams.set("redirect_uri", redirectUri);
    const res = NextResponse.redirect(targetUrl.toString());
    res.cookies.delete("docmind_oauth_state");
    return res;
  }

  // 7. OAuth Callback: /api/auth/callback/github
  if (action === "callback" && subAction === "github") {
    const code = req.nextUrl.searchParams.get("code");
    const oauthError = req.nextUrl.searchParams.get("error");
    const errorDesc = req.nextUrl.searchParams.get("error_description");
    const stateParam = req.nextUrl.searchParams.get("state");

    const stateCookieVal = req.cookies.get("docmind_oauth_state")?.value;
    const stateData = parseOAuthState(stateCookieVal);
    const targetReturnTo = stateData?.returnTo || "/";
    const redirectTarget = `${baseUrl}${targetReturnTo.startsWith("/") ? targetReturnTo : `/${targetReturnTo}`}`;
    const targetUrl = new URL(redirectTarget, baseUrl);

    if (oauthError) {
      console.warn("GitHub OAuth callback error:", oauthError, errorDesc);
      targetUrl.searchParams.set("error", oauthError);
      if (errorDesc) targetUrl.searchParams.set("description", errorDesc);
      const res = NextResponse.redirect(targetUrl.toString());
      res.cookies.delete("docmind_oauth_state");
      return res;
    }

    if (!stateData || !stateParam || stateData.nonce !== stateParam) {
      console.warn("GitHub OAuth state verification mismatch.");
      targetUrl.searchParams.set("error", "oauth_state_invalid");
      const res = NextResponse.redirect(targetUrl.toString());
      res.cookies.delete("docmind_oauth_state");
      return res;
    }

    const clientId = (process.env.GITHUB_CLIENT_ID || "").trim();
    const clientSecret = (process.env.GITHUB_CLIENT_SECRET || "").trim();

    if (code && clientId && clientSecret) {
      try {
        const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
          }),
        });

        if (tokenRes.ok) {
          const tokenData = await tokenRes.json();
          if (tokenData.access_token) {
            const userRes = await fetch("https://api.github.com/user", {
              headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
                "User-Agent": "DocMind-App",
              },
            });

            if (userRes.ok) {
              const profile = await userRes.json();
              let email = profile.email;

              if (!email) {
                const emailsRes = await fetch("https://api.github.com/user/emails", {
                  headers: {
                    Authorization: `Bearer ${tokenData.access_token}`,
                    "User-Agent": "DocMind-App",
                  },
                });
                if (emailsRes.ok) {
                  const emails = await emailsRes.json();
                  const primary = emails.find((e: any) => e.primary && e.verified);
                  email = primary?.email || emails[0]?.email;
                }
              }

              const user = {
                id: `github_${profile.id}`,
                email: email || `${profile.login}@users.noreply.github.com`,
                name: profile.name || profile.login,
                role: "GitHub Developer",
                image: profile.avatar_url || "🐙",
                provider: "github",
                isDemo: false,
              };

              const token = signJwt({
                sub: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                image: user.image,
                provider: "github",
                isDemo: false,
              });

              targetUrl.searchParams.set("auth", "github_success");
              const res = NextResponse.redirect(targetUrl.toString());
              res.cookies.set("docmind_session", token, {
                path: "/",
                httpOnly: true,
                secure: secureCookie,
                sameSite: "lax",
                maxAge: 365 * 86400,
              });
              res.cookies.set("docmind_user", encodeURIComponent(JSON.stringify(user)), {
                path: "/",
                httpOnly: false,
                sameSite: "lax",
                maxAge: 365 * 86400,
              });
              res.cookies.delete("docmind_oauth_state");
              return res;
            }
          }
        }
      } catch (exc) {
        console.error("GitHub OAuth token exchange error:", exc);
      }
    }

    targetUrl.searchParams.set("error", "github_oauth_failed");
    const res = NextResponse.redirect(targetUrl.toString());
    res.cookies.delete("docmind_oauth_state");
    return res;
  }

  return NextResponse.json({ status: "ok", action, subAction });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ nextauth: string[] }> }
) {
  const resolvedParams = await params;
  const parts = resolvedParams?.nextauth || [];
  const action = parts[0] || "";
  const subAction = parts[1] || "";
  const secureCookie = isRequestSecure(req);

  // 1. Google Credential Verification (Google Identity Services GIS ID Token Verification)
  // Supports POST /api/auth/callback/google or POST /api/auth/signin with credential
  if (
    (action === "callback" && subAction === "google") ||
    (action === "signin" && subAction === "google") ||
    action === "google"
  ) {
    try {
      const body = await req.json();
      const credential = body.credential || body.id_token;

      if (!credential) {
        return NextResponse.json({ error: "Missing Google ID token credential" }, { status: 400 });
      }

      // Verify Google ID token cryptographically using Google's official token inspection API
      const tokenInfoRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
      );

      if (!tokenInfoRes.ok) {
        const errText = await tokenInfoRes.text();
        console.error("Google token verification failed:", tokenInfoRes.status, errText);
        return NextResponse.json(
          { error: "Invalid Google credential", details: errText },
          { status: 401 }
        );
      }

      const payload = await tokenInfoRes.json();
      const clientId = (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "").trim();

      // Verify token audience matches our configured Google Client ID if configured
      if (clientId && !clientId.startsWith("your_") && payload.aud !== clientId) {
        console.warn("Google token audience mismatch:", payload.aud, "expected:", clientId);
        return NextResponse.json(
          { error: "Token audience mismatch", details: "Credential was issued for a different client ID" },
          { status: 403 }
        );
      }

      // Verify expiration
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && Number(payload.exp) < now) {
        return NextResponse.json({ error: "Google token has expired" }, { status: 401 });
      }

      const googleId = payload.sub || payload.user_id;
      const email = (payload.email || "google.user@gmail.com").trim().toLowerCase();
      const name = (payload.name || payload.given_name || email.split("@")[0] || "Google User").trim();
      const image = payload.picture || "🌐";
      const userId = googleId ? `google_${googleId}` : `google_${email.replace(/[^a-z0-9]/gi, "_")}`;

      const user = {
        id: userId,
        email,
        name,
        image,
        role: "Google Verified Member",
        provider: "google",
        emailVerified: Boolean(payload.email_verified === "true" || payload.email_verified === true),
        isDemo: false,
      };

      // Mint cryptographic JWT session token
      const token = signJwt({
        sub: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        role: user.role,
        provider: "google",
        emailVerified: user.emailVerified,
        isDemo: false,
      });

      const res = NextResponse.json({ status: "authenticated", user, token });

      // Set secure session cookie
      res.cookies.set("docmind_session", token, {
        path: "/",
        httpOnly: true,
        secure: secureCookie,
        sameSite: "lax",
        maxAge: 365 * 86400,
      });

      // Set client profile cookie
      res.cookies.set("docmind_user", encodeURIComponent(JSON.stringify(user)), {
        path: "/",
        httpOnly: false,
        sameSite: "lax",
        maxAge: 365 * 86400,
      });

      return res;
    } catch (exc: any) {
      console.error("Google credential verification error:", exc);
      return NextResponse.json({ error: "Authentication failed", details: exc?.message }, { status: 500 });
    }
  }

  // 2. Generic Credentials or Direct Signin
  if (action === "signin" || action === "callback") {
    try {
      const body = await req.json();

      // If GIS credential passed to general signin
      if (body.credential && body.provider === "google") {
        const tokenInfoRes = await fetch(
          `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(body.credential)}`
        );
        if (tokenInfoRes.ok) {
          const payload = await tokenInfoRes.json();
          const googleId = payload.sub;
          const email = (payload.email || "").trim().toLowerCase();
          const name = (payload.name || payload.given_name || email.split("@")[0] || "Google User").trim();
          const image = payload.picture || "🌐";
          const userId = `google_${googleId}`;

          const user = {
            id: userId,
            email,
            name,
            image,
            role: "Google Verified Member",
            provider: "google",
            emailVerified: Boolean(payload.email_verified === "true" || payload.email_verified === true),
            isDemo: false,
          };

          const token = signJwt({
            sub: user.id,
            email: user.email,
            name: user.name,
            image: user.image,
            role: user.role,
            provider: "google",
            isDemo: false,
          });

          const res = NextResponse.json({ status: "authenticated", user, token });
          res.cookies.set("docmind_session", token, {
            path: "/",
            httpOnly: true,
            secure: secureCookie,
            sameSite: "lax",
            maxAge: 365 * 86400,
          });
          res.cookies.set("docmind_user", encodeURIComponent(JSON.stringify(user)), {
            path: "/",
            httpOnly: false,
            sameSite: "lax",
            maxAge: 365 * 86400,
          });
          return res;
        }
      }

      const email = (body.email || "user@docmind.io").trim().toLowerCase();
      const name = (body.name || email.split("@")[0] || "User").trim();
      const provider = body.provider || "credentials";
      const image = body.image || (provider === "google" ? "🌐" : provider === "github" ? "🐙" : "👤");
      const userId = body.id || `${provider}_${email.replace(/[^a-z0-9]/gi, "_").toLowerCase()}`;
      const isDemo = Boolean(body.isDemo);

      const user = {
        id: userId,
        name,
        email,
        image,
        role: provider === "credentials" ? "Member" : `${provider.toUpperCase()} Member`,
        provider,
        isDemo,
      };

      // Sign cryptographic JWT session token
      const token = signJwt({
        sub: userId,
        email: user.email,
        name: user.name,
        image: user.image,
        role: user.role,
        provider,
        isDemo,
      });

      const res = NextResponse.json({ status: "authenticated", user, token });

      // Set secure signed session cookie
      res.cookies.set("docmind_session", token, {
        path: "/",
        httpOnly: true,
        secure: secureCookie,
        sameSite: "lax",
        maxAge: 365 * 86400,
      });

      // Set client profile cookie
      res.cookies.set("docmind_user", encodeURIComponent(JSON.stringify(user)), {
        path: "/",
        httpOnly: false,
        sameSite: "lax",
        maxAge: 365 * 86400,
      });

      return res;
    } catch {
      return NextResponse.json({ status: "authenticated" });
    }
  }

  // 3. Sign Out
  if (action === "signout") {
    const res = NextResponse.json({ status: "signed_out" });
    res.cookies.delete("docmind_user");
    res.cookies.delete("docmind_session");
    res.cookies.delete("docmind_oauth_state");
    return res;
  }

  return NextResponse.json({ status: "ok", action });
}
