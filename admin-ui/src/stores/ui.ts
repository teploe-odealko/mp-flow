import { defineStore } from "pinia";
import { ref, type Ref } from "vue";

export interface Toast {
  id: number;
  message: string;
  type: "info" | "success" | "error";
  visible: boolean;
}

let _nextToastId = 0;

export const useUiStore = defineStore("ui", () => {
  /* -------------------------------------------------------------- */
  /* State                                                          */
  /* -------------------------------------------------------------- */

  const theme: Ref<"light" | "dark"> = ref("light");
  const mobileSidebarOpen = ref(false);
  const toasts: Ref<Toast[]> = ref([]);

  /* -------------------------------------------------------------- */
  /* Theme                                                          */
  /* -------------------------------------------------------------- */

  /**
   * Read the saved theme from localStorage (or fall back to
   * prefers-color-scheme) and apply the appropriate class on <html>.
   *
   * Ported from app.js initTheme().
   */
  function initTheme(): void {
    const saved = localStorage.getItem("theme");
    const dark =
      saved === "dark" ||
      (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches);

    theme.value = dark ? "dark" : "light";
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.classList.toggle("light", !dark);
  }

  /**
   * Toggle between light / dark theme and persist the choice.
   *
   * Ported from app.js toggleTheme().
   */
  function toggleTheme(): void {
    const isDark = theme.value !== "dark"; // flip
    theme.value = isDark ? "dark" : "light";
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.classList.toggle("light", !isDark);
    localStorage.setItem("theme", theme.value);
  }

  /* -------------------------------------------------------------- */
  /* Mobile sidebar                                                 */
  /* -------------------------------------------------------------- */

  function openMobileSidebar(): void {
    mobileSidebarOpen.value = true;
  }

  function closeMobileSidebar(): void {
    mobileSidebarOpen.value = false;
  }

  /* -------------------------------------------------------------- */
  /* Toast notifications                                            */
  /* -------------------------------------------------------------- */

  /**
   * Show a toast notification. Automatically removed after 3.5 s
   * (matching the CSS animation timing from styles.css).
   *
   * Ported from app.js showToast().
   */
  function addToast(
    message: string,
    type: Toast["type"] = "info",
  ): void {
    const id = ++_nextToastId;
    const toast: Toast = { id, message, type, visible: true };
    toasts.value.push(toast);

    // Auto-remove after animation completes (~3.5 s matches CSS)
    setTimeout(() => {
      removeToast(id);
    }, 3500);
  }

  function removeToast(id: number): void {
    const idx = toasts.value.findIndex((t) => t.id === id);
    if (idx !== -1) {
      toasts.value.splice(idx, 1);
    }
  }

  /* -------------------------------------------------------------- */
  /* Public API                                                     */
  /* -------------------------------------------------------------- */

  return {
    // state
    theme,
    mobileSidebarOpen,
    toasts,
    // actions
    initTheme,
    toggleTheme,
    openMobileSidebar,
    closeMobileSidebar,
    addToast,
    removeToast,
  };
});
