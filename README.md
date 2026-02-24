# OpenMPFlow

Open-source ERP for Ozon FBO sellers. Manage your catalog, procurement, analytics, logistics, and finances in one place.

## Quick Start

```bash
git clone https://github.com/teploe-odealko/mp-flow.git
cd mp-flow
cp .env.example .env
docker compose up --build
```

Open **http://localhost:3000** and log in with:
- Username: `admin`
- Password: `admin`

That's it. You have a fully working ERP with PostgreSQL, API server, and admin UI.

## What You Get

- **Catalog** — master product cards with SKU, dimensions, pricing, supplier data
- **Procurement** — supplier orders with shared cost allocation (logistics, customs, etc.)
- **Analytics** — unit economics, P&L by product, FIFO cost tracking
- **Logistics** — SKU matrix (where stock is now), Ozon supply orders
- **Finance** — transaction ledger, cash flow (DDS) report
- **Plugin System** — extensible architecture (see below)
- **MCP Server** — 54 AI tools for Claude, ChatGPT, and other MCP clients

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│  Admin UI   │────>│   Proxy     │────>│  PostgreSQL   │
│ (port 3000) │     │ (port 8000) │     │  (port 5432)  │
└─────────────┘     └─────────────┘     └──────────────┘
   nginx SPA         FastAPI + MCP        Data storage
```

- **Admin UI** — vanilla JS SPA served by nginx, proxies API requests to Proxy.
- **Proxy** — FastAPI server with Admin API, MCP server (54 tools), plugin system.
- **PostgreSQL** — all data, with automatic migration on first run.

## Optional Integrations

Edit `.env` to enable:

| Integration | Env Vars | What It Does |
|-------------|----------|--------------|
| **Ozon Seller API** | `OZON_CLIENT_ID`, `OZON_API_KEY` | Sync products, stocks, sales, returns from Ozon |
| **1688 Suppliers** | `TMAPI_API_TOKEN` | Import supplier data (prices, photos, SKU) via ali1688 plugin |
| **AI Features** | `ANTHROPIC_API_KEY` | AI-powered tools in MCP server |
| **SSO (Logto)** | `LOGTO_ENDPOINT`, `LOGTO_API_RESOURCE` | OIDC/OAuth2 authentication |

## Plugin System

Plugins extend the UI and API. They are discovered automatically from `proxy/src/plugins/*/manifest.json`.

**Included plugin: ali1688** — adds a "1688 Supplier" tab to product cards for importing supplier data from 1688.com.

Each plugin can:
- Add tabs to product card pages
- Add new sections to the sidebar
- Register API endpoints at `/v1/admin/plugins/{name}/`
- Store data in isolated PostgreSQL schemas (`plugin_{name}`)
- Expose MCP tools for AI clients

## Development

```bash
# Run proxy locally
cd proxy && pip install -r requirements.txt
uvicorn proxy.src.main:app --reload --port 8000

# Lint
ruff check proxy/ && ruff format proxy/

# Tests
PYTHONPATH=. pytest tests/admin/ -v
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for full guidelines.

## Updating

```bash
git pull
docker compose up --build -d
```

Migrations are applied automatically on container start.

## License

The core project is licensed under [AGPL-3.0](LICENSE).

Enterprise features in `proxy/src/ee/` are under a separate license — see [ee/LICENSE](ee/LICENSE).
