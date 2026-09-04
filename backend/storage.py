"""
Storage Service Abstraction Layer
─────────────────────────────────
Provides a unified interface for local filesystem and S3/MinIO object storage.
Enables completely stateless container instances without local disk dependencies.
"""

import os
import aiofiles
import logging
from abc import ABC, abstractmethod
from typing import Optional

logger = logging.getLogger(__name__)


class StorageBackend(ABC):
    @abstractmethod
    async def save_file(self, content: bytes, destination_name: str, content_type: Optional[str] = None) -> str:
        """Save file content and return persistent locator string."""
        ...

    @abstractmethod
    async def get_file(self, locator: str) -> bytes:
        """Read and return full file bytes."""
        ...

    @abstractmethod
    async def delete_file(self, locator: str) -> bool:
        """Delete file at locator."""
        ...

    @abstractmethod
    def file_exists(self, locator: str) -> bool:
        """Check if file exists."""
        ...


class LocalStorageBackend(StorageBackend):
    def __init__(self, base_dir: str = "./data/uploads"):
        self.base_dir = os.path.abspath(base_dir)
        os.makedirs(self.base_dir, exist_ok=True)

    async def save_file(self, content: bytes, destination_name: str, content_type: Optional[str] = None) -> str:
        safe_name = os.path.basename(destination_name)
        target_path = os.path.join(self.base_dir, safe_name)
        async with aiofiles.open(target_path, "wb") as f:
            await f.write(content)
        return target_path

    async def get_file(self, locator: str) -> bytes:
        if not os.path.exists(locator):
            raise FileNotFoundError(f"File not found: {locator}")
        async with aiofiles.open(locator, "rb") as f:
            return await f.read()

    async def delete_file(self, locator: str) -> bool:
        try:
            if os.path.exists(locator):
                os.remove(locator)
                return True
        except OSError as exc:
            logger.warning("Failed to delete local file %s: %s", locator, exc)
        return False

    def file_exists(self, locator: str) -> bool:
        return os.path.exists(locator)


class S3StorageBackend(StorageBackend):
    def __init__(
        self,
        bucket_name: str,
        endpoint_url: Optional[str] = None,
        access_key: Optional[str] = None,
        secret_key: Optional[str] = None,
        region: str = "us-east-1",
    ):
        self.bucket_name = bucket_name
        self.endpoint_url = endpoint_url
        self.access_key = access_key
        self.secret_key = secret_key
        self.region = region
        self._s3_client = None

    def _get_client(self):
        if self._s3_client is None:
            try:
                import boto3
                self._s3_client = boto3.client(
                    "s3",
                    endpoint_url=self.endpoint_url,
                    aws_access_key_id=self.access_key,
                    aws_secret_access_key=self.secret_key,
                    region_name=self.region,
                )
            except ImportError:
                raise ImportError("boto3 package is required for S3 storage backend. Please install via pip install boto3.")
        return self._s3_client

    async def save_file(self, content: bytes, destination_name: str, content_type: Optional[str] = None) -> str:
        client = self._get_client()
        key = os.path.basename(destination_name)
        extra_args = {}
        if content_type:
            extra_args["ContentType"] = content_type

        import asyncio
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None,
            lambda: client.put_object(Bucket=self.bucket_name, Key=key, Body=content, **extra_args)
        )
        return f"s3://{self.bucket_name}/{key}"

    async def get_file(self, locator: str) -> bytes:
        client = self._get_client()
        key = locator.split(f"s3://{self.bucket_name}/")[-1]
        import asyncio
        loop = asyncio.get_running_loop()
        resp = await loop.run_in_executor(
            None,
            lambda: client.get_object(Bucket=self.bucket_name, Key=key)
        )
        return resp["Body"].read()

    async def delete_file(self, locator: str) -> bool:
        try:
            client = self._get_client()
            key = locator.split(f"s3://{self.bucket_name}/")[-1]
            import asyncio
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(
                None,
                lambda: client.delete_object(Bucket=self.bucket_name, Key=key)
            )
            return True
        except Exception as exc:
            logger.warning("Failed to delete S3 object %s: %s", locator, exc)
            return False

    def file_exists(self, locator: str) -> bool:
        try:
            client = self._get_client()
            key = locator.split(f"s3://{self.bucket_name}/")[-1]
            client.head_object(Bucket=self.bucket_name, Key=key)
            return True
        except Exception:
            return False


def get_storage_backend(settings) -> StorageBackend:
    """Factory to initialize configured storage service."""
    if settings.storage_backend == "s3" and settings.s3_bucket_name:
        logger.info("Initializing S3/MinIO object storage backend (bucket: %s) [OK]", settings.s3_bucket_name)
        return S3StorageBackend(
            bucket_name=settings.s3_bucket_name,
            endpoint_url=settings.s3_endpoint_url,
            access_key=settings.s3_access_key,
            secret_key=settings.s3_secret_key,
            region=settings.s3_region,
        )
    return LocalStorageBackend(base_dir=settings.upload_dir)
