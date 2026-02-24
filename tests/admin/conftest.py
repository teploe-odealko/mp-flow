from __future__ import annotations

import asyncio
import contextlib
import shutil
import socket
import subprocess
import time
from collections.abc import Generator
from pathlib import Path

import asyncpg
import pytest
from fastapi.testclient import TestClient

from proxy.src.config import settings
from proxy.src.main import create_app

ROOT_DIR = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = ROOT_DIR / "migrations"


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


async def _wait_for_db(dsn: str, timeout_sec: float = 25.0) -> None:
    deadline = time.time() + timeout_sec
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            conn = await asyncpg.connect(dsn=dsn)
            await conn.close()
            return
        except Exception as exc:  # noqa: PERF203
            last_error = exc
            await asyncio.sleep(0.5)
    if last_error:
        raise RuntimeError(f"Postgres did not become ready: {last_error}") from last_error
    raise RuntimeError("Postgres did not become ready")


def _apply_migrations(container_id: str) -> None:
    migration_files = [MIGRATIONS_DIR / "init.sql"] + sorted(
        path for path in MIGRATIONS_DIR.glob("*.sql") if path.name != "init.sql"
    )
    for migration in migration_files:
        sql = migration.read_bytes()
        subprocess.run(
            ["docker", "exec", "-i", container_id, "psql", "-U", "mpflow", "-d", "mpflow"],
            input=sql,
            check=True,
            capture_output=True,
        )


@pytest.fixture(scope="session")
def postgres_dsn() -> Generator[str, None, None]:
    if shutil.which("docker") is None:
        pytest.skip("Docker is required for admin API integration tests")

    port = _find_free_port()
    container_id = subprocess.check_output(
        [
            "docker",
            "run",
            "-d",
            "--rm",
            "-e",
            "POSTGRES_USER=mpflow",
            "-e",
            "POSTGRES_PASSWORD=mpflow",
            "-e",
            "POSTGRES_DB=mpflow",
            "-p",
            f"{port}:5432",
            "postgres:16-alpine",
        ],
        text=True,
    ).strip()
    dsn = f"postgresql://mpflow:mpflow@127.0.0.1:{port}/mpflow"

    try:
        asyncio.run(_wait_for_db(dsn))
        _apply_migrations(container_id)
        yield dsn
    finally:
        with contextlib.suppress(Exception):
            subprocess.run(["docker", "rm", "-f", container_id], check=False, capture_output=True)


@pytest.fixture
def admin_client(
    postgres_dsn: str, monkeypatch: pytest.MonkeyPatch
) -> Generator[TestClient, None, None]:
    old_database_url = settings.database_url
    old_hmac_secret = settings.hmac_secret
    old_bootstrap_username = settings.admin_bootstrap_username
    old_bootstrap_password = settings.admin_bootstrap_password
    old_ozon_client = settings.ozon_client_id
    old_ozon_key = settings.ozon_api_key

    settings.database_url = postgres_dsn
    settings.hmac_secret = "test-hmac-secret"
    settings.admin_bootstrap_username = "admin"
    settings.admin_bootstrap_password = "admin-strong-pass"
    settings.ozon_client_id = None
    settings.ozon_api_key = None

    async def _fake_usd_rate() -> float:
        return 90.0

    monkeypatch.setattr("proxy.src.main.get_usd_rate", _fake_usd_rate)

    # Reset MCP singleton so each test gets a fresh session manager
    import proxy.src.mcp as _mcp_mod

    _mcp_mod._mcp_instance = None

    try:
        app = create_app()
        with TestClient(app) as client:
            yield client
    finally:
        settings.database_url = old_database_url
        settings.hmac_secret = old_hmac_secret
        settings.admin_bootstrap_username = old_bootstrap_username
        settings.admin_bootstrap_password = old_bootstrap_password
        settings.ozon_client_id = old_ozon_client
        settings.ozon_api_key = old_ozon_key
