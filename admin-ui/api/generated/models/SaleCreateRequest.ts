/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SaleItemCreate } from './SaleItemCreate';
export type SaleCreateRequest = {
    marketplace?: string;
    external_order_id?: (string | null);
    sold_at?: (string | null);
    status?: string;
    items: Array<SaleItemCreate>;
    raw_payload?: Record<string, any>;
};

