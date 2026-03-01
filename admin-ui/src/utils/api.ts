/**
 * Standalone apiRequest for backward compatibility.
 *
 * Re-exports from composables/useApi so that existing stores importing
 * from '@/utils/api' continue to work.
 */
export { apiRequest } from "../composables/useApi";
export type { ApiRequestOptions } from "../composables/useApi";
