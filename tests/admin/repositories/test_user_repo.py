from __future__ import annotations

import asyncio

import asyncpg

from proxy.src.repositories.admin.user_repo import (
    create_user,
    get_by_id,
    get_by_username,
    list_users,
    update_user,
)
from proxy.src.services.admin_security import hash_password


def _run(coro):
    return asyncio.run(coro)


async def _connect(dsn: str) -> asyncpg.Connection:
    return await asyncpg.connect(dsn=dsn)


def test_create_and_get_by_username(postgres_dsn: str) -> None:
    async def _test():
        conn = await _connect(postgres_dsn)
        try:
            row = await create_user(
                conn,
                username="repo-test-user",
                full_name="Repo Test",
                password_hash=hash_password("test-pass"),
                is_admin=False,
                is_active=True,
            )
            assert row is not None
            assert row["username"] == "repo-test-user"
            assert row["full_name"] == "Repo Test"

            found = await get_by_username(conn, username="repo-test-user")
            assert found is not None
            assert found["username"] == "repo-test-user"
            assert "password_hash" in found.keys()

            by_id = await get_by_id(conn, user_id=str(row["id"]))
            assert by_id is not None
            assert by_id["username"] == "repo-test-user"
        finally:
            await conn.close()

    _run(_test())


def test_list_users_returns_all(postgres_dsn: str) -> None:
    async def _test():
        conn = await _connect(postgres_dsn)
        try:
            rows = await list_users(conn)
            assert isinstance(rows, list)
            assert len(rows) >= 1
        finally:
            await conn.close()

    _run(_test())


def test_update_user_changes_fields(postgres_dsn: str) -> None:
    async def _test():
        conn = await _connect(postgres_dsn)
        try:
            row = await create_user(
                conn,
                username="repo-update-user",
                full_name="Before",
                password_hash=hash_password("test-pass"),
                is_admin=False,
                is_active=True,
            )
            assert row is not None

            updated = await update_user(
                conn,
                user_id=str(row["id"]),
                fields={"full_name": "After"},
            )
            assert updated is not None
            assert updated["full_name"] == "After"
        finally:
            await conn.close()

    _run(_test())


def test_update_user_returns_none_for_missing_id(postgres_dsn: str) -> None:
    async def _test():
        conn = await _connect(postgres_dsn)
        try:
            result = await update_user(
                conn,
                user_id="00000000-0000-0000-0000-000000000000",
                fields={"full_name": "nope"},
            )
            assert result is None
        finally:
            await conn.close()

    _run(_test())
