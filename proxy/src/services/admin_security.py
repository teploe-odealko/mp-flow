"""
Security helpers for admin authentication.

Implements:
- password hashing/verification (scrypt)
- stateless signed admin tokens (HMAC-SHA256)
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass
from typing import Any

DEFAULT_SCRYPT_N = 2**14
DEFAULT_SCRYPT_R = 8
DEFAULT_SCRYPT_P = 1
DEFAULT_DKLEN = 32


@dataclass(slots=True)
class AdminTokenClaims:
    """Decoded token payload."""

    user_id: str
    username: str
    is_admin: bool
    exp: int


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    padded = value + "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(padded.encode("ascii"))


def hash_password(
    password: str,
    *,
    n: int = DEFAULT_SCRYPT_N,
    r: int = DEFAULT_SCRYPT_R,
    p: int = DEFAULT_SCRYPT_P,
    dklen: int = DEFAULT_DKLEN,
) -> str:
    """Hash password using scrypt with random salt."""
    if not password:
        raise ValueError("Password cannot be empty")

    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=dklen)
    return "scrypt${n}${r}${p}${salt}${digest}".format(
        n=n,
        r=r,
        p=p,
        salt=_b64url_encode(salt),
        digest=_b64url_encode(digest),
    )


def verify_password(password: str, encoded_hash: str) -> bool:
    """Verify password against scrypt-encoded hash."""
    if not password or not encoded_hash:
        return False

    try:
        algorithm, n_s, r_s, p_s, salt_s, digest_s = encoded_hash.split("$", 5)
        if algorithm != "scrypt":
            return False
        n, r, p = int(n_s), int(r_s), int(p_s)
        salt = _b64url_decode(salt_s)
        expected = _b64url_decode(digest_s)
        actual = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=n,
            r=r,
            p=p,
            dklen=len(expected),
        )
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def create_admin_token(
    *,
    secret: str,
    user_id: str,
    username: str,
    is_admin: bool,
    ttl_seconds: int,
) -> str:
    """Create signed token for admin UI."""
    if ttl_seconds <= 0:
        raise ValueError("ttl_seconds must be > 0")

    payload = {
        "uid": user_id,
        "usr": username,
        "adm": bool(is_admin),
        "exp": int(time.time()) + int(ttl_seconds),
    }
    payload_part = _b64url_encode(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    signature = hmac.new(
        secret.encode("utf-8"),
        msg=f"admin:{payload_part}".encode("utf-8"),
        digestmod=hashlib.sha256,
    ).hexdigest()
    return f"{payload_part}.{signature}"


def decode_admin_token(
    *,
    secret: str,
    token: str,
    now_ts: int | None = None,
) -> AdminTokenClaims:
    """Decode and verify signed admin token."""
    if not token or "." not in token:
        raise ValueError("Invalid token format")

    payload_part, signature = token.split(".", 1)
    expected = hmac.new(
        secret.encode("utf-8"),
        msg=f"admin:{payload_part}".encode("utf-8"),
        digestmod=hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise ValueError("Invalid token signature")

    try:
        payload = json.loads(_b64url_decode(payload_part))
    except Exception as exc:
        raise ValueError("Invalid token payload") from exc

    user_id = str(payload.get("uid") or "")
    username = str(payload.get("usr") or "")
    is_admin = bool(payload.get("adm", False))
    exp = int(payload.get("exp") or 0)
    current_ts = int(now_ts if now_ts is not None else time.time())
    if not user_id or not username or exp <= current_ts:
        raise ValueError("Token expired or malformed")

    return AdminTokenClaims(
        user_id=user_id,
        username=username,
        is_admin=is_admin,
        exp=exp,
    )


def mask_secret(value: str) -> str:
    """Mask secret value for logs."""
    if not value:
        return ""
    if len(value) <= 8:
        return "***"
    return f"{value[:4]}***{value[-4:]}"


def sanitize_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Mask known secret keys in payload copy."""
    secret_keys = {"password", "api_key", "client_secret", "token"}
    out: dict[str, Any] = {}
    for key, value in payload.items():
        if key.lower() in secret_keys and isinstance(value, str):
            out[key] = mask_secret(value)
        else:
            out[key] = value
    return out
