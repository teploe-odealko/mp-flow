/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AdminUserCreateRequest } from '../models/AdminUserCreateRequest';
import type { AdminUsersListResponse } from '../models/AdminUsersListResponse';
import type { AdminUserUpdateRequest } from '../models/AdminUserUpdateRequest';
import type { CatalogCardCreateRequest } from '../models/CatalogCardCreateRequest';
import type { CatalogCardsListResponse } from '../models/CatalogCardsListResponse';
import type { CatalogCardUpdateRequest } from '../models/CatalogCardUpdateRequest';
import type { CatalogCardView } from '../models/CatalogCardView';
import type { OzonAccountCreateRequest } from '../models/OzonAccountCreateRequest';
import type { OzonAccountsListResponse } from '../models/OzonAccountsListResponse';
import type { OzonAccountUpdateRequest } from '../models/OzonAccountUpdateRequest';
import type { OzonAccountView } from '../models/OzonAccountView';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class AdminV2Service {
    /**
     * List Users
     * @param limit
     * @param cursor
     * @param sort
     * @param q
     * @param isActive
     * @returns AdminUsersListResponse Successful Response
     * @throws ApiError
     */
    public static listUsersV2AdminIdentityUsersGet(
        limit: number = 50,
        cursor?: (string | null),
        sort: string = 'created_at:desc',
        q?: (string | null),
        isActive?: (boolean | null),
    ): CancelablePromise<AdminUsersListResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/v2/admin/identity/users',
            query: {
                'limit': limit,
                'cursor': cursor,
                'sort': sort,
                'q': q,
                'is_active': isActive,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Create User
     * @param requestBody
     * @returns any Successful Response
     * @throws ApiError
     */
    public static createUserV2AdminIdentityUsersPost(
        requestBody: AdminUserCreateRequest,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/v2/admin/identity/users',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Update User
     * @param userId
     * @param requestBody
     * @returns any Successful Response
     * @throws ApiError
     */
    public static updateUserV2AdminIdentityUsersUserIdPatch(
        userId: string,
        requestBody: AdminUserUpdateRequest,
    ): CancelablePromise<Record<string, any>> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/v2/admin/identity/users/{user_id}',
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
     * List Cards
     * @param limit
     * @param cursor
     * @param sort
     * @param q
     * @param status
     * @returns CatalogCardsListResponse Successful Response
     * @throws ApiError
     */
    public static listCardsV2AdminCatalogCardsGet(
        limit: number = 50,
        cursor?: (string | null),
        sort: string = 'created_at:desc',
        q?: (string | null),
        status?: (string | null),
    ): CancelablePromise<CatalogCardsListResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/v2/admin/catalog/cards',
            query: {
                'limit': limit,
                'cursor': cursor,
                'sort': sort,
                'q': q,
                'status': status,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Create Card
     * @param requestBody
     * @returns CatalogCardView Successful Response
     * @throws ApiError
     */
    public static createCardV2AdminCatalogCardsPost(
        requestBody: CatalogCardCreateRequest,
    ): CancelablePromise<Record<string, CatalogCardView>> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/v2/admin/catalog/cards',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Get Card
     * @param cardId
     * @returns CatalogCardView Successful Response
     * @throws ApiError
     */
    public static getCardV2AdminCatalogCardsCardIdGet(
        cardId: string,
    ): CancelablePromise<CatalogCardView> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/v2/admin/catalog/cards/{card_id}',
            path: {
                'card_id': cardId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Update Card
     * @param cardId
     * @param requestBody
     * @returns CatalogCardView Successful Response
     * @throws ApiError
     */
    public static updateCardV2AdminCatalogCardsCardIdPatch(
        cardId: string,
        requestBody: CatalogCardUpdateRequest,
    ): CancelablePromise<Record<string, CatalogCardView>> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/v2/admin/catalog/cards/{card_id}',
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
     * List Ozon Accounts
     * @param limit
     * @param cursor
     * @param sort
     * @param q
     * @param isActive
     * @returns OzonAccountsListResponse Successful Response
     * @throws ApiError
     */
    public static listOzonAccountsV2AdminIntegrationsOzonAccountsGet(
        limit: number = 50,
        cursor?: (string | null),
        sort: string = 'created_at:desc',
        q?: (string | null),
        isActive?: (boolean | null),
    ): CancelablePromise<OzonAccountsListResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/v2/admin/integrations/ozon/accounts',
            query: {
                'limit': limit,
                'cursor': cursor,
                'sort': sort,
                'q': q,
                'is_active': isActive,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Create Ozon Account
     * @param requestBody
     * @returns OzonAccountView Successful Response
     * @throws ApiError
     */
    public static createOzonAccountV2AdminIntegrationsOzonAccountsPost(
        requestBody: OzonAccountCreateRequest,
    ): CancelablePromise<Record<string, OzonAccountView>> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/v2/admin/integrations/ozon/accounts',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Update Ozon Account
     * @param accountId
     * @param requestBody
     * @returns OzonAccountView Successful Response
     * @throws ApiError
     */
    public static updateOzonAccountV2AdminIntegrationsOzonAccountsAccountIdPatch(
        accountId: string,
        requestBody: OzonAccountUpdateRequest,
    ): CancelablePromise<Record<string, OzonAccountView>> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/v2/admin/integrations/ozon/accounts/{account_id}',
            path: {
                'account_id': accountId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                422: `Validation Error`,
            },
        });
    }
    /**
     * Delete Ozon Account
     * @param accountId
     * @returns boolean Successful Response
     * @throws ApiError
     */
    public static deleteOzonAccountV2AdminIntegrationsOzonAccountsAccountIdDelete(
        accountId: string,
    ): CancelablePromise<Record<string, boolean>> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/v2/admin/integrations/ozon/accounts/{account_id}',
            path: {
                'account_id': accountId,
            },
            errors: {
                422: `Validation Error`,
            },
        });
    }
}
