"""
Multi-LLM Router with Real-Time Streaming & Automatic Failover
─────────────────────────────────────────────────────────────
Providers: Groq (ultra-fast sub-second streaming) ↔ Gemini ↔ OpenRouter
Includes:
- Force IPv4 resolution to prevent 21-second Windows IPv6 DNS connection hangs.
- Native async HTTP Server-Sent Events (SSE) streaming for all providers.
- Smooth word-level token streaming so answers stream in real time instead of dumping whole blocks.
- Automatic mid-stream reset and failover on errors, rate limits, or timeouts.
"""

import asyncio
import json
import logging
import os
import re
import socket
from abc import ABC, abstractmethod
from typing import AsyncGenerator, List, Dict, Optional

# Force IPv4 socket resolution on Windows to eliminate 21-second IPv6 connection hangs
try:
    _orig_getaddrinfo = socket.getaddrinfo
    def _ipv4_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
        return _orig_getaddrinfo(host, port, socket.AF_INET, type, proto, flags)
    socket.getaddrinfo = _ipv4_getaddrinfo
except Exception:
    pass

import httpx

logger = logging.getLogger(__name__)

# Special sentinel token yielded across stream generators when a model/provider fails mid-stream
# and falls back to an alternative model from the beginning.
LLM_STREAM_RESET = "\x00__DOCMIND_RESET_STREAM__\x00"


