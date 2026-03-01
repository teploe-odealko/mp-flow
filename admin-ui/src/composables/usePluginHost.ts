import { apiRequest } from "./useApi";
import { esc, formatMoney, formatDateTime } from "../utils/format";
import { useUiStore } from "../stores/ui";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

/**
 * Lightweight "state snapshot" exposed to plugins.
 */
export interface PluginHostState {
  [key: string]: unknown;
}

export type CardTabRenderFn = (
  container: HTMLElement,
  detail: unknown,
) => void | Promise<void>;

interface CardTabContribution {
  id: string;
  label: string;
  pluginName: string;
  renderFn: CardTabRenderFn | null;
}

export interface PluginHost {
  apiRequest: typeof apiRequest;
  esc: typeof esc;
  formatMoney: typeof formatMoney;
  formatDate: typeof formatDateTime;
  showToast: (message: string, type?: "info" | "success" | "error") => void;
  getState: () => PluginHostState;
  getCardDetail: () => unknown;
  registerCardTabRenderer: (tabId: string, renderFn: CardTabRenderFn) => void;
}

/* ------------------------------------------------------------------ */
/* Module-level plugin contributions registry                         */
/* ------------------------------------------------------------------ */

export const pluginContributions: { cardTabs: CardTabContribution[] } = {
  cardTabs: [],
};

/* ------------------------------------------------------------------ */
/* State accessors (filled by the app after bootstrap)                */
/* ------------------------------------------------------------------ */

let _getStateFn: (() => PluginHostState) | null = null;
let _getCardDetailFn: (() => unknown) | null = null;

/**
 * Set the state accessor functions that plugins will use.
 * Should be called once from the main app setup after stores are ready.
 */
export function setPluginHostAccessors(
  getState: () => PluginHostState,
  getCardDetail: () => unknown,
): void {
  _getStateFn = getState;
  _getCardDetailFn = getCardDetail;
}

/* ------------------------------------------------------------------ */
/* Composable                                                         */
/* ------------------------------------------------------------------ */

/**
 * Creates and freezes `window.PluginHost` with the same API surface
 * as the vanilla app.js PluginHost.
 *
 * Should be called once from the root App component or main.ts setup.
 *
 * The returned object is also the frozen PluginHost for convenience.
 */
export function usePluginHost(): PluginHost {
  const ui = useUiStore();

  const host: PluginHost = Object.freeze({
    apiRequest,
    esc,
    formatMoney,
    formatDate: formatDateTime,

    showToast(message: string, type: "info" | "success" | "error" = "info") {
      ui.addToast(message, type);
    },

    getState(): PluginHostState {
      if (_getStateFn) return _getStateFn();
      return {};
    },

    getCardDetail(): unknown {
      if (_getCardDetailFn) return _getCardDetailFn();
      return null;
    },

    registerCardTabRenderer(tabId: string, renderFn: CardTabRenderFn): void {
      const existing = pluginContributions.cardTabs.find(
        (t) => t.id === tabId,
      );
      if (existing) {
        existing.renderFn = renderFn;
      }
    },
  });

  // Expose globally for plugins loaded via <script> or dynamic import
  (window as unknown as Record<string, unknown>).PluginHost = host;

  return host;
}
