import { ref, computed, type Ref, type ComputedRef } from "vue";

export interface UseSearchReturn<T> {
  query: Ref<string>;
  filtered: ComputedRef<T[]>;
}

/**
 * Generic client-side search composable.
 *
 * Filters an array of objects by checking whether any of the specified
 * `fields` contains the `query` string (case-insensitive).
 *
 * @param items   Reactive ref to the source array.
 * @param fields  Array of property names to search within.
 *
 * Usage:
 * ```ts
 * const { query, filtered } = useSearch(items, ["title", "sku", "ozon_offer_id"]);
 * ```
 */
export function useSearch<T extends Record<string, unknown>>(
  items: Ref<T[]>,
  fields: string[],
): UseSearchReturn<T> {
  const query = ref("");

  const filtered = computed<T[]>(() => {
    const q = query.value.trim().toLowerCase();
    if (!q) return items.value;

    return items.value.filter((item) =>
      fields.some((field) => {
        const val = item[field];
        if (val == null) return false;
        return String(val).toLowerCase().includes(q);
      }),
    );
  });

  return { query, filtered };
}
