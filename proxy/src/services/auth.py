import hashlib
import hmac

import asyncpg
from fastapi import HTTPException, Request, status
from proxy.src.config import settings


async def get_user_from_request(request: Request) -> str:
    """
    Extract and validate user token from request.

    Checks Authorization header (Bearer token) or x-api-key header.
    Returns telegram_id as user identifier.
    """
    # Try Authorization header first
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
    else:
        # Try x-api-key header
        token = request.headers.get("x-api-key", "")

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing authentication token"
        )

    return validate_user_token(token)


def validate_user_token(token: str) -> str:
    """
    Validate HMAC-signed token and extract telegram_id.

    Token format: telegram_id:hmac_signature

    Returns:
        telegram_id as string
    """
    if not token or ":" not in token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    telegram_id, signature = token.split(":", 1)
    expected = hmac.new(
        settings.hmac_secret.encode(),
        telegram_id.encode(),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    return telegram_id


async def get_user_id_from_telegram(pool: asyncpg.Pool, telegram_id: str) -> str:
    """
    Get user UUID from telegram_id.

    Creates user if not exists.

    Returns:
        User UUID as string
    """
    async with pool.acquire() as conn:
        # Try to get existing user
        row = await conn.fetchrow(
            "SELECT id FROM users WHERE telegram_id = $1",
            int(telegram_id),
        )

        if row:
            return str(row["id"])

        # Create new user if not exists
        row = await conn.fetchrow(
            """
            INSERT INTO users (telegram_id)
            VALUES ($1)
            ON CONFLICT (telegram_id) DO UPDATE SET telegram_id = EXCLUDED.telegram_id
            RETURNING id
            """,
            int(telegram_id),
        )

        user_uuid = str(row["id"])

        # Create wallet for new user
        await conn.execute(
            """
            INSERT INTO wallets (user_id, balance_kopecks)
            VALUES ($1, 10000)
            ON CONFLICT (user_id) DO NOTHING
            """,
            user_uuid,
        )

        return user_uuid
