"""Ed25519-signed license key validation.

License key format: <base64url-payload>.<base64url-signature>

Payload (JSON):
    {
        "org": "Acme Corp",
        "plan": "pro",         # "pro" | "enterprise"
        "seats": 5,
        "iat": 1740000000,     # issued at (unix timestamp)
        "exp": 1771536000      # expires at (unix timestamp)
    }

Generate keys with: python scripts/generate_license.py keygen
Sign a license:     python scripts/generate_license.py sign --key <private> --org "Acme"
"""

from __future__ import annotations

import base64
import json
import logging
import os
import time

logger = logging.getLogger(__name__)

# Ed25519 public key for license verification.
# The matching private key is used by generate_license.py to sign keys.
# Replace this with your own key pair (run: python scripts/generate_license.py keygen)
LICENSE_PUBLIC_KEY_B64 = os.environ.get("OPENMPFLOW_LICENSE_PUBLIC_KEY", "")


def _b64url_decode(s: str) -> bytes:
    s += "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s)


class LicenseManager:
    """Validates and caches the license key from env or file."""

    def __init__(self) -> None:
        self._license: dict | None = None
        self._error: str | None = None
        self._load()

    def _load(self) -> None:
        key = os.environ.get("OPENMPFLOW_LICENSE_KEY", "").strip()
        if not key:
            for path in ["/etc/openmpflow/license.key", "license.key"]:
                try:
                    with open(path) as f:
                        key = f.read().strip()
                    if key:
                        break
                except FileNotFoundError:
                    continue

        if not key:
            logger.info("No license key found — running in Community mode")
            return

        result = self._validate(key)
        if result is None:
            logger.warning("Invalid license key — running in Community mode")
        else:
            self._license = result
            logger.info(
                "License loaded: org=%s plan=%s expires=%s",
                result.get("org", "?"),
                result.get("plan", "?"),
                time.strftime("%Y-%m-%d", time.gmtime(result.get("exp", 0))),
            )

    def _validate(self, key: str) -> dict | None:
        parts = key.split(".")
        if len(parts) != 2:
            self._error = "Invalid key format (expected payload.signature)"
            return None

        payload_b64, sig_b64 = parts

        # Decode payload
        try:
            payload_bytes = _b64url_decode(payload_b64)
            claims = json.loads(payload_bytes)
        except Exception:
            self._error = "Failed to decode license payload"
            return None

        # Verify signature (requires cryptography library)
        if LICENSE_PUBLIC_KEY_B64:
            try:
                from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

                pub_bytes = base64.b64decode(LICENSE_PUBLIC_KEY_B64)
                public_key = Ed25519PublicKey.from_public_bytes(pub_bytes)
                sig_bytes = _b64url_decode(sig_b64)
                public_key.verify(sig_bytes, payload_b64.encode())
            except ImportError:
                logger.warning("cryptography package not installed — skipping signature check")
            except Exception:
                self._error = "License signature verification failed"
                return None
        else:
            logger.warning("No public key configured — skipping signature verification")

        # Check expiry
        if claims.get("exp", 0) < time.time():
            self._error = "License expired"
            return None

        return claims

    def is_valid(self) -> bool:
        return self._license is not None and self._license.get("exp", 0) > time.time()

    def plan(self) -> str:
        if not self.is_valid():
            return "community"
        return self._license.get("plan", "community")

    def info(self) -> dict:
        if not self._license:
            return {"plan": "community", "error": self._error}
        lic = self._license
        return {
            "org": lic.get("org"),
            "plan": lic.get("plan"),
            "seats": lic.get("seats"),
            "issued_at": lic.get("iat"),
            "expires_at": lic.get("exp"),
        }
