import { ozonPlugin } from "./ozon";
import type { MarketplacePlugin } from "./types";
import { wildberriesPlugin } from "./wildberries";

const plugins = [ozonPlugin, wildberriesPlugin];

export class PluginRegistry {
  all(): MarketplacePlugin[] {
    return plugins;
  }

  get(code: string): MarketplacePlugin {
    const plugin = plugins.find((candidate) => candidate.code === code);
    if (!plugin) {
      throw new Error(`Unknown marketplace plugin: ${code}`);
    }
    return plugin;
  }
}

export const pluginRegistry = new PluginRegistry();
