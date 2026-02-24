# Contributing to OpenMPFlow

Thank you for your interest in contributing! This document will help you get started.

## Development Setup

```bash
git clone https://github.com/openmpflow/openmpflow.git
cd openmpflow
cp .env.example .env
docker compose up --build
```

Open http://localhost:3000, log in with `admin` / `admin`.

## Project Structure

```
proxy/           Python backend (FastAPI)
admin-ui/        Frontend SPA (vanilla JS, Tailwind CSS)
migrations/      PostgreSQL migrations (sequential SQL files)
proxy/src/plugins/  Plugin system
proxy/src/ee/    Premium features (see ee/LICENSE)
scripts/         Dev and CI scripts
tests/admin/     Integration tests (Docker Postgres)
```

## Code Style

Python code is linted with [ruff](https://github.com/astral-sh/ruff):

```bash
ruff check proxy/
ruff format proxy/
```

Config is in `proxy/pyproject.toml`: line-length 100, target Python 3.11.

## Running Tests

```bash
# Integration tests (spins up Docker Postgres)
PYTHONPATH=. pytest tests/admin/ -v
```

Tests use `asyncio_mode = "auto"`, no need for `@pytest.mark.asyncio`.

## Pull Requests

1. Fork the repo and create a branch: `git checkout -b feature/my-feature`
2. Make your changes
3. Run lint: `ruff check proxy/ && ruff format proxy/`
4. Run tests: `PYTHONPATH=. pytest tests/admin/ -v`
5. Open a PR against `main`

CI runs automatically: lint, format check, tests, migration verification.

## Migrations

- Files go in `migrations/` with sequential numbering (e.g., `027_my_feature.sql`)
- Use `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for idempotency
- Test with a fresh database: `docker compose down -v && docker compose up --build`
- The `scripts/init-db.sh` runner tracks applied migrations in `schema_migrations` table

## Plugins

Plugins extend the UI and API. See the `ali1688` plugin for a reference implementation:

```
proxy/src/plugins/ali1688/   Backend (manifest, routes, service)
admin-ui/plugins/ali1688/    Frontend (ESM module)
```

Plugins can be contributed as built-in (in this repo) or as separate repositories.

## EE Directory

Files in `proxy/src/ee/` and `ee/` are under a proprietary license (see `ee/LICENSE`).
Production use of EE features requires an active subscription.

You're welcome to contribute to EE code — by opening a PR that modifies EE files,
you agree to the terms in `ee/LICENSE`.

## Questions?

Open an issue on GitHub: https://github.com/openmpflow/openmpflow/issues
