/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { OzonAccountCreateRequest } from '../models/OzonAccountCreateRequest';
import type { OzonAccountsListResponse } from '../models/OzonAccountsListResponse';
import type { OzonAccountUpdateRequest } from '../models/OzonAccountUpdateRequest';
import type { OzonAccountView } from '../models/OzonAccountView';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class AdminV2IntegrationsService {
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
