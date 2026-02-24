/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SharedCost } from './SharedCost';
import type { SupplierOrderItemCreate } from './SupplierOrderItemCreate';
export type SupplierOrderCreateRequest = {
    order_number?: (string | null);
    supplier_name: string;
    order_date?: (string | null);
    expected_date?: (string | null);
    notes?: (string | null);
    shared_costs?: Array<SharedCost>;
    items: Array<SupplierOrderItemCreate>;
};

