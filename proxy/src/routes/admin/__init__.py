from __future__ import annotations

from fastapi import APIRouter
from proxy.src.routes.admin.api_keys import router as _api_keys_router
from proxy.src.routes.admin.auth import router as _auth_router
from proxy.src.routes.admin.cards import router as _cards_router
from proxy.src.routes.admin.demand import router as _demand_router
from proxy.src.routes.admin.finance import router as _finance_router
from proxy.src.routes.admin.integrations import router as _integrations_router
from proxy.src.routes.admin.inventory import router as _inventory_router
from proxy.src.routes.admin.logistics import router as _logistics_router
from proxy.src.routes.admin.orders import router as _orders_router
from proxy.src.routes.admin.ozon_sync import router as _ozon_sync_router
from proxy.src.routes.admin.pricing import router as _pricing_router
from proxy.src.routes.admin.promotions import router as _promotions_router
from proxy.src.routes.admin.reports import router as _reports_router
from proxy.src.routes.admin.sales import router as _sales_router
from proxy.src.routes.admin.settings import router as _settings_router
from proxy.src.routes.admin.users import router as _users_router

router = APIRouter(prefix="/v1/admin")

router.include_router(_auth_router)
router.include_router(_users_router)
router.include_router(_api_keys_router)
router.include_router(_cards_router)
router.include_router(_orders_router)
router.include_router(_inventory_router)
router.include_router(_sales_router)
router.include_router(_finance_router)
router.include_router(_reports_router)
router.include_router(_settings_router)
router.include_router(_integrations_router)
router.include_router(_ozon_sync_router)
router.include_router(_logistics_router)
router.include_router(_demand_router)
router.include_router(_pricing_router)
router.include_router(_promotions_router)
