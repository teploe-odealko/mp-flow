/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AllocationEntry } from './AllocationEntry';
export type SupplierOrderItemCreate = {
    master_card_id?: (string | null);
    title?: (string | null);
    quantity: (number | string);
    cny_price_per_unit?: (number | string);
    individual_cost_rub?: (number | string);
    allocations?: Array<AllocationEntry>;
    purchase_price_rub?: (number | string);
    packaging_cost_rub?: (number | string);
    logistics_cost_rub?: (number | string);
    customs_cost_rub?: (number | string);
    extra_cost_rub?: (number | string);
};

