"""
Demand planning service — generates supply plans based on Ozon cluster analytics.

Two-horizon algorithm:
  lead_time = days until supplier order arrives (default 45)
  buffer    = days of stock to maintain AFTER arrival (default 60)
  total_horizon = lead_time + buffer = 105 days

Per-cluster calculation:
  1. stock_at_arrival = max(0, available + in_transit - lead_time * ads)
     → projected stock when our order arrives
  2. need = buffer * ads
     → how much we need to cover the buffer period
  3. gap = max(0, need - stock_at_arrival)
     → shortfall per cluster

Total order:
  raw = max(0, sum(gaps) - stock_at_home - pipeline_from_supplier)
  → round up to pack_size, apply MOQ
"""

from __future__ import annotations

import json
import logging
import math
from decimal import Decimal
from typing import Any

import asyncpg

logger = logging.getLogger(__name__)


async def generate_supply_plan(
    conn: asyncpg.Connection,
    user_id: str,
    lead_time_days: int = 45,
    buffer_days: int = 60,
) -> dict[str, Any]:
    """
    Generate a demand-based supply plan for all active SKUs.

    Two-horizon planning:
      - lead_time_days: days until goods arrive from supplier (default 45)
      - buffer_days: days of stock to maintain after arrival (default 60)
    """
    uid = user_id

    # 1. Load cluster stock data (latest sync)
    cluster_rows = await conn.fetch(
        """
        SELECT ocs.*, mc.id AS mc_id, mc.title AS card_title, mc.sku AS card_sku
        FROM ozon_cluster_stock ocs
        LEFT JOIN master_cards mc ON mc.id = ocs.master_card_id
        WHERE ocs.user_id = $1
        ORDER BY ocs.ozon_sku, ocs.cluster_id
        """,
        uid,
    )

    # 2. Load planning params
    params_rows = await conn.fetch(
        "SELECT * FROM supply_planning_params WHERE user_id = $1 AND enabled = TRUE",
        uid,
    )
    params_by_card: dict[str, dict[str, Any]] = {}
    for p in params_rows:
        if p["master_card_id"]:
            params_by_card[str(p["master_card_id"])] = dict(p)

    # 3. Load cluster targets (manual estimates for new clusters)
    target_rows = await conn.fetch(
        "SELECT * FROM supply_cluster_targets WHERE user_id = $1 AND enabled = TRUE",
        uid,
    )
    targets_by_card_cluster: dict[str, dict[int, dict[str, Any]]] = {}
    for t in target_rows:
        cid = str(t["master_card_id"])
        targets_by_card_cluster.setdefault(cid, {})[t["cluster_id"]] = dict(t)

    # 4. Load pipeline: pending supplier orders
    pipeline_supplier = await conn.fetch(
        """
        SELECT soi.master_card_id, SUM(soi.quantity - COALESCE(soi.received_qty, 0)) AS pending_qty
        FROM supplier_order_items soi
        JOIN supplier_orders so ON so.id = soi.supplier_order_id
        WHERE so.user_id = $1 AND so.status IN ('draft', 'pending', 'in_transit')
        GROUP BY soi.master_card_id
        """,
        user_id,
    )
    pipeline_supplier_map: dict[str, int] = {}
    for r in pipeline_supplier:
        if r["master_card_id"]:
            pipeline_supplier_map[str(r["master_card_id"])] = int(r["pending_qty"] or 0)

    # 5. Load pipeline: Ozon supplies in transit (not yet accepted)
    pipeline_ozon = await conn.fetch(
        """
        SELECT osi.master_card_id, SUM(osi.quantity_planned) AS in_transit_qty
        FROM ozon_supply_items osi
        JOIN ozon_supplies os ON os.id = osi.ozon_supply_id
        WHERE os.user_id = $1
          AND os.status NOT IN ('COMPLETED', 'CANCELLED', 'REJECTED_AT_SUPPLY_WAREHOUSE')
          AND os.warehouse_deducted = TRUE
        GROUP BY osi.master_card_id
        """,
        user_id,
    )
    pipeline_ozon_map: dict[str, int] = {}
    for r in pipeline_ozon:
        if r["master_card_id"]:
            pipeline_ozon_map[str(r["master_card_id"])] = int(r["in_transit_qty"] or 0)

    # 6. Load home stock (warehouse_qty from master_cards)
    home_stock_rows = await conn.fetch(
        """
        SELECT id, warehouse_qty
        FROM master_cards
        WHERE user_id = $1 AND status != 'archived'
        """,
        user_id,
    )
    home_stock_map: dict[str, int] = {}
    for r in home_stock_rows:
        home_stock_map[str(r["id"])] = int(r["warehouse_qty"] or 0)

    # Group cluster rows by master_card_id
    clusters_by_card: dict[str, list[dict[str, Any]]] = {}
    card_meta: dict[str, dict[str, Any]] = {}
    for row in cluster_rows:
        card_id = str(row["mc_id"]) if row["mc_id"] else None
        if not card_id:
            continue
        clusters_by_card.setdefault(card_id, []).append(dict(row))
        if card_id not in card_meta:
            card_meta[card_id] = {
                "title": row["card_title"],
                "sku": row["card_sku"],
                "ads_global": float(row["ads_global"]) if row["ads_global"] else None,
                "idc_global": row["idc_global"],
                "turnover_global": row["turnover_global"],
            }

    # 7. Calculate per-card plan items
    plan_items: list[dict[str, Any]] = []

    for card_id, cluster_data in clusters_by_card.items():
        params = params_by_card.get(card_id, {})
        safety_qty = params.get("safety_stock_qty") or 0
        moq = max(1, params.get("moq") or 1)
        pack_size = max(1, params.get("pack_size") or 1)

        manual_targets = targets_by_card_cluster.get(card_id, {})

        meta = card_meta.get(card_id, {})
        stock_at_home = home_stock_map.get(card_id, 0)
        pipeline_from_supplier = pipeline_supplier_map.get(card_id, 0)
        pipeline_to_ozon = pipeline_ozon_map.get(card_id, 0)

        # Aggregate cluster-level data (deduplicate by cluster_id, sum warehouses)
        cluster_agg: dict[int, dict[str, Any]] = {}
        for row in cluster_data:
            cid = row["cluster_id"]
            if cid not in cluster_agg:
                cluster_agg[cid] = {
                    "cluster_id": cid,
                    "cluster_name": row["cluster_name"],
                    "ads": float(row["ads_cluster"]) if row["ads_cluster"] else 0,
                    "idc": row["idc_cluster"],
                    "turnover": row["turnover_cluster"],
                    "available": 0,
                    "in_transit": 0,
                    "source": "ozon",
                }
            cluster_agg[cid]["available"] += row["available"] or 0
            cluster_agg[cid]["in_transit"] += row["in_transit"] or 0

        # Add manual targets for clusters not in Ozon data
        for cid, target in manual_targets.items():
            if cid not in cluster_agg:
                est_daily = float(target.get("estimated_daily_sales") or 0)
                if est_daily > 0:
                    cluster_agg[cid] = {
                        "cluster_id": cid,
                        "cluster_name": target.get("cluster_name") or "",
                        "ads": est_daily,
                        "idc": None,
                        "turnover": None,
                        "available": 0,
                        "in_transit": 0,
                        "source": "manual",
                    }

        # Per-cluster TWO-HORIZON gap calculation
        cluster_breakdown: list[dict[str, Any]] = []
        total_gap = 0
        stock_on_ozon = 0

        for cid, ca in sorted(cluster_agg.items()):
            ads = ca["ads"] or 0

            # How much stock depletes during lead_time
            depletion = int(math.ceil(lead_time_days * ads))
            current_stock = ca["available"] + ca["in_transit"]
            stock_at_arrival = max(0, current_stock - depletion)

            # How much we need for buffer period after arrival
            need = int(math.ceil(buffer_days * ads)) + safety_qty
            gap = max(0, need - stock_at_arrival)

            stock_on_ozon += ca["available"]

            cluster_breakdown.append(
                {
                    "cluster_id": cid,
                    "cluster_name": ca["cluster_name"],
                    "ads": ads,
                    "idc": ca["idc"],
                    "turnover": ca["turnover"],
                    "available": ca["available"],
                    "in_transit": ca["in_transit"],
                    "depletion": depletion,
                    "stock_at_arrival": stock_at_arrival,
                    "need": need,
                    "gap": gap,
                    "source": ca["source"],
                }
            )
            total_gap += gap

        # Total order calculation
        raw_order = max(0, total_gap - stock_at_home - pipeline_from_supplier)

        # Round up to pack_size
        if raw_order > 0 and pack_size > 1:
            recommended_qty = math.ceil(raw_order / pack_size) * pack_size
        else:
            recommended_qty = raw_order

        # Apply MOQ
        if recommended_qty > 0 and recommended_qty < moq:
            recommended_qty = moq

        plan_items.append(
            {
                "master_card_id": card_id,
                "title": meta.get("title"),
                "sku": meta.get("sku"),
                "ads_global": meta.get("ads_global"),
                "idc_global": meta.get("idc_global"),
                "turnover_global": meta.get("turnover_global"),
                "stock_on_ozon": stock_on_ozon,
                "stock_at_home": stock_at_home,
                "pipeline_supplier": pipeline_from_supplier,
                "pipeline_ozon": pipeline_to_ozon,
                "cluster_breakdown": cluster_breakdown,
                "total_gap": total_gap,
                "recommended_qty": recommended_qty,
                "adjusted_qty": recommended_qty,
                "target_stock_days": buffer_days,
            }
        )

    # Sort: highest gap first, then by IDC ascending (most urgent)
    plan_items.sort(key=lambda x: (-x["total_gap"], x.get("idc_global") or 999))

    # Create supply_plan record
    total_items = sum(1 for i in plan_items if i["recommended_qty"] > 0)
    total_qty = sum(i["recommended_qty"] for i in plan_items)

    plan_row = await conn.fetchrow(
        """
        INSERT INTO supply_plans (user_id, status, lead_time_days, buffer_days, total_items, total_qty)
        VALUES ($1, 'draft', $2, $3, $4, $5)
        RETURNING id, created_at
        """,
        uid,
        lead_time_days,
        buffer_days,
        total_items,
        total_qty,
    )
    if not plan_row:
        raise RuntimeError("Failed to create supply plan")
    plan_id = plan_row["id"]
    created_at = plan_row["created_at"]

    # Insert plan items
    for item in plan_items:
        await conn.execute(
            """
            INSERT INTO supply_plan_items (
                plan_id, master_card_id,
                ads_global, idc_global, turnover_global,
                stock_on_ozon, stock_at_home, pipeline_supplier, pipeline_ozon,
                cluster_breakdown,
                total_gap, recommended_qty, adjusted_qty, target_stock_days
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
            )
            """,
            plan_id,
            item["master_card_id"],
            Decimal(str(item["ads_global"])) if item["ads_global"] else None,
            item["idc_global"],
            item["turnover_global"],
            item["stock_on_ozon"],
            item["stock_at_home"],
            item["pipeline_supplier"],
            item["pipeline_ozon"],
            json.dumps(item["cluster_breakdown"]),
            item["total_gap"],
            item["recommended_qty"],
            item["adjusted_qty"],
            item["target_stock_days"],
        )

    # Get synced_at from cluster stock
    synced_row = await conn.fetchrow(
        "SELECT MAX(synced_at) AS last_sync FROM ozon_cluster_stock WHERE user_id = $1",
        uid,
    )
    last_sync = synced_row["last_sync"] if synced_row else None

    return {
        "plan_id": plan_id,
        "created_at": created_at.isoformat() if created_at else None,
        "status": "draft",
        "lead_time_days": lead_time_days,
        "buffer_days": buffer_days,
        "total_items": total_items,
        "total_qty": total_qty,
        "data_synced_at": last_sync.isoformat() if last_sync else None,
        "items": plan_items,
    }


