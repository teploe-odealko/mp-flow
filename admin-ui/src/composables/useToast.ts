import { useUiStore, type Toast } from "../stores/ui";

/**
 * Composable wrapper around the UI store toast system.
 *
 * Usage:
 * ```ts
 * const { showToast } = useToast();
 * showToast("Saved!", "success");
 * ```
 */
export function useToast() {
  const ui = useUiStore();

  function showToast(
    message: string,
    type: Toast["type"] = "info",
  ): void {
    ui.addToast(message, type);
  }

  return { showToast };
}
