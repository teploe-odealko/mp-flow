/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CatalogCardCreateRequest } from '../models/CatalogCardCreateRequest';
import type { CatalogCardsListResponse } from '../models/CatalogCardsListResponse';
import type { CatalogCardUpdateRequest } from '../models/CatalogCardUpdateRequest';
import type { CatalogCardView } from '../models/CatalogCardView';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class AdminV2CatalogService {
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
}