async def get_supply_plan(
    conn: asyncpg.Connection,
    user_id: str,
    plan_id: int,
) -> dict[str, Any] | None:
    """Load a supply plan with all items."""
    plan = await conn.fetchrow(
        "SELECT * FROM supply_plans WHERE id = $1 AND user_id = $2",
        plan_id,
        user_id,
    )
    if not plan:
        return None

    items = await conn.fetch(
        """
        SELECT spi.*, mc.title AS card_title, mc.sku AS card_sku
        FROM supply_plan_items spi
        LEFT JOIN master_cards mc ON mc.id = spi.master_card_id
        WHERE spi.plan_id = $1
        ORDER BY spi.total_gap DESC
        """,
        plan_id,
    )

    return {
        "plan_id": plan["id"],
        "created_at": plan["created_at"].isoformat() if plan["created_at"] else None,
        "status": plan["status"],
        "lead_time_days": plan["lead_time_days"],
        "buffer_days": plan.get("buffer_days") or 60,
        "total_items": plan["total_items"],
        "total_qty": plan["total_qty"],
        "notes": plan["notes"],
        "items": [
            {
                "id": item["id"],
                "master_card_id": str(item["master_card_id"]) if item["master_card_id"] else None,
                "title": item["card_title"],
                "sku": item["card_sku"],
                "ads_global": float(item["ads_global"]) if item["ads_global"] else None,
                "idc_global": item["idc_global"],
                "turnover_global": item["turnover_global"],
                "stock_on_ozon": item["stock_on_ozon"],
                "stock_at_home": item["stock_at_home"],
                "pipeline_supplier": item["pipeline_supplier"],
                "pipeline_ozon": item["pipeline_ozon"],
                "cluster_breakdown": json.loads(item["cluster_breakdown"])
                if isinstance(item["cluster_breakdown"], str)
                else item["cluster_breakdown"],
                "total_gap": item["total_gap"],
                "recommended_qty": item["recommended_qty"],
                "adjusted_qty": item["adjusted_qty"],
                "target_stock_days": item["target_stock_days"],
            }
            for item in items
        ],
    }


