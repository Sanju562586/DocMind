"""
Production Asynchronous Task Queue & Concurrency Controller
────────────────────────────────────────────────────────────
Decouples CPU-intensive document chunking, indexing, and OCR tasks from
HTTP request handlers via bounded worker pools.
"""

import asyncio
import logging
import uuid
import time
from typing import Callable, Coroutine, Any, Dict, Optional
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class TaskJob:
    id: str
    name: str
    coro_func: Callable[..., Coroutine[Any, Any, Any]]
    args: tuple = ()
    kwargs: dict = field(default_factory=dict)
    status: str = "pending"  # pending, running, completed, failed
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    error: Optional[str] = None


class AsyncTaskQueue:
    def __init__(self, max_workers: int = 4, max_queue_size: int = 200):
        self.max_workers = max(1, max_workers)
        self.max_queue_size = max_queue_size
        self._queue: Optional[asyncio.Queue] = None
        self._workers: list = []
        self._tasks: Dict[str, TaskJob] = {}
        self._running = False

    async def start(self):
        """Start the background worker pool."""
        if self._running:
            return
        self._queue = asyncio.Queue(maxsize=self.max_queue_size)
        self._running = True
        self._workers = [
            asyncio.create_task(self._worker_loop(i))
            for i in range(self.max_workers)
        ]
        logger.info("AsyncTaskQueue started with %d worker threads [OK]", self.max_workers)

    async def stop(self):
        """Gracefully drain and stop all workers."""
        if not self._running:
            return
        self._running = False
        if self._workers:
            for w in self._workers:
                w.cancel()
            await asyncio.gather(*self._workers, return_exceptions=True)
            self._workers.clear()
        logger.info("AsyncTaskQueue workers stopped successfully")

    async def enqueue(
        self,
        name: str,
        coro_func: Callable[..., Coroutine[Any, Any, Any]],
        *args,
        **kwargs,
    ) -> str:
        """Enqueue a background task returning a tracking task_id."""
        if not self._running or self._queue is None:
            # Lazy start if not already started
            await self.start()

        task_id = str(uuid.uuid4())
        job = TaskJob(
            id=task_id,
            name=name,
            coro_func=coro_func,
            args=args,
            kwargs=kwargs,
        )
        self._tasks[task_id] = job
        try:
            self._queue.put_nowait(job)
        except asyncio.QueueFull:
            job.status = "failed"
            job.error = "Task queue capacity reached"
            raise RuntimeError("Server task queue is currently full. Please try again in a moment.")

        return task_id

    async def _worker_loop(self, worker_id: int):
        """Continuous consumer loop for worker instances."""
        while self._running:
            try:
                job: TaskJob = await self._queue.get()
                job.status = "running"
                job.started_at = time.time()
                try:
                    await job.coro_func(*job.args, **job.kwargs)
                    job.status = "completed"
                except asyncio.CancelledError:
                    job.status = "cancelled"
                    break
                except Exception as exc:
                    job.status = "failed"
                    job.error = str(exc)
                    logger.exception("TaskJob %s (%s) failed on worker %d: %s", job.id, job.name, worker_id, exc)
                finally:
                    job.completed_at = time.time()
                    self._queue.task_done()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("Unexpected worker exception on worker %d: %s", worker_id, exc)
                await asyncio.sleep(0.5)

    def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        job = self._tasks.get(task_id)
        if not job:
            return None
        return {
            "task_id": job.id,
            "name": job.name,
            "status": job.status,
            "created_at": job.created_at,
            "duration": (job.completed_at - job.started_at) if (job.completed_at and job.started_at) else None,
            "error": job.error,
        }

    def stats(self) -> Dict[str, Any]:
        """Return diagnostic metrics on task queue health."""
        pending = sum(1 for t in self._tasks.values() if t.status == "pending")
        running = sum(1 for t in self._tasks.values() if t.status == "running")
        completed = sum(1 for t in self._tasks.values() if t.status == "completed")
        failed = sum(1 for t in self._tasks.values() if t.status == "failed")
        return {
            "max_workers": self.max_workers,
            "queue_size": self._queue.qsize() if self._queue else 0,
            "pending": pending,
            "running": running,
            "completed": completed,
            "failed": failed,
            "total_tasks": len(self._tasks),
        }
