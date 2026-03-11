"""
OSS uploader for SenseVoice recorded file recognition.
Uploads audio to OSS and returns a public or signed URL.
"""

import os
import uuid
from typing import Optional, Tuple

try:
    import oss2
    OSS_AVAILABLE = True
except Exception:
    oss2 = None
    OSS_AVAILABLE = False


class OSSUploader:
    """Upload bytes to OSS and return a URL."""

    def __init__(self):
        self.endpoint = os.getenv("OSS_ENDPOINT", "")
        self.bucket_name = os.getenv("OSS_BUCKET", "")
        self.access_key_id = os.getenv("OSS_ACCESS_KEY_ID", "")
        self.access_key_secret = os.getenv("OSS_ACCESS_KEY_SECRET", "")
        self.public_base_url = os.getenv("OSS_PUBLIC_BASE_URL", "").strip()
        self.object_prefix = os.getenv("OSS_OBJECT_PREFIX", "sensevoice")
        self.use_signed_url = os.getenv("OSS_USE_SIGNED_URL", "false").lower() == "true"
        self.signed_url_expires = int(os.getenv("OSS_SIGNED_URL_EXPIRES", "3600"))

        self.enabled = bool(
            OSS_AVAILABLE
            and self.endpoint
            and self.bucket_name
            and self.access_key_id
            and self.access_key_secret
        )
        self._bucket = None

        if self.enabled:
            auth = oss2.Auth(self.access_key_id, self.access_key_secret)
            self._bucket = oss2.Bucket(auth, self._normalize_endpoint(self.endpoint), self.bucket_name)

    def upload_bytes(
        self,
        data: bytes,
        filename: Optional[str] = None,
        content_type: Optional[str] = None,
    ) -> Tuple[Optional[str], Optional[str]]:
        """Return (url, error_message)."""
        if not self.enabled:
            return (None, "OSS is not configured or oss2 is unavailable")

        if not data:
            return (None, "Empty upload payload")

        object_key = self._build_object_key(filename)
        headers = {}
        if content_type:
            headers["Content-Type"] = content_type

        try:
            self._bucket.put_object(object_key, data, headers=headers)
        except Exception as e:
            return (None, f"OSS upload failed: {e}")

        url = self._build_url(object_key)
        return (url, None)

    def delete_object(self, object_key: str) -> None:
        if not self.enabled or not object_key:
            return
        try:
            self._bucket.delete_object(object_key)
        except Exception:
            pass

    def _build_object_key(self, filename: Optional[str]) -> str:
        ext = ""
        if filename and "." in filename:
            ext = "." + filename.rsplit(".", 1)[-1].lower()
        return f"{self.object_prefix}/{uuid.uuid4().hex}{ext}"

    def _build_url(self, object_key: str) -> str:
        if self.use_signed_url:
            return self._bucket.sign_url("GET", object_key, self.signed_url_expires)

        if self.public_base_url:
            return f"{self.public_base_url.rstrip('/')}/{object_key}"

        endpoint = self._strip_scheme(self.endpoint)
        return f"https://{self.bucket_name}.{endpoint}/{object_key}"

    @staticmethod
    def _strip_scheme(endpoint: str) -> str:
        if endpoint.startswith("https://"):
            return endpoint[len("https://"):]
        if endpoint.startswith("http://"):
            return endpoint[len("http://"):]
        return endpoint

    def _normalize_endpoint(self, endpoint: str) -> str:
        if endpoint.startswith("http://") or endpoint.startswith("https://"):
            return endpoint
        return f"https://{endpoint}"


oss_uploader = OSSUploader()
