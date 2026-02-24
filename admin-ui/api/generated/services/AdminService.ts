/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AdminCreateUserRequest } from '../models/AdminCreateUserRequest';
import type { AdminLoginRequest } from '../models/AdminLoginRequest';
import type { AdminSettingsUpdateRequest } from '../models/AdminSettingsUpdateRequest';
import type { AdminUpdateUserRequest } from '../models/AdminUpdateUserRequest';
import type { FinanceTransactionCreateRequest } from '../models/FinanceTransactionCreateRequest';
import type { Import1688SourceRequest } from '../models/Import1688SourceRequest';
import type { InitialBalanceRequest } from '../models/InitialBalanceRequest';
import type { MasterCardCreateRequest } from '../models/MasterCardCreateRequest';
import type { MasterCardUpdateRequest } from '../models/MasterCardUpdateRequest';
import type { OzonCredentialsUpsertRequest } from '../models/OzonCredentialsUpsertRequest';
import type { OzonProductsImportRequest } from '../models/OzonProductsImportRequest';
import type { OzonStocksRequest } from '../models/OzonStocksRequest';
import type { OzonSupplySyncRequest } from '../models/OzonSupplySyncRequest';
import type { OzonSyncRequest } from '../models/OzonSyncRequest';
import type { OzonWarehouseStockSyncRequest } from '../models/OzonWarehouseStockSyncRequest';
import type { Preview1688Request } from '../models/Preview1688Request';
import type { ReceiveOrderRequest } from '../models/ReceiveOrderRequest';
import type { ReportPnlOzonRequest } from '../models/ReportPnlOzonRequest';
import type { SaleCreateRequest } from '../models/SaleCreateRequest';
import type { SupplierOrderCreateRequest } from '../models/SupplierOrderCreateRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class AdminService {
    /**
     * Admin Login
     * @param requestBody
     * @returns any Successful Response
     * @throws ApiError
     */
    public static adminLoginV2AdminAuthLoginPost(
        requestBody: AdminLoginRequest,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/v2/admin/auth/login',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Admin Logout
     * @returns any Successful Response
     * @throws ApiError
     */
    public static adminLogoutV2AdminAuthLogoutPost(): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/v2/admin/auth/logout',
        });
    }
    /**
     * Admin Me
     * @returns any Successful Response
     * @throws ApiError
     */
    public static adminMeV2AdminAuthMeGet(): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/v2/admin/auth/me',
        });
    }
    /**
     * Get Ozon Integration
     * @returns any Successful Response
     * @throws ApiError
     */
    public static getOzonIntegrationV2AdminIntegrationsOzonGet(): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/v2/admin/integrations/ozon',
        });
    }
    /**
     * Upsert Ozon Integration
     * @param requestBody
     * @returns any Successful Response
     * @throws ApiError
     */
    public static upsertOzonIntegrationV2AdminIntegrationsOzonPut(
        requestBody: OzonCredentialsUpsertRequest,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/v2/admin/integrations/ozon',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Clear Ozon Integration
     * @returns any Successful Response
     * @throws ApiError
     */
    public static clearOzonIntegrationV2AdminIntegrationsOzonDelete(): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/v2/admin/integrations/ozon',
        });
    }
    /**
     * Admin List Users
     * @returns any Successful Response
     * @throws ApiError
     */
    public static adminListUsersV2AdminUsersGet(): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/v2/admin/users',
        });
    }
    /**
     * Admin Create User
     * @param requestBody
     * @returns any Successful Response
     * @throws ApiError
     */
    public static adminCreateUserV2AdminUsersPost(
        requestBody: AdminCreateUserRequest,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/v2/admin/users',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Admin Update User
     * @param userId
     * @param requestBody
     * @returns any Successful Response
     * @throws ApiError
     */
    public static adminUpdateUserV2AdminUsersUserIdPatch(
        userId: string,
        requestBody: AdminUpdateUserRequest,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/v2/admin/users/{user_id}',
            path: {
                'user_id': userId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * List Master Cards
     * @param q
     * @param includeArchived
     * @param limit
     * @param offset
     * @returns any Successful Response
     * @throws ApiError
     */
    public static listMasterCardsV2AdminMasterCardsGet(
        q?: (string | null),
        includeArchived: boolean = false,
        limit: number = 50,
        offset?: number,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/v2/admin/master-cards',
            query: {
                'q': q,
                'include_archived': includeArchived,
                'limit': limit,
                'offset': offset,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Create Master Card
     * @param requestBody
     * @returns any Successful Response
     * @throws ApiError
     */
    public static createMasterCardV2AdminMasterCardsPost(
        requestBody: MasterCardCreateRequest,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/v2/admin/master-cards',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Get Master Card
     * @param cardId
     * @returns any Successful Response
     * @throws ApiError
     */
    public static getMasterCardV2AdminMasterCardsCardIdGet(
        cardId: string,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/v2/admin/master-cards/{card_id}',
            path: {
                'card_id': cardId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Update Master Card
     * @param cardId
     * @param requestBody
     * @returns any Successful Response
     * @throws ApiError
     */
    public static updateMasterCardV2AdminMasterCardsCardIdPatch(
        cardId: string,
        requestBody: MasterCardUpdateRequest,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/v2/admin/master-cards/{card_id}',
            path: {
                'card_id': cardId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Preview 1688 Source
     * Preview 1688 product: fetch from TMAPI and return parsed data with SKU list.
     * @param requestBody
     * @returns any Successful Response
     * @throws ApiError
     */
    public static preview1688SourceV2AdminMasterCardsSources1688PreviewPost(
        requestBody: Preview1688Request,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/v2/admin/master-cards/sources/1688/preview',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Import Master Card 1688 Source
     * @param cardId
     * @param requestBody
     * @returns any Successful Response
     * @throws ApiError
     */
    public static importMasterCard1688SourceV2AdminMasterCardsCardIdSources1688ImportPost(
        cardId: string,
        requestBody: Import1688SourceRequest,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/v2/admin/master-cards/{card_id}/sources/1688/import',
            path: {
                'card_id': cardId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * List Supplier Orders
     * @param statusFilter
     * @param limit
     * @param offset
     * @returns any Successful Response
     * @throws ApiError
     */
    public static listSupplierOrdersV2AdminSupplierOrdersGet(
        statusFilter?: (string | null),
        limit: number = 50,
        offset?: number,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/v2/admin/supplier-orders',
            query: {
                'status_filter': statusFilter,
                'limit': limit,
                'offset': offset,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Create Supplier Order
     * @param requestBody
     * @returns any Successful Response
     * @throws ApiError
     */
    public static createSupplierOrderV2AdminSupplierOrdersPost(
        requestBody: SupplierOrderCreateRequest,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/v2/admin/supplier-orders',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Get Supplier Order
     * @param orderId
     * @returns any Successful Response
     * @throws ApiError
     */
    public static getSupplierOrderV2AdminSupplierOrdersOrderIdGet(
        orderId: string,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/v2/admin/supplier-orders/{order_id}',
            path: {
                'order_id': orderId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Delete Supplier Order
     * @param orderId
     * @returns any Successful Response
     * @throws ApiError
     */
    public static deleteSupplierOrderV2AdminSupplierOrdersOrderIdDelete(
        orderId: string,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/v2/admin/supplier-orders/{order_id}',
            path: {
                'order_id': orderId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Update Supplier Order
     * @param orderId
     * @param requestBody
     * @returns any Successful Response
     * @throws ApiError
     */
    public static updateSupplierOrderV2AdminSupplierOrdersOrderIdPut(
        orderId: string,
        requestBody: SupplierOrderCreateRequest,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/v2/admin/supplier-orders/{order_id}',
            path: {
                'order_id': orderId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Receive Supplier Order
     * @param orderId
     * @param requestBody
     * @returns any Successful Response
     * @throws ApiError
     */
    public static receiveSupplierOrderV2AdminSupplierOrdersOrderIdReceivePost(
        orderId: string,
        requestBody?: (ReceiveOrderRequest | null),
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/v2/admin/supplier-orders/{order_id}/receive',
            path: {
                'order_id': orderId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Unreceive Supplier Order
     * Undo a receive: delete lots, finance transaction, reset order to draft.
     * @param orderId
     * @returns any Successful Response
     * @throws ApiError
     */
    public static unreceiveSupplierOrderV2AdminSupplierOrdersOrderIdUnreceivePost(
        orderId: string,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/v2/admin/supplier-orders/{order_id}/unreceive',
            path: {
                'order_id': orderId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Create Initial Balance
     * Create an opening balance: supplier order + inventory lots in one transaction.
     * @param requestBody
     * @returns any Successful Response
     * @throws ApiError
     */
    public static createInitialBalanceV2AdminInventoryInitialBalancePost(
        requestBody: InitialBalanceRequest,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/v2/admin/inventory/initial-balance',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Inventory Overview
     * @returns any Successful Response
     * @throws ApiError
     */
    public static inventoryOverviewV2AdminInventoryGet(): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/v2/admin/inventory',
        });
    }
    /**
     * List Sales Orders
     * @param limit
     * @param offset
     * @returns any Successful Response
     * @throws ApiError
     */
    public static listSalesOrdersV2AdminSalesGet(
        limit: number = 50,
        offset?: number,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/v2/admin/sales',
            query: {
                'limit': limit,
                'offset': offset,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Create Sale
     * @param requestBody
     * @returns any Successful Response
     * @throws ApiError
     */
    public static createSaleV2AdminSalesPost(
        requestBody: SaleCreateRequest,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/v2/admin/sales',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * List Finance Transactions
     * @param dateFrom
     * @param dateTo
     * @param kind
     * @param category
     * @param limit
     * @param offset
     * @returns any Successful Response
     * @throws ApiError
     */
    public static listFinanceTransactionsV2AdminFinanceTransactionsGet(
        dateFrom?: (string | null),
        dateTo?: (string | null),
        kind?: (string | null),
        category?: (string | null),
        limit: number = 200,
        offset?: number,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/v2/admin/finance/transactions',
            query: {
                'date_from': dateFrom,
                'date_to': dateTo,
                'kind': kind,
                'category': category,
                'limit': limit,
                'offset': offset,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Create Finance Transaction
     * @param requestBody
     * @returns any Successful Response
     * @throws ApiError
     */
    public static createFinanceTransactionV2AdminFinanceTransactionsPost(
        requestBody: FinanceTransactionCreateRequest,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/v2/admin/finance/transactions',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Report Dds
     * @param dateFrom
     * @param dateTo
     * @returns any Successful Response
     * @throws ApiError
     */
    public static reportDdsV2AdminReportsDdsGet(
        dateFrom?: (string | null),
        dateTo?: (string | null),
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/v2/admin/reports/dds',
            query: {
                'date_from': dateFrom,
                'date_to': dateTo,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Report Pnl
     * @param dateFrom
     * @param dateTo
     * @param groupBy
     * @returns any Successful Response
     * @throws ApiError
     */
    public static reportPnlV2AdminReportsPnlGet(
        dateFrom?: (string | null),
        dateTo?: (string | null),
        groupBy: string = 'day',
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/v2/admin/reports/pnl',
            query: {
                'date_from': dateFrom,
                'date_to': dateTo,
                'group_by': groupBy,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Fetch Ozon Stocks
     * Fetch current Ozon stock levels and match to master_cards.
     * @param requestBody
     * @returns any Successful Response
     * @throws ApiError
     */
    public static fetchOzonStocksV2AdminOzonStocksPost(
        requestBody: OzonStocksRequest,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/v2/admin/ozon/stocks',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Import Ozon Products
     * @param requestBody
     * @returns any Successful Response
     * @throws ApiError
     */
    public static importOzonProductsV2AdminOzonImportProductsPost(
        requestBody: OzonProductsImportRequest,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/v2/admin/ozon/import/products',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Sync Ozon Finance
     * @param requestBody
     * @returns any Successful Response
     * @throws ApiError
     */
    public static syncOzonFinanceV2AdminOzonSyncFinancePost(
        requestBody: OzonSyncRequest,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/v2/admin/ozon/sync/finance',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Sync Ozon Sales
     * @param requestBody
     * @returns any Successful Response
     * @throws ApiError
     */
    public static syncOzonSalesV2AdminOzonSyncSalesPost(
        requestBody: OzonSyncRequest,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/v2/admin/ozon/sync/sales',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Sync Ozon Unit Economics
     * Sync Ozon finance transactions into per-SKU unit economics table.
     *
     * If date_from/date_to are not provided, auto-detects last sync date
     * and fetches from (last_date - 14 days) to today.
     * @param requestBody
     * @returns any Successful Response
     * @throws ApiError
     */
    public static syncOzonUnitEconomicsV2AdminOzonSyncUnitEconomicsPost(
        requestBody: OzonSyncRequest,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/v2/admin/ozon/sync/unit-economics',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Report Unit Economics
     * Per-SKU unit economics report for a given period.
     * @param dateFrom
     * @param dateTo
     * @returns any Successful Response
     * @throws ApiError
     */
    public static reportUnitEconomicsV2AdminReportsUnitEconomicsGet(
        dateFrom?: (string | null),
        dateTo?: (string | null),
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/v2/admin/reports/unit-economics',
            query: {
                'date_from': dateFrom,
                'date_to': dateTo,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Report Pnl Ozon
     * P&L report using Ozon /v1/finance/balance API + our COGS from DB.
     * @param requestBody
     * @returns any Successful Response
     * @throws ApiError
     */
    public static reportPnlOzonV2AdminReportsPnlOzonPost(
        requestBody?: (ReportPnlOzonRequest | null),
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/v2/admin/reports/pnl-ozon',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Get Admin Settings
     * @returns any Successful Response
     * @throws ApiError
     */
    public static getAdminSettingsV2AdminSettingsGet(): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/v2/admin/settings',
        });
    }
    /**
     * Update Admin Settings
     * @param requestBody
     * @returns any Successful Response
     * @throws ApiError
     */
    public static updateAdminSettingsV2AdminSettingsPut(
        requestBody: AdminSettingsUpdateRequest,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/v2/admin/settings',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Sync Ozon Supplies
     * Sync supply orders from Ozon Seller API.
     * @param requestBody
     * @returns any Successful Response
     * @throws ApiError
     */
    public static syncOzonSuppliesV2AdminOzonSyncSuppliesPost(
        requestBody: OzonSupplySyncRequest,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/v2/admin/ozon/sync/supplies',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Sync Ozon Warehouse Stock
     * Sync Ozon warehouse stock levels (FBO + FBS) into snapshots.
     * @param requestBody
     * @returns any Successful Response
     * @throws ApiError
     */
    public static syncOzonWarehouseStockV2AdminOzonSyncWarehouseStockPost(
        requestBody: OzonWarehouseStockSyncRequest,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/v2/admin/ozon/sync/warehouse-stock',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Get Logistics Matrix
     * Build the supply chain matrix: one row per SKU with lifecycle columns.
     * @returns any Successful Response
     * @throws ApiError
     */
    public static getLogisticsMatrixV2AdminLogisticsMatrixGet(): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/v2/admin/logistics/matrix',
        });
    }
    /**
     * Get Logistics Supplies
     * List all Ozon supply orders with items, grouped by supply.
     * @returns any Successful Response
     * @throws ApiError
     */
    public static getLogisticsSuppliesV2AdminLogisticsSuppliesGet(): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/v2/admin/logistics/supplies',
        });
    }
    /**
     * Get Logistics Sku Detail
     * Drill-down: full lifecycle detail for one SKU.
     * @param masterCardId
     * @returns any Successful Response
     * @throws ApiError
     */
    public static getLogisticsSkuDetailV2AdminLogisticsSkuMasterCardIdGet(
        masterCardId: string,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/v2/admin/logistics/sku/{master_card_id}',
            path: {
                'master_card_id': masterCardId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
