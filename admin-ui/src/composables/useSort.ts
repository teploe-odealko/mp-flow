import { ref, computed, type Ref, type ComputedRef } from "vue";

export interface SortState {
  field: string;
  dir: "asc" | "desc";
}

export interface UseSortReturn<T> {
  sortField: Ref<string>;
  sortDir: Ref<"asc" | "desc">;
  toggleSort: (field: string) => void;
  sorted: ComputedRef<T[]>;
}

/**
 * Generic sort composable.
 *
 * Port of the vanilla `toggleSort(sortState, field)` logic.
 *
 * @param items    Reactive ref to the array of items to sort.
 * @param defaultField  Initial sort field.
 * @param defaultDir    Initial sort direction (default "desc").
 *
 * Usage:
 * ```ts
 * const { sortField, sortDir, toggleSort, sorted } = useSort(items, "updated_at", "desc");
 * ```
 */
export function useSort<T extends Record<string, unknown>>(
  items: Ref<T[]>,
  defaultField: string,
  defaultDir: "asc" | "desc" = "desc",
): UseSortReturn<T> {
  const sortField = ref(defaultField);
  const sortDir = ref<"asc" | "desc">(defaultDir);

  /**
   * Toggle sort: if already sorting by `field`, flip direction;
   * otherwise switch to `field` with ascending direction.
   * Exact replica of the vanilla toggleSort().
   */
  function toggleSort(field: string): void {
    if (sortField.value === field) {
      sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
    } else {
      sortField.value = field;
      sortDir.value = "asc";
    }
  }

  const sorted = computed<T[]>(() => {
    const list = [...items.value];
    const field = sortField.value;
    const dir = sortDir.value;

    list.sort((a, b) => {
      const aVal = a[field];
      const bVal = b[field];

      // Handle nulls — push them to the end regardless of direction
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      let cmp = 0;
      if (typeof aVal === "number" && typeof bVal === "number") {
        cmp = aVal - bVal;
      } else {
        cmp = String(aVal).localeCompare(String(bVal), "ru-RU", {
          numeric: true,
          sensitivity: "base",
        });
      }

      return dir === "asc" ? cmp : -cmp;
    });

    return list;
  });

  return {
    sortField: sortField as Ref<string>,
    sortDir,
    toggleSort,
    sorted,
  };
}
