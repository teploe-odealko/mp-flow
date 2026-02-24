/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type FinanceTransactionCreateRequest = {
    happened_at?: (string | null);
    kind: string;
    category: string;
    subcategory?: (string | null);
    amount_rub: (number | string);
    notes?: (string | null);
    source?: string;
    external_id?: (string | null);
    related_entity_type?: (string | null);
    related_entity_id?: (string | null);
    payload?: Record<string, any>;
};

