from proxy.src.mcp import get_mcp
from proxy.src.mcp.deps import get_deps
from proxy.src.mcp.errors import mcp_error_handler, serialize_result
from proxy.src.services.admin import card_service

mcp = get_mcp()


@mcp.tool()
@mcp_error_handler
async def catalog_list(q: str = "", limit: int = 50, offset: int = 0) -> str:
    """List master cards with optional search by title/SKU/brand.

    Args:
        q: Search query (matches title, SKU, brand).
        limit: Max results (default 50).
        offset: Pagination offset.
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        result = await card_service.list_cards(
            conn,
            user_id=deps.user_id,
            q=q or None,
            include_archived=False,
            limit=min(limit, 200),
            offset=offset,
        )
    return serialize_result(result)


@mcp.tool()
@mcp_error_handler
async def catalog_get(card_id: str) -> str:
    """Get full card detail including FIFO lots and sales history.

    Args:
        card_id: UUID of the master card.
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        result = await card_service.get_card_detail(conn, card_id=card_id, user_id=deps.user_id)
    return serialize_result(result)


@mcp.tool()
@mcp_error_handler
async def catalog_create(
    title: str,
    sku: str = "",
    brand: str = "",
    description: str = "",
    ozon_product_id: str = "",
    ozon_offer_id: str = "",
    status: str = "active",
) -> str:
    """Create a new master card (product/SKU).

    Args:
        title: Product title (required).
        sku: Internal SKU code.
        brand: Brand name.
        description: Product description.
        ozon_product_id: Ozon product ID (if linked).
        ozon_offer_id: Ozon offer ID (if linked).
        status: Card status — 'active' or 'archived'.
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        result = await card_service.create_card(
            conn,
            user_id=deps.user_id,
            sku=sku or None,
            title=title,
            description=description or None,
            brand=brand or None,
            ozon_product_id=ozon_product_id or None,
            ozon_offer_id=ozon_offer_id or None,
            status=status,
            attributes={},
        )
    return serialize_result(result)


@mcp.tool()
@mcp_error_handler
async def catalog_update(card_id: str, fields: dict) -> str:
    """Update master card fields.

    Args:
        card_id: UUID of the master card.
        fields: Dict of fields to update. Keys: title, sku, brand, description,
                ozon_product_id, ozon_offer_id, status, attributes.
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        result = await card_service.update_card(
            conn,
            card_id=card_id,
            user_id=deps.user_id,
            fields=fields,
        )
    return serialize_result(result)


@mcp.tool()
@mcp_error_handler
async def catalog_preview_1688(url: str) -> str:
    """Preview a 1688.com product before importing. Returns title, images, SKUs, dimensions, prices.

    Args:
        url: Full 1688.com product URL.
    """
    result = await card_service.preview_1688(url)
    return serialize_result(result)


@mcp.tool()
@mcp_error_handler
async def catalog_import_1688(
    card_id: str,
    url: str,
    overwrite_title: bool = False,
    overwrite_dimensions: bool = False,
    selected_sku_id: str = "",
    selected_sku_price: float = 0,
) -> str:
    """Import 1688.com product data into an existing master card.

    Args:
        card_id: UUID of the master card to update.
        url: Full 1688.com product URL.
        overwrite_title: Replace card title with 1688 title.
        overwrite_dimensions: Overwrite existing dimensions.
        selected_sku_id: Specific SKU variant ID to select.
        selected_sku_price: Price of the selected SKU (CNY).
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        result = await card_service.import_1688(
            conn,
            card_id=card_id,
            user_id=deps.user_id,
            url=url,
            scene=None,
            optimize_title=None,
            overwrite_title=overwrite_title,
            overwrite_dimensions=overwrite_dimensions,
            selected_sku_id=selected_sku_id or None,
            selected_sku_price=selected_sku_price or None,
        )
    return serialize_result(result)
