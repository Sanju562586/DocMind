"""
DocMind Rate Limiter
Supports Upstash Redis REST API, Standard Redis, and In-Memory Sliding Window Fallback.
"""

import time
import json
import logging
import urllib.request
import urllib.error
import asyncio
from typing import Tuple, Dict, List, Optional
from collections import defaultdict
import threading

logger = logging.getLogger(__name__)


class UpstashRateLimiter:
    def __init__(
        self,
        rest_url: Optional[str] = None,
        rest_token: Optional[str] = None,
        redis_url: Optional[str] = None,
    ):
        self.rest_url = rest_url.rstrip("/") if rest_url else None
        self.rest_token = rest_token
        self.redis_url = redis_url
        self._memory_store: Dict[str, List[float]] = defaultdict(list)
        self._lock = threading.Lock()

    @property
    def is_upstash_configured(self) -> bool:
        return bool(self.rest_url and self.rest_token)

    def _upstash_command(self, command_path: str, body: Optional[dict] = None) -> Optional[dict]:
        """Execute a REST command against Upstash Redis."""
        if not self.is_upstash_configured:
            return None

        url = f"{self.rest_url}/{command_path}"
        headers = {
            "Authorization": f"Bearer {self.rest_token}",
            "Content-Type": "application/json",
        }
        data = json.dumps(body).encode("utf-8") if body else None

        req = urllib.request.Request(url, data=data, headers=headers, method="POST" if data else "GET")
        try:
            with urllib.request.urlopen(req, timeout=3.0) as resp:
                resp_data = resp.read().decode("utf-8")
                return json.loads(resp_data)
        except Exception as exc:
            logger.warning("Upstash Redis command failed (%s), falling back to in-memory limiter: %s", command_path, exc)
            return None

    def _check_memory(self, key: str, limit: int, window_seconds: int) -> Tuple[bool, int, int, int]:
        """Sliding window rate limit using thread-safe in-memory store."""
        now = time.time()
        cutoff = now - window_seconds

        with self._lock:
            # Filter timestamps within window
            timestamps = [t for t in self._memory_store[key] if t > cutoff]
            current_count = len(timestamps)

            if current_count >= limit:
                oldest_in_window = timestamps[0] if timestamps else now
                retry_after = max(1, int(oldest_in_window + window_seconds - now))
                reset_seconds = retry_after
                remaining = 0
                self._memory_store[key] = timestamps
                return False, remaining, reset_seconds, retry_after

            # Record this request
            timestamps.append(now)
            self._memory_store[key] = timestamps
            remaining = max(0, limit - len(timestamps))
            reset_seconds = window_seconds
            return True, remaining, reset_seconds, 0

    def _check_upstash(self, key: str, limit: int, window_seconds: int) -> Optional[Tuple[bool, int, int, int]]:
        """Sliding window check via Upstash REST pipeline."""
        now = int(time.time())
        window_key = f"docmind:ratelimit:{key}:{now // window_seconds}"

        # Pipeline: INCR window_key, EXPIRE window_key window_seconds * 2, TTL window_key
        pipeline_body = [
            ["INCR", window_key],
            ["EXPIRE", window_key, window_seconds * 2],
            ["TTL", window_key],
        ]
        result = self._upstash_command("pipeline", pipeline_body)
        if not result or not isinstance(result, list) or len(result) < 3:
            return None

        try:
            incr_res = result[0].get("result", 1)
            ttl_res = result[2].get("result", window_seconds)
            current_count = int(incr_res)
            ttl = max(1, int(ttl_res))

            if current_count > limit:
                retry_after = ttl
                return False, 0, ttl, retry_after

            remaining = max(0, limit - current_count)
            return True, remaining, ttl, 0
        except (ValueError, TypeError, KeyError) as exc:
            logger.warning("Failed to parse Upstash pipeline result: %s", exc)
            return None

    def check(self, key: str, limit: int, window_seconds: int = 60) -> Tuple[bool, int, int, int]:
        """
        Check rate limit for a key.
        Returns: (allowed: bool, remaining: int, reset_seconds: int, retry_after: int)
        """
        if self.is_upstash_configured:
            res = self._check_upstash(key, limit, window_seconds)
            if res is not None:
                return res

        return self._check_memory(key, limit, window_seconds)

    async def check_async(self, key: str, limit: int, window_seconds: int = 60) -> Tuple[bool, int, int, int]:
        return await asyncio.to_thread(self.check, key, limit, window_seconds)
