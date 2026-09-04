"""
Multi-LLM Router with Automatic Fallback & Failover
────────────────────────────────────────────────────
Priority:  Gemini  →  Groq  →  OpenRouter
On error (429 Rate Limit, 500, Quota exceeded, Timeout) → automatically tries next provider.
Supports streaming via async generators.
"""

import asyncio
import json
import logging
from abc import ABC, abstractmethod
from typing import AsyncGenerator, List, Dict, Optional

import httpx

logger = logging.getLogger(__name__)


class LLMProvider(ABC):
    name: str = "base"

    @abstractmethod
    async def stream(
        self, messages: List[Dict], api_key: str, model: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        ...


# ──────────────────────────────────────────────────────────────────────────────
# Gemini Provider
# ──────────────────────────────────────────────────────────────────────────────

class GeminiProvider(LLMProvider):
    name = "gemini"
    candidate_models = [
        "gemini-3.7-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash-lite",
        "gemini-2.0-flash",
        "gemini-2.0-flash-lite",
        "gemini-1.5-flash",
        "gemini-1.5-pro",
    ]

    async def stream(
        self, messages: List[Dict], api_key: str, model: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        key = api_key.strip()
        models_to_try = [model] if model else []
        for m in self.candidate_models:
            if m not in models_to_try:
                models_to_try.append(m)

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

        last_exc = None
        for m_name in models_to_try:
            # 1. Try google.generativeai SDK first if available
            try:
                import google.generativeai as genai
                genai.configure(api_key=key)
                genai_model = genai.GenerativeModel(
                    m_name,
                    system_instruction=system_msg,
                )

                history = []
                for msg in chat_messages[:-1]:
                    history.append({"role": msg["role"], "parts": [msg["content"]]})

                last_user_msg = chat_messages[-1]["content"]

                # Run sync SDK stream in thread-safe generator
                queue: asyncio.Queue = asyncio.Queue()
                loop = asyncio.get_running_loop()

                def _producer():
                    try:
                        chat = genai_model.start_chat(history=history)
                        response = chat.send_message(
                            last_user_msg,
                            stream=True,
                            generation_config=genai.GenerationConfig(
                                temperature=0.7,
                                max_output_tokens=3072,
                            ),
                        )
                        for chunk in response:
                            try:
                                if chunk.text:
                                    loop.call_soon_threadsafe(queue.put_nowait, chunk.text)
                            except Exception:
                                if hasattr(chunk, "candidates") and chunk.candidates:
                                    for part in chunk.candidates[0].content.parts:
                                        if hasattr(part, "text") and part.text:
                                            loop.call_soon_threadsafe(queue.put_nowait, part.text)
                    except Exception as exc:
                        loop.call_soon_threadsafe(queue.put_nowait, exc)
                    finally:
                        loop.call_soon_threadsafe(queue.put_nowait, None)

                loop.run_in_executor(None, _producer)

                yielded_any = False
                while True:
                    item = await queue.get()
                    if item is None:
                        break
                    if isinstance(item, Exception):
                        raise item
                    yielded_any = True
                    yield item

                if yielded_any:
                    return

            except Exception as exc:
                last_exc = exc
                logger.warning("Gemini SDK model %s failed: %s. Trying REST API fallback...", m_name, exc)

            # 2. Direct HTTP REST API streaming fallback
            try:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{m_name}:streamGenerateContent?alt=sse&key={key}"
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

                yielded_any = False
                async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
                    async with client.stream("POST", url, json=payload) as resp:
                        if resp.status_code != 200:
                            err_body = await resp.aread()
                            raise RuntimeError(f"HTTP {resp.status_code}: {err_body.decode('utf-8', errors='ignore')[:200]}")

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
                                        if "text" in part and part["text"]:
                                            yielded_any = True
                                            yield part["text"]
                            except Exception:
                                pass

                if yielded_any:
                    return

            except Exception as exc:
                last_exc = exc
                logger.warning("Gemini REST model %s failed: %s. Trying next...", m_name, exc)
                continue

        if last_exc:
            raise last_exc


# ──────────────────────────────────────────────────────────────────────────────
# Groq Provider (Native Async HTTP Streaming to bypass proxies issue)
# ──────────────────────────────────────────────────────────────────────────────

class GroqProvider(LLMProvider):
    name = "groq"
    candidate_models = [
        "openai/gpt-oss-120b",
        "openai/gpt-oss-20b",
        "qwen/qwen3.6-27b",
        "llama-3.3-70b-versatile",
        "llama-3.1-70b-versatile",
        "llama-3.1-8b-instant",
    ]

    async def stream(
        self, messages: List[Dict], api_key: str, model: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        key = api_key.strip()
        models_to_try = [model] if model else []
        for m in self.candidate_models:
            if m not in models_to_try:
                models_to_try.append(m)

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
                async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
                    async with client.stream(
                        "POST",
                        "https://api.groq.com/openai/v1/chat/completions",
                        headers=headers,
                        json=payload,
                    ) as resp:
                        if resp.status_code != 200:
                            err_body = await resp.aread()
                            raise RuntimeError(f"Groq HTTP {resp.status_code}: {err_body.decode('utf-8', errors='ignore')[:200]}")

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
                                    if "content" in delta and delta["content"]:
                                        yielded_any = True
                                        yield delta["content"]
                            except Exception:
                                pass

                if yielded_any:
                    return
            except Exception as exc:
                last_exc = exc
                logger.warning("Groq model %s failed: %s. Trying next...", m_name, exc)
                continue

        if last_exc:
            raise last_exc


# ──────────────────────────────────────────────────────────────────────────────
# OpenRouter Provider (Native Async HTTP Streaming to bypass proxies issue)
# ──────────────────────────────────────────────────────────────────────────────

class OpenRouterProvider(LLMProvider):
    name = "openrouter"
    candidate_models = [
        "anthropic/claude-3.5-haiku",
        "meta-llama/llama-3.3-70b-instruct",
        "google/gemini-2.0-flash-001",
        "google/gemini-flash-1.5",
        "mistralai/mistral-large-2407",
        "qwen/qwen-2.5-72b-instruct",
        "anthropic/claude-3-haiku",
    ]

    async def stream(
        self, messages: List[Dict], api_key: str, model: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        key = api_key.strip()
        models_to_try = [model] if model else []
        for m in self.candidate_models:
            if m not in models_to_try:
                models_to_try.append(m)

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
                async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
                    async with client.stream(
                        "POST",
                        "https://openrouter.ai/api/v1/chat/completions",
                        headers=headers,
                        json=payload,
                    ) as resp:
                        if resp.status_code != 200:
                            err_body = await resp.aread()
                            raise RuntimeError(f"OpenRouter HTTP {resp.status_code}: {err_body.decode('utf-8', errors='ignore')[:200]}")

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
                                    if "content" in delta and delta["content"]:
                                        yielded_any = True
                                        yield delta["content"]
                            except Exception:
                                pass

                if yielded_any:
                    return
            except Exception as exc:
                last_exc = exc
                logger.warning("OpenRouter model %s failed: %s. Trying next...", m_name, exc)
                continue

        if last_exc:
            raise last_exc


# ──────────────────────────────────────────────────────────────────────────────
# Router (with automatic multi-provider fallback)
# ──────────────────────────────────────────────────────────────────────────────

class LLMRouter:
    def __init__(self):
        self._providers: List[LLMProvider] = [
            GeminiProvider(),
            GroqProvider(),
            OpenRouterProvider(),
        ]

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

        errors: List[str] = []

        for provider in self._providers:
            api_key = key_map.get(provider.name)
            if not api_key or not api_key.strip():
                logger.debug("Skipping provider %s (no API key supplied)", provider.name)
                continue

            try:
                logger.info("Attempting LLM provider: %s", provider.name)
                token_count = 0
                async for token in provider.stream(
                    messages, api_key, model=model_map.get(provider.name)
                ):
                    token_count += 1
                    yield token
                logger.info("Provider %s succeeded (%d tokens)", provider.name, token_count)
                return

            except Exception as exc:
                err_msg = f"{provider.name}: {type(exc).__name__}: {str(exc)[:120]}"
                logger.warning("Provider %s failed, falling back to next provider - %s", provider.name, err_msg)
                errors.append(err_msg)
                continue

        # If all available providers failed
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
            tokens.append(token)
        return "".join(tokens)

