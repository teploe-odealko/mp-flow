-- ============================================================
-- MP-Flow ERP: Initial Schema
-- Merged from mpflow migrations 008 through 026
-- All Admin ERP tables with final column definitions
-- ============================================================

-- ============================================================
-- Extensions
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- Shared trigger function for updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at_admin_erp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Schema migrations tracking
-- ============================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 1. admin_users
-- Base: 008, columns added by: 009, 013, 016, 024
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(100) NOT NULL UNIQUE,
    full_name VARCHAR(255),
    password_hash TEXT NOT NULL,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    -- 009: Ozon integration credentials (plaintext, legacy)
    ozon_client_id VARCHAR(100),
    ozon_api_key TEXT,
    -- 016: Encrypted credentials (pgcrypto)
    ozon_client_id_enc BYTEA,
    ozon_api_key_enc BYTEA,
    -- 013: PnL tax rate setting
    usn_rate NUMERIC(5,2) DEFAULT 7.0,
    -- 024: Logto OIDC subject identifier
    logto_sub TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_logto_sub
    ON admin_users (logto_sub) WHERE logto_sub IS NOT NULL;

DROP TRIGGER IF EXISTS trg_admin_users_updated_at ON admin_users;
CREATE TRIGGER trg_admin_users_updated_at
BEFORE UPDATE ON admin_users
FOR EACH ROW EXECUTE FUNCTION set_updated_at_admin_erp();

-- ============================================================
-- 2. master_cards
-- Base: 008, columns added by: 015 (rename), 018, 026
-- ============================================================

CREATE TABLE IF NOT EXISTS master_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku VARCHAR(100),
    title TEXT NOT NULL,
    description TEXT,
    brand VARCHAR(200),
    ozon_product_id VARCHAR(100),
    ozon_offer_id VARCHAR(150),
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- 015: renamed from created_by
    user_id UUID REFERENCES admin_users(id),
    -- 018: physical warehouse stock counter
    warehouse_qty NUMERIC(14,3) NOT NULL DEFAULT 0,
    -- 026: Ozon category info for commission lookup
    ozon_category_name TEXT,
    ozon_product_type_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_master_cards_user_sku ON master_cards(user_id, sku);
CREATE INDEX IF NOT EXISTS idx_master_cards_title ON master_cards(title);
CREATE INDEX IF NOT EXISTS idx_master_cards_offer ON master_cards(ozon_offer_id);
CREATE INDEX IF NOT EXISTS idx_master_cards_user ON master_cards(user_id);

DROP TRIGGER IF EXISTS trg_master_cards_updated_at ON master_cards;
CREATE TRIGGER trg_master_cards_updated_at
BEFORE UPDATE ON master_cards
FOR EACH ROW EXECUTE FUNCTION set_updated_at_admin_erp();

-- ============================================================
-- 3. supplier_orders
-- Base: 008, columns added by: 010, 015 (rename)
-- ============================================================

CREATE TABLE IF NOT EXISTS supplier_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number VARCHAR(60) NOT NULL,
    supplier_name TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    currency VARCHAR(10) NOT NULL DEFAULT 'RUB',
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_date DATE,
    received_at TIMESTAMPTZ,
    notes TEXT,
    total_amount_rub NUMERIC(14, 2) NOT NULL DEFAULT 0,
    -- 015: renamed from created_by
    user_id UUID REFERENCES admin_users(id),
    -- 010: shared cost allocation
    shared_costs JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_orders_user_number ON supplier_orders(user_id, order_number);
