/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AdminUserCreateRequest } from '../models/AdminUserCreateRequest';
import type { AdminUsersListResponse } from '../models/AdminUsersListResponse';
import type { AdminUserUpdateRequest } from '../models/AdminUserUpdateRequest';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class AdminV2IdentityService {
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
}