class LLMProvider(ABC):
    name: str = "base"

    @abstractmethod
    async def stream(
        self, messages: List[Dict], api_key: str, model: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        ...


# ──────────────────────────────────────────────────────────────────────────────
# Gemini Provider (Native Async REST SSE Streaming with Word-Level Smoothing)
# ──────────────────────────────────────────────────────────────────────────────

class GeminiProvider(LLMProvider):
    name = "gemini"
    candidate_models = [
        "gemini-3.1-flash-lite",
        "gemini-3.5-flash-lite",
        "gemini-3.8-flash",
        "gemini-3.6-flash",
    ]

    async def stream(
        self, messages: List[Dict], api_key: str, model: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        key = api_key.strip()
        models_to_try: List[str] = []
        if model and model.strip():
            clean_m = model.strip().replace("models/", "")
            models_to_try.append(clean_m)
        for m in self.candidate_models:
            if m not in models_to_try:
                models_to_try.append(m)

        # Limit to at most 2 candidate models so failover to next provider is fast
        models_to_try = models_to_try[:2]

        system_msg = next((m["content"] for m in messages if m["role"] == "system"), None)
        raw_chat = [m for m in messages if m["role"] != "system"]

        # Gemini requires strictly alternating user/model turns starting with user
        chat_messages: List[Dict] = []
        current_role = None
        accumulated_text: List[str] = []

        for msg in raw_chat:
            role = "user" if msg["role"] == "user" else "model"
            content = msg.get("content", "")
            if not content:
                continue
            if role == current_role:
                accumulated_text.append(content)
            else:
                if current_role is not None:
                    chat_messages.append({"role": current_role, "content": "\n\n".join(accumulated_text)})
                current_role = role
                accumulated_text = [content]

        if current_role is not None and accumulated_text:
            chat_messages.append({"role": current_role, "content": "\n\n".join(accumulated_text)})

        if not chat_messages:
            chat_messages = [{"role": "user", "content": "Hello"}]
        if chat_messages[0]["role"] != "user":
            chat_messages.insert(0, {"role": "user", "content": "Hello"})
        if chat_messages[-1]["role"] != "user":
            chat_messages.append({"role": "user", "content": "Please continue."})

        contents = []
        for msg in chat_messages:
            contents.append({"role": msg["role"], "parts": [{"text": msg["content"]}]})

        payload: Dict = {
            "contents": contents,
            "generationConfig": {
                "temperature": 0.7,
                "maxOutputTokens": 3072,
            },
        }
        if system_msg:
            payload["systemInstruction"] = {"parts": [{"text": system_msg}]}

        last_exc = None
        for m_name in models_to_try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{m_name}:streamGenerateContent?alt=sse&key={key}"
            yielded_any = False
            try:
                # Lean connect & read timeouts so slow or dead models fail over quickly
                async with httpx.AsyncClient(timeout=httpx.Timeout(connect=5.0, read=15.0, write=5.0, pool=5.0)) as client:
                    async with client.stream("POST", url, json=payload) as resp:
                        if resp.status_code != 200:
                            err_body = await resp.aread()
                            err_text = err_body.decode("utf-8", errors="ignore")[:300]
                            raise RuntimeError(f"Gemini HTTP {resp.status_code}: {err_text}")

                        async for line in resp.aiter_lines():
                            if not line.startswith("data: "):
                                continue
                            data_str = line[6:].strip()
                            if not data_str:
                                continue
                            try:
                                chunk_json = json.loads(data_str)
                                candidates = chunk_json.get("candidates", [])
                                if candidates:
                                    parts = candidates[0].get("content", {}).get("parts", [])
                                    for part in parts:
                                        text_segment = part.get("text", "")
                                        if text_segment:
                                            # Split larger blocks into natural word tokens with micro-delays
                                            # to give the user a smooth real-time stream instead of large jumps
                                            tokens = re.findall(r"\S+|\s+", text_segment)
                                            for tok in tokens:
                                                yielded_any = True
                                                yield tok
                                                if len(tokens) > 2:
                                                    await asyncio.sleep(0.01)
                            except Exception:
                                pass

                if yielded_any:
                    return

            except Exception as exc:
                last_exc = exc
                if yielded_any:
                    logger.warning("Gemini model %s failed mid-stream: %s. Emitting stream reset...", m_name, exc)
                    yield LLM_STREAM_RESET
                    yielded_any = False
                logger.warning("Gemini model %s failed: %s. Trying fallback...", m_name, exc)
                continue

        if last_exc:
            raise last_exc


# ──────────────────────────────────────────────────────────────────────────────
# Groq Provider (Native Async HTTP Streaming with Sub-Second First Token)
# ──────────────────────────────────────────────────────────────────────────────

class GroqProvider(LLMProvider):
    name = "groq"
    candidate_models = [
        "openai/gpt-oss-120b",
        "openai/gpt-oss-20b",
        "qwen/qwen3.8-27b",
        "groq/compound",
    ]

    async def stream(
        self, messages: List[Dict], api_key: str, model: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        key = api_key.strip()
        models_to_try: List[str] = []
        if model and model.strip():
            clean_m = model.strip()
            models_to_try.append(clean_m)
        for m in self.candidate_models:
            if m not in models_to_try:
                models_to_try.append(m)

        # Limit to at most 2 candidate models
        models_to_try = models_to_try[:2]

        last_exc = None
        for m_name in models_to_try:
            try:
                headers = {
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                }
                payload = {
                    "model": m_name,
                    "messages": messages,
                    "stream": True,
                    "max_tokens": 3072,
                    "temperature": 0.7,
                }

                yielded_any = False
                async with httpx.AsyncClient(timeout=httpx.Timeout(connect=5.0, read=25.0, write=5.0, pool=5.0)) as client:
                    async with client.stream(
                        "POST",
                        "https://api.groq.com/openai/v1/chat/completions",
                        headers=headers,
                        json=payload,
                    ) as resp:
                        if resp.status_code != 200:
                            err_body = await resp.aread()
                            err_text = err_body.decode("utf-8", errors="ignore")[:300]
                            raise RuntimeError(f"Groq HTTP {resp.status_code}: {err_text}")

                        async for line in resp.aiter_lines():
                            if not line.startswith("data: "):
                                continue
                            data_str = line[6:].strip()
                            if data_str == "[DONE]":
                                break
                            try:
                                chunk_json = json.loads(data_str)
                                choices = chunk_json.get("choices")
                                if choices and len(choices) > 0:
                                    delta = choices[0].get("delta", {})
                                    content = delta.get("content", "")
                                    if content:
                                        yielded_any = True
                                        yield content
                            except Exception:
                                pass

                if yielded_any:
                    return
            except Exception as exc:
                last_exc = exc
                if yielded_any:
                    logger.warning("Groq model %s failed mid-stream: %s. Emitting stream reset...", m_name, exc)
                    yield LLM_STREAM_RESET
                    yielded_any = False
                logger.warning("Groq model %s failed: %s. Trying fallback model...", m_name, exc)
                continue

        if last_exc:
            raise last_exc


# ──────────────────────────────────────────────────────────────────────────────
# OpenRouter Provider (Native Async HTTP Streaming)
# ──────────────────────────────────────────────────────────────────────────────

class OpenRouterProvider(LLMProvider):
    name = "openrouter"
    candidate_models = [
        "meta-llama/llama-3.3-70b-instruct",
        "openai/gpt-4o-mini",
        "google/gemini-2.5-flash",
        "mistralai/mistral-large-2407",
    ]

    async def stream(
        self, messages: List[Dict], api_key: str, model: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        key = api_key.strip()
        models_to_try: List[str] = []
        if model and model.strip():
            clean_m = model.strip()
            models_to_try.append(clean_m)
        for m in self.candidate_models:
            if m not in models_to_try:
                models_to_try.append(m)

        models_to_try = models_to_try[:2]

        last_exc = None
        for m_name in models_to_try:
            try:
                headers = {
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://docmind.app",
                    "X-Title": "DocMind Summarizer",
                }
                payload = {
                    "model": m_name,
                    "messages": messages,
                    "stream": True,
                    "max_tokens": 3072,
                    "temperature": 0.7,
                }

                yielded_any = False
                async with httpx.AsyncClient(timeout=httpx.Timeout(connect=5.0, read=25.0, write=5.0, pool=5.0)) as client:
                    async with client.stream(
                        "POST",
                        "https://openrouter.ai/api/v1/chat/completions",
                        headers=headers,
                        json=payload,
                    ) as resp:
                        if resp.status_code != 200:
                            err_body = await resp.aread()
                            err_text = err_body.decode("utf-8", errors="ignore")[:300]
                            raise RuntimeError(f"OpenRouter HTTP {resp.status_code}: {err_text}")

                        async for line in resp.aiter_lines():
                            if not line.startswith("data: "):
                                continue
                            data_str = line[6:].strip()
                            if data_str == "[DONE]":
                                break
                            try:
                                chunk_json = json.loads(data_str)
                                choices = chunk_json.get("choices")
                                if choices and len(choices) > 0:
                                    delta = choices[0].get("delta", {})
                                    content = delta.get("content", "")
                                    if content:
                                        yielded_any = True
                                        yield content
                            except Exception:
                                pass

                if yielded_any:
                    return
            except Exception as exc:
                last_exc = exc
                if yielded_any:
                    logger.warning("OpenRouter model %s failed mid-stream: %s. Emitting stream reset...", m_name, exc)
                    yield LLM_STREAM_RESET
                    yielded_any = False
                logger.warning("OpenRouter model %s failed: %s. Trying fallback model...", m_name, exc)
                continue

        if last_exc:
            raise last_exc


# ──────────────────────────────────────────────────────────────────────────────
# Router (with Dynamic Fast-Path Prioritization & Multi-Provider Fallback)
# ──────────────────────────────────────────────────────────────────────────────

class LLMRouter:
    def __init__(self):
        self._groq = GroqProvider()
        self._gemini = GeminiProvider()
        self._openrouter = OpenRouterProvider()

    def _get_providers_order(self, groq_key: Optional[str], gemini_key: Optional[str]) -> List[LLMProvider]:
        """
        Dynamically prioritize Groq for lightning-fast sub-second token streaming when available,
        falling back seamlessly to Gemini and OpenRouter.
        """
        if groq_key and groq_key.strip():
            # Groq is ultra-fast (<1s first token response)
            return [self._groq, self._gemini, self._openrouter]
        elif gemini_key and gemini_key.strip():
            return [self._gemini, self._groq, self._openrouter]
        else:
            return [self._openrouter, self._groq, self._gemini]

    async def stream(
        self,
        messages: List[Dict],
        gemini_key: Optional[str] = None,
        groq_key: Optional[str] = None,
        openrouter_key: Optional[str] = None,
        gemini_model: Optional[str] = None,
        groq_model: Optional[str] = None,
        openrouter_model: Optional[str] = None,
    ) -> AsyncGenerator[str, None]:

        key_map = {
            "gemini": gemini_key,
            "groq": groq_key,
            "openrouter": openrouter_key,
        }
        model_map = {
            "gemini": gemini_model,
            "groq": groq_model,
            "openrouter": openrouter_model,
        }

        providers = self._get_providers_order(groq_key, gemini_key)
        errors: List[str] = []

        for provider in providers:
            api_key = key_map.get(provider.name)
            if not api_key or not api_key.strip():
                logger.debug("Skipping provider %s (no API key supplied)", provider.name)
                continue

            token_count = 0
            try:
                logger.info("Attempting LLM provider: %s", provider.name)
                async for token in provider.stream(
                    messages, api_key, model=model_map.get(provider.name)
                ):
                    if token == LLM_STREAM_RESET:
                        token_count = 0
                        yield LLM_STREAM_RESET
                        continue
                    token_count += 1
                    yield token

                logger.info("Provider %s succeeded (%d tokens streamed)", provider.name, token_count)
                return

            except Exception as exc:
                err_msg = f"{provider.name}: {type(exc).__name__}: {str(exc)[:150]}"
                if token_count > 0:
                    logger.warning(
                        "Provider %s failed mid-stream after emitting %d tokens: %s. Emitting reset and attempting fallback...",
                        provider.name, token_count, err_msg
                    )
                    yield LLM_STREAM_RESET
                    token_count = 0
                else:
                    logger.warning("Provider %s failed, falling back to next provider - %s", provider.name, err_msg)
                errors.append(err_msg)
                continue

        error_details = "\n".join(f"- {e}" for e in errors) if errors else "No valid API keys configured."
        raise RuntimeError(f"All LLM providers failed:\n{error_details}\n\nPlease verify your API keys or rate limits in Settings.")

    async def generate_complete(
        self,
        messages: List[Dict],
        gemini_key: Optional[str] = None,
        groq_key: Optional[str] = None,
        openrouter_key: Optional[str] = None,
        gemini_model: Optional[str] = None,
        groq_model: Optional[str] = None,
        openrouter_model: Optional[str] = None,
    ) -> str:
        """Accumulates all streaming tokens into a complete response string."""
        tokens: List[str] = []
        async for token in self.stream(
            messages=messages,
            gemini_key=gemini_key,
            groq_key=groq_key,
            openrouter_key=openrouter_key,
            gemini_model=gemini_model,
            groq_model=groq_model,
            openrouter_model=openrouter_model,
        ):
            if token == LLM_STREAM_RESET:
                tokens.clear()
                continue
            tokens.append(token)
        return "".join(tokens)