CREATE INDEX IF NOT EXISTS idx_supplier_orders_status ON supplier_orders(status);
CREATE INDEX IF NOT EXISTS idx_supplier_orders_date ON supplier_orders(order_date DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_orders_user ON supplier_orders(user_id);

DROP TRIGGER IF EXISTS trg_supplier_orders_updated_at ON supplier_orders;
CREATE TRIGGER trg_supplier_orders_updated_at
BEFORE UPDATE ON supplier_orders
FOR EACH ROW EXECUTE FUNCTION set_updated_at_admin_erp();

-- ============================================================
-- 4. supplier_order_items
-- Base: 008, columns added by: 010, 012
-- ============================================================

CREATE TABLE IF NOT EXISTS supplier_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_order_id UUID NOT NULL REFERENCES supplier_orders(id) ON DELETE CASCADE,
    master_card_id UUID REFERENCES master_cards(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    quantity NUMERIC(14, 3) NOT NULL CHECK (quantity > 0),
    purchase_price_rub NUMERIC(14, 2) NOT NULL DEFAULT 0,
    packaging_cost_rub NUMERIC(14, 2) NOT NULL DEFAULT 0,
    logistics_cost_rub NUMERIC(14, 2) NOT NULL DEFAULT 0,
    customs_cost_rub NUMERIC(14, 2) NOT NULL DEFAULT 0,
    extra_cost_rub NUMERIC(14, 2) NOT NULL DEFAULT 0,
    unit_cost_rub NUMERIC(14, 2) NOT NULL DEFAULT 0,
    -- 010: allocation tracking
    cny_price_per_unit NUMERIC(14, 4) NOT NULL DEFAULT 0,
    individual_cost_rub NUMERIC(14, 2) NOT NULL DEFAULT 0,
    allocations JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- 012: actual received quantities and audit
    received_qty NUMERIC(14,3),
    original_unit_cost_rub NUMERIC(14,2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_order_items_order ON supplier_order_items(supplier_order_id);
CREATE INDEX IF NOT EXISTS idx_supplier_order_items_master ON supplier_order_items(master_card_id);

-- ============================================================
-- 5. inventory_lots (FIFO source of truth)
-- Base: 008
-- ============================================================

CREATE TABLE IF NOT EXISTS inventory_lots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_card_id UUID NOT NULL REFERENCES master_cards(id) ON DELETE RESTRICT,
    supplier_order_item_id UUID REFERENCES supplier_order_items(id) ON DELETE SET NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    initial_qty NUMERIC(14, 3) NOT NULL CHECK (initial_qty > 0),
    remaining_qty NUMERIC(14, 3) NOT NULL CHECK (remaining_qty >= 0),
    unit_cost_rub NUMERIC(14, 2) NOT NULL CHECK (unit_cost_rub >= 0),
    currency VARCHAR(10) NOT NULL DEFAULT 'RUB',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_lots_master ON inventory_lots(master_card_id, received_at);
CREATE INDEX IF NOT EXISTS idx_inventory_lots_remaining ON inventory_lots(master_card_id, remaining_qty)
WHERE remaining_qty > 0;

-- ============================================================
-- 6. sales_orders
-- Base: 008, columns changed by: 015 (rename), indexes by: 020_sales_orders_index
-- ============================================================

CREATE TABLE IF NOT EXISTS sales_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    marketplace VARCHAR(30) NOT NULL DEFAULT 'ozon',
    external_order_id VARCHAR(120),
    sold_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status VARCHAR(30) NOT NULL DEFAULT 'completed',
    total_revenue_rub NUMERIC(14, 2) NOT NULL DEFAULT 0,
    total_fee_rub NUMERIC(14, 2) NOT NULL DEFAULT 0,
    total_cogs_rub NUMERIC(14, 2) NOT NULL DEFAULT 0,
    total_profit_rub NUMERIC(14, 2) NOT NULL DEFAULT 0,
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- 015: renamed from created_by
    user_id UUID REFERENCES admin_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, marketplace, external_order_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_orders_sold_at ON sales_orders(sold_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_orders_marketplace ON sales_orders(marketplace);
-- 015: tenant isolation index
CREATE INDEX IF NOT EXISTS idx_sales_orders_user ON sales_orders(user_id);
-- 020_sales_orders_index: status index
CREATE INDEX IF NOT EXISTS idx_sales_orders_status ON sales_orders(status);

-- ============================================================
-- 7. sales_order_items
-- Base: 008, index by: 020_sales_orders_index
-- ============================================================

CREATE TABLE IF NOT EXISTS sales_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    master_card_id UUID NOT NULL REFERENCES master_cards(id) ON DELETE RESTRICT,
    quantity NUMERIC(14, 3) NOT NULL CHECK (quantity > 0),
    unit_sale_price_rub NUMERIC(14, 2) NOT NULL DEFAULT 0,
    revenue_rub NUMERIC(14, 2) NOT NULL DEFAULT 0,
    fee_rub NUMERIC(14, 2) NOT NULL DEFAULT 0,
    extra_cost_rub NUMERIC(14, 2) NOT NULL DEFAULT 0,
    cogs_rub NUMERIC(14, 2) NOT NULL DEFAULT 0,
    gross_profit_rub NUMERIC(14, 2) NOT NULL DEFAULT 0,
    source_offer_id VARCHAR(150),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_order_items_order ON sales_order_items(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_sales_order_items_master ON sales_order_items(master_card_id);
-- 020_sales_orders_index: unique constraint for upsert during posting sync
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_order_items_order_offer
    ON sales_order_items(sales_order_id, source_offer_id);

-- ============================================================
-- 8. fifo_allocations
-- Base: 008
-- ============================================================

CREATE TABLE IF NOT EXISTS fifo_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sales_order_item_id UUID NOT NULL REFERENCES sales_order_items(id) ON DELETE CASCADE,
    inventory_lot_id UUID NOT NULL REFERENCES inventory_lots(id) ON DELETE RESTRICT,
    quantity NUMERIC(14, 3) NOT NULL CHECK (quantity > 0),
    unit_cost_rub NUMERIC(14, 2) NOT NULL CHECK (unit_cost_rub >= 0),
    total_cost_rub NUMERIC(14, 2) NOT NULL CHECK (total_cost_rub >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fifo_allocations_item ON fifo_allocations(sales_order_item_id);
CREATE INDEX IF NOT EXISTS idx_fifo_allocations_lot ON fifo_allocations(inventory_lot_id);

-- ============================================================
-- 9. finance_transactions
-- Base: 008, columns changed by: 015 (rename)
-- ============================================================

CREATE TABLE IF NOT EXISTS finance_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    happened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    kind VARCHAR(10) NOT NULL CHECK (kind IN ('income', 'expense')),
    category VARCHAR(80) NOT NULL,
    subcategory VARCHAR(80),
    amount_rub NUMERIC(14, 2) NOT NULL CHECK (amount_rub >= 0),
    currency VARCHAR(10) NOT NULL DEFAULT 'RUB',
    source VARCHAR(30) NOT NULL DEFAULT 'manual',
    external_id VARCHAR(120),
    related_entity_type VARCHAR(40),
    related_entity_id UUID,
    notes TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- 015: renamed from created_by
    user_id UUID REFERENCES admin_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_finance_transactions_date ON finance_transactions(happened_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_transactions_kind ON finance_transactions(kind);
CREATE INDEX IF NOT EXISTS idx_finance_transactions_category ON finance_transactions(category);
CREATE INDEX IF NOT EXISTS idx_finance_transactions_user ON finance_transactions(user_id);

-- ============================================================
-- 10. ozon_sync_runs
-- Base: 008, columns changed by: 015 (rename)
-- ============================================================

CREATE TABLE IF NOT EXISTS ozon_sync_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_type VARCHAR(40) NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    status VARCHAR(30) NOT NULL DEFAULT 'running',
    rows_processed INT NOT NULL DEFAULT 0,
    created_count INT NOT NULL DEFAULT 0,
    skipped_count INT NOT NULL DEFAULT 0,
    error_count INT NOT NULL DEFAULT 0,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- 015: renamed from created_by
    user_id UUID REFERENCES admin_users(id)
);

CREATE INDEX IF NOT EXISTS idx_ozon_sync_runs_type ON ozon_sync_runs(sync_type, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ozon_sync_runs_user ON ozon_sync_runs(user_id);

-- ============================================================
-- 11. ozon_sku_economics
-- Base: 011, columns added by: 012, 022
-- ============================================================

CREATE TABLE IF NOT EXISTS ozon_sku_economics (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES admin_users(id),
    operation_id BIGINT NOT NULL,
    operation_date TIMESTAMPTZ NOT NULL,
    operation_type TEXT,
    posting_number TEXT,
    delivery_schema TEXT,
    sku BIGINT NOT NULL,
    product_name TEXT,

    -- Revenue & commission
    revenue NUMERIC(12,2) DEFAULT 0,
    sale_commission NUMERIC(12,2) DEFAULT 0,
    total_amount NUMERIC(12,2) DEFAULT 0,

    -- Direct per-item services (from services[])
    last_mile NUMERIC(12,2) DEFAULT 0,
    pipeline NUMERIC(12,2) DEFAULT 0,
    fulfillment NUMERIC(12,2) DEFAULT 0,
    dropoff NUMERIC(12,2) DEFAULT 0,
    acquiring NUMERIC(12,2) DEFAULT 0,
    return_logistics NUMERIC(12,2) DEFAULT 0,
    return_processing NUMERIC(12,2) DEFAULT 0,
    marketing NUMERIC(12,2) DEFAULT 0,
    installment NUMERIC(12,2) DEFAULT 0,
    other_services NUMERIC(12,2) DEFAULT 0,

    -- COGS (from our platform, filled via enrichment)
    cogs NUMERIC(12,2) DEFAULT 0,

    -- Raw data for debugging
    services_raw JSONB,

    -- 012: quantity tracking for FIFO COGS calculation
    quantity INT NOT NULL DEFAULT 1,

    -- 022: finance operation type categorization
    finance_type TEXT NOT NULL DEFAULT '',

    created_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE(user_id, operation_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_sku_econ_user_date ON ozon_sku_economics(user_id, operation_date);
CREATE INDEX IF NOT EXISTS idx_sku_econ_sku ON ozon_sku_economics(sku);
CREATE INDEX IF NOT EXISTS idx_sku_econ_finance_type ON ozon_sku_economics(finance_type);

-- ============================================================
-- 12. ozon_ad_spend
-- Base: 011
-- ============================================================

CREATE TABLE IF NOT EXISTS ozon_ad_spend (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES admin_users(id),
    sku BIGINT NOT NULL,
    date DATE NOT NULL,
    spend NUMERIC(12,2) DEFAULT 0,
    views INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    orders INTEGER DEFAULT 0,
    campaign_id BIGINT,
    campaign_name TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, sku, date, campaign_id)
);

-- ============================================================
-- 13. ozon_supplies
-- Base: 014, columns added by: 018
-- ============================================================

CREATE TABLE IF NOT EXISTS ozon_supplies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES admin_users(id),
    ozon_supply_order_id BIGINT NOT NULL,
    supply_number VARCHAR(120),
    status VARCHAR(60) NOT NULL DEFAULT 'DRAFT',
    warehouse_name TEXT,
    warehouse_id BIGINT,
    created_ozon_at TIMESTAMPTZ,
    updated_ozon_at TIMESTAMPTZ,
    total_items_planned INT NOT NULL DEFAULT 0,
    total_items_accepted INT NOT NULL DEFAULT 0,
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- 018: track whether supply already deducted from warehouse
    warehouse_deducted BOOLEAN NOT NULL DEFAULT FALSE,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, ozon_supply_order_id)
);

CREATE INDEX IF NOT EXISTS idx_ozon_supplies_user ON ozon_supplies(user_id, synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_ozon_supplies_status ON ozon_supplies(status);

DROP TRIGGER IF EXISTS trg_ozon_supplies_updated_at ON ozon_supplies;
CREATE TRIGGER trg_ozon_supplies_updated_at
BEFORE UPDATE ON ozon_supplies
FOR EACH ROW EXECUTE FUNCTION set_updated_at_admin_erp();

-- ============================================================
-- 14. ozon_supply_items
-- Base: 014, columns added by: 019
-- ============================================================

CREATE TABLE IF NOT EXISTS ozon_supply_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ozon_supply_id UUID NOT NULL REFERENCES ozon_supplies(id) ON DELETE CASCADE,
    master_card_id UUID REFERENCES master_cards(id) ON DELETE SET NULL,
    ozon_offer_id VARCHAR(150),
    ozon_sku BIGINT,
    product_name TEXT,
    quantity_planned INT NOT NULL DEFAULT 0,
    quantity_accepted INT NOT NULL DEFAULT 0,
    quantity_rejected INT NOT NULL DEFAULT 0,
    -- 019: track whether supply item losses have been written off from FIFO inventory
    loss_written_off BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ozon_supply_items_supply ON ozon_supply_items(ozon_supply_id);
CREATE INDEX IF NOT EXISTS idx_ozon_supply_items_master ON ozon_supply_items(master_card_id);
CREATE INDEX IF NOT EXISTS idx_ozon_supply_items_offer ON ozon_supply_items(ozon_offer_id);

-- ============================================================
-- 15. ozon_warehouse_stock
-- Base: 014
-- ============================================================

CREATE TABLE IF NOT EXISTS ozon_warehouse_stock (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES admin_users(id),
    master_card_id UUID REFERENCES master_cards(id) ON DELETE SET NULL,
    ozon_offer_id VARCHAR(150),
    ozon_product_id VARCHAR(100),
    ozon_sku BIGINT,
    warehouse_name TEXT,
    stock_type VARCHAR(10) NOT NULL DEFAULT 'fbo',
    present INT NOT NULL DEFAULT 0,
    reserved INT NOT NULL DEFAULT 0,
    free_to_sell INT NOT NULL DEFAULT 0,
    snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ozon_warehouse_stock_user ON ozon_warehouse_stock(user_id, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_ozon_warehouse_stock_master ON ozon_warehouse_stock(master_card_id);

-- ============================================================
-- 16. stock_movements
-- Base: 018
-- ============================================================

CREATE TABLE IF NOT EXISTS stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    master_card_id UUID NOT NULL REFERENCES master_cards(id) ON DELETE RESTRICT,
    movement_type VARCHAR(30) NOT NULL,
    -- Types: supplier_receipt, supply_to_ozon, supply_cancelled,
    --        return_to_seller, adjustment, initial_balance, unreceive
    quantity NUMERIC(14,3) NOT NULL,  -- positive=in, negative=out
    reference_type VARCHAR(40),       -- supplier_order, ozon_supply, ozon_return, manual
    reference_id UUID,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_card
    ON stock_movements(master_card_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_ref
    ON stock_movements(reference_type, reference_id);

-- ============================================================
-- 17. ozon_returns
-- Base: 018, columns added by: 021_returns_type
-- ============================================================

CREATE TABLE IF NOT EXISTS ozon_returns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    master_card_id UUID REFERENCES master_cards(id) ON DELETE SET NULL,
    ozon_return_id BIGINT NOT NULL,
    posting_number VARCHAR(120),
    ozon_offer_id VARCHAR(150),
    ozon_sku BIGINT,
    product_name TEXT,
    quantity INT NOT NULL DEFAULT 1,
    status VARCHAR(60),
    return_reason TEXT,
    is_opened BOOLEAN DEFAULT FALSE,
    logistic_return_date TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    resolution VARCHAR(30),  -- NULL=pending, 'restocked', 'returned_to_seller', 'written_off'
    -- 021_returns_type: distinguish Cancellation from CustomerReturn
    return_type VARCHAR(40) NOT NULL DEFAULT '',
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, ozon_return_id)
);

CREATE INDEX IF NOT EXISTS idx_ozon_returns_user
    ON ozon_returns(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ozon_returns_card
    ON ozon_returns(master_card_id);
CREATE INDEX IF NOT EXISTS idx_ozon_returns_pending
    ON ozon_returns(user_id) WHERE resolution IS NULL;
CREATE INDEX IF NOT EXISTS idx_ozon_returns_type
    ON ozon_returns(master_card_id, return_type);

-- ============================================================
-- 18. admin_ozon_accounts
-- Base: 017
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_ozon_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    client_id_enc BYTEA NOT NULL,
    api_key_enc BYTEA NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_admin_ozon_accounts_user ON admin_ozon_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_ozon_accounts_user_active ON admin_ozon_accounts(user_id, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_ozon_accounts_default_per_user
    ON admin_ozon_accounts(user_id)
    WHERE is_default = TRUE;

DROP TRIGGER IF EXISTS trg_admin_ozon_accounts_updated_at ON admin_ozon_accounts;
CREATE TRIGGER trg_admin_ozon_accounts_updated_at
BEFORE UPDATE ON admin_ozon_accounts
FOR EACH ROW EXECUTE FUNCTION set_updated_at_admin_erp();

-- ============================================================
-- 19. ozon_cluster_stock
-- Base: 020_demand_planning
-- ============================================================

CREATE TABLE IF NOT EXISTS ozon_cluster_stock (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID NOT NULL,
    master_card_id  UUID REFERENCES master_cards(id) ON DELETE SET NULL,
    ozon_sku        BIGINT NOT NULL,
    offer_id        TEXT,
    cluster_id      INT NOT NULL,
    cluster_name    TEXT,
    warehouse_id    BIGINT DEFAULT 0,
    warehouse_name  TEXT,
    -- stock counts (per warehouse in cluster)
    available       INT DEFAULT 0,
    in_transit      INT DEFAULT 0,
    reserved        INT DEFAULT 0,
    -- Ozon analytics: per-cluster
    ads_cluster             NUMERIC(10,2),
    idc_cluster             INT,
    turnover_cluster        TEXT,
    days_no_sales_cluster   INT,
    -- Ozon analytics: global (same for all clusters of same SKU)
    ads_global              NUMERIC(10,2),
    idc_global              INT,
    turnover_global         TEXT,
    item_tags               TEXT[],
    -- meta
    synced_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, ozon_sku, cluster_id, warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_ocs_user_card ON ozon_cluster_stock(user_id, master_card_id);
CREATE INDEX IF NOT EXISTS idx_ocs_user_sku ON ozon_cluster_stock(user_id, ozon_sku);

-- ============================================================
-- 20. supply_planning_params
-- Base: 020_demand_planning
-- ============================================================

CREATE TABLE IF NOT EXISTS supply_planning_params (
    id                  BIGSERIAL PRIMARY KEY,
    user_id             UUID NOT NULL,
    master_card_id      UUID REFERENCES master_cards(id) ON DELETE CASCADE,
    target_stock_days   INT DEFAULT 45,
    safety_stock_qty    INT DEFAULT 0,
    supplier_lead_days  INT DEFAULT 45,
    moq                 INT DEFAULT 1,
    pack_size           INT DEFAULT 1,
    enabled             BOOLEAN DEFAULT TRUE,
    UNIQUE(user_id, master_card_id)
);

-- ============================================================
-- 21. supply_cluster_targets
-- Base: 020_demand_planning
-- ============================================================

CREATE TABLE IF NOT EXISTS supply_cluster_targets (
    id                      BIGSERIAL PRIMARY KEY,
    user_id                 UUID NOT NULL,
    master_card_id          UUID REFERENCES master_cards(id) ON DELETE CASCADE,
    cluster_id              INT NOT NULL,
    cluster_name            TEXT,
    estimated_daily_sales   NUMERIC(10,2),
    initial_stock_target    INT,
    target_stock_days       INT DEFAULT 45,
    enabled                 BOOLEAN DEFAULT TRUE,
    UNIQUE(user_id, master_card_id, cluster_id)
);

-- ============================================================
-- 22. supply_plans
-- Base: 020_demand_planning, columns added by: 021_demand_buffer_days
-- ============================================================

CREATE TABLE IF NOT EXISTS supply_plans (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    status          TEXT DEFAULT 'draft',
    lead_time_days  INT DEFAULT 45,
    -- 021_demand_buffer_days: two-horizon planning
    buffer_days     INT DEFAULT 60,
    total_items     INT DEFAULT 0,
    total_qty       INT DEFAULT 0,
    notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_supply_plans_user ON supply_plans(user_id, created_at DESC);

-- ============================================================
-- 23. supply_plan_items
-- Base: 020_demand_planning
-- ============================================================

CREATE TABLE IF NOT EXISTS supply_plan_items (
    id                  BIGSERIAL PRIMARY KEY,
    plan_id             BIGINT REFERENCES supply_plans(id) ON DELETE CASCADE,
    master_card_id      UUID REFERENCES master_cards(id) ON DELETE SET NULL,
    -- snapshot: Ozon global metrics at generation time
    ads_global          NUMERIC(10,2),
    idc_global          INT,
    turnover_global     TEXT,
    -- snapshot: stock positions
    stock_on_ozon       INT,
    stock_at_home       INT,
    pipeline_supplier   INT,
    pipeline_ozon       INT,
    -- per-cluster breakdown (JSONB for flexibility)
    cluster_breakdown   JSONB DEFAULT '[]',
    -- result
    total_gap           INT,
    recommended_qty     INT,
    adjusted_qty        INT,
    target_stock_days   INT
);

CREATE INDEX IF NOT EXISTS idx_spi_plan ON supply_plan_items(plan_id);

-- ============================================================
-- 24. admin_api_keys
-- Base: 023
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_api_keys (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    key_hash     TEXT NOT NULL,
    key_prefix   VARCHAR(12) NOT NULL,
    name         VARCHAR(120) NOT NULL,
    scopes       TEXT[] DEFAULT '{}',
    rate_limit   INT DEFAULT 60,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ,
    CONSTRAINT uq_api_key_hash UNIQUE (key_hash)
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON admin_api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_lookup ON admin_api_keys(key_hash) WHERE revoked_at IS NULL;

-- ============================================================
-- 25. ozon_commission_rates
-- Base: 025
-- ============================================================

CREATE TABLE IF NOT EXISTS ozon_commission_rates (
    id SERIAL PRIMARY KEY,
    category TEXT NOT NULL,
    product_type TEXT NOT NULL,
    scheme TEXT NOT NULL CHECK (scheme IN ('FBO', 'FBS', 'RFBS', 'FBO_Fresh')),
    price_min NUMERIC(12,2) NOT NULL,   -- lower bound (inclusive)
    price_max NUMERIC(12,2),            -- upper bound (exclusive), NULL = unbounded
    rate NUMERIC(6,4) NOT NULL,         -- e.g. 0.4100 = 41%
    valid_from DATE NOT NULL DEFAULT '2026-04-06',
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(category, product_type, scheme, price_min, valid_from)
);

CREATE INDEX IF NOT EXISTS idx_comm_cat_type ON ozon_commission_rates(category, product_type);
CREATE INDEX IF NOT EXISTS idx_comm_scheme ON ozon_commission_rates(scheme);

-- ============================================================
-- Mark migration as applied
-- ============================================================

INSERT INTO schema_migrations (filename) VALUES ('init.sql')
ON CONFLICT (filename) DO NOTHING;