async def list_supply_plans(
    conn: asyncpg.Connection,
    user_id: str,
    lq: Any | None = None,
    status_filter: str | None = None,
) -> dict[str, Any] | list[dict[str, Any]]:
    """List supply plans for user with optional pagination/sort."""
    from proxy.src.routes.admin.list_query import ListQuery, WhereBuilder, list_response

    if lq is not None and isinstance(lq, ListQuery):
        wb = WhereBuilder()
        wb.exact("user_id", user_id)
        wb.exact_optional("status", status_filter)
        wb.ilike("notes", lq.q)

        where_sql, params = wb.build()

        total_row = await conn.fetchrow(
            f"SELECT COUNT(*) AS total FROM supply_plans {where_sql}",
            *params,
        )
        total = int(total_row["total"]) if total_row else 0

        limit_idx = len(params) + 1
        offset_idx = len(params) + 2

        rows = await conn.fetch(
            f"""
            SELECT id, created_at, status, lead_time_days,
                   COALESCE(buffer_days, 60) AS buffer_days,
                   total_items, total_qty, notes
            FROM supply_plans
            {where_sql}
            ORDER BY created_at {lq.sort_dir}
            LIMIT ${limit_idx} OFFSET ${offset_idx}
            """,
            *params,
            lq.limit,
            lq.offset,
        )
        plans = [
            {
                "plan_id": r["id"],
                "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                "status": r["status"],
                "lead_time_days": r["lead_time_days"],
                "buffer_days": r["buffer_days"],
                "total_items": r["total_items"],
                "total_qty": r["total_qty"],
                "notes": r["notes"],
            }
            for r in rows
        ]
        return list_response(plans, total, lq)

    # Legacy path (no ListQuery)
    if status_filter:
        rows = await conn.fetch(
            """
            SELECT id, created_at, status, lead_time_days,
                   COALESCE(buffer_days, 60) AS buffer_days,
                   total_items, total_qty, notes
            FROM supply_plans
            WHERE user_id = $1 AND status = $2
            ORDER BY created_at DESC
            """,
            user_id,
            status_filter,
        )
    else:
        rows = await conn.fetch(
            """
            SELECT id, created_at, status, lead_time_days,
                   COALESCE(buffer_days, 60) AS buffer_days,
                   total_items, total_qty, notes
            FROM supply_plans
            WHERE user_id = $1
            ORDER BY created_at DESC
            """,
            user_id,
        )
    return [
        {
            "plan_id": r["id"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "status": r["status"],
            "lead_time_days": r["lead_time_days"],
            "buffer_days": r["buffer_days"],
            "total_items": r["total_items"],
            "total_qty": r["total_qty"],
            "notes": r["notes"],
        }
        for r in rows
    ]


async def update_plan_item_qty(
    conn: asyncpg.Connection,
    user_id: str,
    plan_id: int,
    item_id: int,
    adjusted_qty: int,
) -> dict[str, Any] | None:
    """Update adjusted_qty for a plan item."""
    row = await conn.fetchrow(
        """
        UPDATE supply_plan_items spi
        SET adjusted_qty = $3
        FROM supply_plans sp
        WHERE spi.id = $1 AND spi.plan_id = sp.id AND sp.id = $4 AND sp.user_id = $2
        RETURNING spi.id, spi.adjusted_qty, spi.recommended_qty, spi.target_stock_days
        """,
        item_id,
        user_id,
        adjusted_qty,
        plan_id,
    )
    if not row:
        return None
    return dict(row)


async def confirm_plan(
    conn: asyncpg.Connection,
    user_id: str,
    plan_id: int,
) -> dict[str, Any] | None:
    """Confirm a draft plan (mark as confirmed)."""
    row = await conn.fetchrow(
        """
        UPDATE supply_plans
        SET status = 'confirmed'
        WHERE id = $1 AND user_id = $2 AND status = 'draft'
        RETURNING id, status
        """,
        plan_id,
        user_id,
    )
    if not row:
        return None
    return {"plan_id": row["id"], "status": row["status"]}


async def get_planning_params(
    conn: asyncpg.Connection,
    user_id: str,
) -> list[dict[str, Any]]:
    """Get planning params for all SKUs."""
    rows = await conn.fetch(
        """
        SELECT spp.*, mc.title, mc.sku
        FROM supply_planning_params spp
        LEFT JOIN master_cards mc ON mc.id = spp.master_card_id
        WHERE spp.user_id = $1
        ORDER BY mc.title
        """,
        user_id,
    )
    return [
        {
            "id": r["id"],
            "master_card_id": str(r["master_card_id"]) if r["master_card_id"] else None,
            "title": r["title"],
            "sku": r["sku"],
            "target_stock_days": r["target_stock_days"],
            "safety_stock_qty": r["safety_stock_qty"],
            "supplier_lead_days": r["supplier_lead_days"],
            "moq": r["moq"],
            "pack_size": r["pack_size"],
            "enabled": r["enabled"],
        }
        for r in rows
    ]


async def upsert_planning_params(
    conn: asyncpg.Connection,
    user_id: str,
    master_card_id: str,
    params: dict[str, Any],
) -> dict[str, Any]:
    """Create or update planning params for a SKU."""
    row = await conn.fetchrow(
        """
        INSERT INTO supply_planning_params (
            user_id, master_card_id,
            target_stock_days, safety_stock_qty, supplier_lead_days, moq, pack_size, enabled
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (user_id, master_card_id) DO UPDATE SET
            target_stock_days = EXCLUDED.target_stock_days,
            safety_stock_qty = EXCLUDED.safety_stock_qty,
            supplier_lead_days = EXCLUDED.supplier_lead_days,
            moq = EXCLUDED.moq,
            pack_size = EXCLUDED.pack_size,
            enabled = EXCLUDED.enabled
        RETURNING *
        """,
        user_id,
        master_card_id,
        params.get("target_stock_days", 45),
        params.get("safety_stock_qty", 0),
        params.get("supplier_lead_days", 45),
        params.get("moq", 1),
        params.get("pack_size", 1),
        params.get("enabled", True),
    )
    return dict(row) if row else {}


async def get_cluster_targets(
    conn: asyncpg.Connection,
    user_id: str,
) -> list[dict[str, Any]]:
    """Get cluster targets for all SKUs."""
    rows = await conn.fetch(
        """
        SELECT sct.*, mc.title, mc.sku
        FROM supply_cluster_targets sct
        LEFT JOIN master_cards mc ON mc.id = sct.master_card_id
        WHERE sct.user_id = $1
        ORDER BY mc.title, sct.cluster_id
        """,
        user_id,
    )
    return [
        {
            "id": r["id"],
            "master_card_id": str(r["master_card_id"]) if r["master_card_id"] else None,
            "title": r["title"],
            "sku": r["sku"],
            "cluster_id": r["cluster_id"],
            "cluster_name": r["cluster_name"],
            "estimated_daily_sales": float(r["estimated_daily_sales"])
            if r["estimated_daily_sales"]
            else None,
            "initial_stock_target": r["initial_stock_target"],
            "target_stock_days": r["target_stock_days"],
            "enabled": r["enabled"],
        }
        for r in rows
    ]


async def upsert_cluster_target(
    conn: asyncpg.Connection,
    user_id: str,
    master_card_id: str,
    cluster_id: int,
    params: dict[str, Any],
) -> dict[str, Any]:
    """Create or update a cluster target."""
    row = await conn.fetchrow(
        """
        INSERT INTO supply_cluster_targets (
            user_id, master_card_id, cluster_id, cluster_name,
            estimated_daily_sales, initial_stock_target, target_stock_days, enabled
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (user_id, master_card_id, cluster_id) DO UPDATE SET
            cluster_name = EXCLUDED.cluster_name,
            estimated_daily_sales = EXCLUDED.estimated_daily_sales,
            initial_stock_target = EXCLUDED.initial_stock_target,
            target_stock_days = EXCLUDED.target_stock_days,
            enabled = EXCLUDED.enabled
        RETURNING *
        """,
        user_id,
        master_card_id,
        cluster_id,
        params.get("cluster_name"),
        params.get("estimated_daily_sales"),
        params.get("initial_stock_target"),
        params.get("target_stock_days", 45),
        params.get("enabled", True),
    )
    return dict(row) if row else {}
