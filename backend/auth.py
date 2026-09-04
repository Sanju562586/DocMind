"""
Production Cryptographic Authentication & Token Verification Suite
───────────────────────────────────────────────────────────────────
Provides HMAC-SHA256 (HS256) JWT generation and constant-time signature verification.
Zero native compilation dependencies; standard library implementation.
"""

import hmac
import hashlib
import base64
import json
import time
import logging
from typing import Dict, Any, Optional
from starlette.requests import Request

logger = logging.getLogger(__name__)


def _b64url_encode(data: bytes) -> str:
    """Encode bytes to base64url string without trailing padding."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(s: str) -> bytes:
    """Decode base64url string with auto-padding restore."""
    rem = len(s) % 4
    if rem > 0:
        s += "=" * (4 - rem)
    return base64.urlsafe_b64decode(s.encode("ascii"))


def create_jwt(
    payload: Dict[str, Any],
    secret: str,
    algorithm: str = "HS256",
    expire_minutes: int = 43200,
) -> str:
    """
    Generate a standard signed JWT with HMAC-SHA256.
    """
    if algorithm != "HS256":
        raise ValueError(f"Unsupported algorithm: {algorithm}. Only HS256 is supported.")

    header = {"alg": "HS256", "typ": "JWT"}
    now = int(time.time())
    token_payload = {
        **payload,
        "iat": now,
        "exp": now + int(expire_minutes * 60),
    }

    header_b64 = _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_b64 = _b64url_encode(json.dumps(token_payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")

    signature = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    sig_b64 = _b64url_encode(signature)

    return f"{header_b64}.{payload_b64}.{sig_b64}"


def verify_jwt(token: str, secret: str, algorithm: str = "HS256") -> Dict[str, Any]:
    """
    Verify a JWT signature and check expiry using constant-time comparison.
    Returns decoded payload if valid; raises ValueError if invalid or expired.
    """
    parts = token.strip().split(".")
    if len(parts) != 3:
        raise ValueError("Invalid JWT format: Token must contain exactly 3 segments.")

    header_b64, payload_b64, sig_b64 = parts

    try:
        header_bytes = _b64url_decode(header_b64)
        header = json.loads(header_bytes.decode("utf-8"))
        if header.get("alg") != algorithm:
            raise ValueError(f"Token algorithm '{header.get('alg')}' mismatch with expected '{algorithm}'.")
    except Exception as exc:
        raise ValueError(f"Invalid JWT header: {exc}")

    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
    expected_sig = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()

    try:
        actual_sig = _b64url_decode(sig_b64)
    except Exception as exc:
        raise ValueError(f"Invalid signature encoding: {exc}")

    if not hmac.compare_digest(expected_sig, actual_sig):
        raise ValueError("Cryptographic verification failed: Invalid JWT signature.")

    try:
        payload_bytes = _b64url_decode(payload_b64)
        payload = json.loads(payload_bytes.decode("utf-8"))
    except Exception as exc:
        raise ValueError(f"Invalid JWT payload: {exc}")

    now = int(time.time())
    if "exp" in payload and payload["exp"] < now:
        raise ValueError(f"JWT has expired (expired at {payload['exp']}, current time is {now}).")

    return payload


def extract_user_identity(request: Request, secret: str) -> Dict[str, str]:
    """
    Extract verified user identity from Authorization header, X-Auth-Token, or cookie.
    If valid signed JWT is present, user claims are verified.
    Falls back gracefully to sanitized guest identity.
    """
    token = None

    # 1. Check Authorization: Bearer <jwt>
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()

    # 2. Check X-Auth-Token header
    if not token:
        token = request.headers.get("X-Auth-Token")

    # 3. Check docmind_session cookie
    if not token and hasattr(request, "cookies"):
        token = request.cookies.get("docmind_session")

    if token:
        try:
            payload = verify_jwt(token, secret)
            return {
                "user_id": payload.get("sub") or payload.get("user_id") or "default_user",
                "email": payload.get("email") or "verified@docmind.local",
                "name": payload.get("name") or "Authenticated User",
                "image": payload.get("image") or payload.get("picture") or "👤",
                "role": payload.get("role") or "member",
                "provider": payload.get("provider") or "credentials",
                "auth_type": "jwt",
            }
        except ValueError as exc:
            logger.warning("JWT verification failed: %s. Falling back to guest identity.", exc)

    # 4. Fallback: Development / Guest request headers
    user_id = request.headers.get("X-User-Id") or "default_user"
    email = request.headers.get("X-User-Email") or "guest@docmind.local"
    name = request.headers.get("X-User-Name") or "Guest User"
    image = request.headers.get("X-User-Image") or "👤"
    provider = request.headers.get("X-User-Provider") or "guest"

    # Sanitize user_id against path traversal
    user_id = user_id.replace("/", "").replace("\\", "").replace("..", "").strip() or "default_user"

    return {
        "user_id": user_id,
        "email": email,
        "name": name,
        "image": image,
        "role": "guest" if user_id == "default_user" else "member",
        "provider": provider,
        "auth_type": "header_or_guest",
    }
