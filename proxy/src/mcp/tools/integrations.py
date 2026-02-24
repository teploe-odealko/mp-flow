from fastapi import HTTPException
from proxy.src.mcp import get_mcp
from proxy.src.mcp.deps import get_deps
from proxy.src.mcp.errors import mcp_error_handler, serialize_result
from proxy.src.repositories.admin.base import safe_fetch, safe_fetchone

mcp = get_mcp()


@mcp.tool()
@mcp_error_handler
async def integrations_ozon_list_accounts() -> str:
    """List Ozon accounts (credentials stored encrypted). Returns masked API keys."""
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        rows = await safe_fetch(
            conn,
            """SELECT id, name, client_id, is_active, is_default, created_at
               FROM admin_ozon_accounts WHERE user_id = $1 ORDER BY created_at""",
            deps.user_id,
        )
    items = [
        {
            "id": str(r["id"]),
            "name": r["name"],
            "client_id": r["client_id"],
            "is_active": r["is_active"],
            "is_default": r["is_default"],
            "created_at": str(r["created_at"]),
        }
        for r in (rows or [])
    ]
    return serialize_result({"accounts": items})


@mcp.tool()
@mcp_error_handler
async def integrations_ozon_create_account(
    name: str, client_id: str, api_key: str, is_default: bool = False
) -> str:
    """Create a new Ozon account with encrypted credentials.

    Args:
        name: Account name (e.g. 'Main store').
        client_id: Ozon Client-Id.
        api_key: Ozon Api-Key (will be encrypted at rest).
        is_default: Set as default account.
    """
    from proxy.src.config import settings

    deps = get_deps()
    enc_key = settings.hmac_secret
    async with deps.pool.acquire() as conn:
        if is_default:
            await conn.execute(
                "UPDATE admin_ozon_accounts SET is_default = FALSE WHERE user_id = $1",
                deps.user_id,
            )
        row = await conn.fetchrow(
            """INSERT INTO admin_ozon_accounts
               (user_id, name, client_id, api_key_enc, is_active, is_default)
               VALUES ($1, $2, $3, pgp_sym_encrypt($4, $5), TRUE, $6)
               RETURNING id, name, client_id, is_active, is_default, created_at""",
            deps.user_id,
            name,
            client_id,
            api_key,
            enc_key,
            is_default,
        )
    if not row:
        raise HTTPException(status_code=500, detail="Failed to create Ozon account")
    return serialize_result(
        {
            "id": str(row["id"]),
            "name": row["name"],
            "client_id": row["client_id"],
            "is_active": row["is_active"],
            "is_default": row["is_default"],
        }
    )


@mcp.tool()
@mcp_error_handler
async def integrations_ozon_update_account(
    account_id: str,
    name: str = "",
    is_active: bool = True,
    is_default: bool = False,
) -> str:
    """Update an Ozon account (name, active status, default flag).

    Args:
        account_id: UUID of the Ozon account.
        name: Updated name. Empty = no change.
        is_active: Account active status.
        is_default: Set as default account.
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        existing = await safe_fetchone(
            conn,
            "SELECT id FROM admin_ozon_accounts WHERE id = $1 AND user_id = $2",
            account_id,
            deps.user_id,
        )
        if not existing:
            raise HTTPException(status_code=404, detail="Ozon account not found")

        if is_default:
            await conn.execute(
                "UPDATE admin_ozon_accounts SET is_default = FALSE WHERE user_id = $1",
                deps.user_id,
            )

        updates = ["is_active = $3", "is_default = $4"]
        params = [account_id, deps.user_id, is_active, is_default]
        if name:
            updates.append(f"name = ${len(params) + 1}")
            params.append(name)

        await conn.execute(
            f"UPDATE admin_ozon_accounts SET {', '.join(updates)} WHERE id = $1 AND user_id = $2",
            *params,
        )
    return serialize_result({"updated": True, "account_id": account_id})


@mcp.tool()
@mcp_error_handler
async def integrations_ozon_delete_account(account_id: str) -> str:
    """Delete an Ozon account.

    Args:
        account_id: UUID of the Ozon account.
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM admin_ozon_accounts WHERE id = $1 AND user_id = $2",
            account_id,
            deps.user_id,
        )
    deleted = result and "DELETE 1" in str(result)
    if not deleted:
        raise HTTPException(status_code=404, detail="Ozon account not found")
    return serialize_result({"deleted": True, "account_id": account_id})
