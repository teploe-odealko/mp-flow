import { ozonPlugin } from "./ozon";
import type { MarketplacePlugin } from "./types";

const plugins = [ozonPlugin];

export class PluginRegistry {
  all(): MarketplacePlugin[] {
    return plugins;
  }

  /** Небросающий поиск: для кодов из БД (легаси-каналы, удалённые интеграции) возвращает undefined. */
  find(code: string): MarketplacePlugin | undefined {
    return this.all().find((candidate) => candidate.code === code);
  }

  get(code: string): MarketplacePlugin {
    const plugin = this.find(code);
    if (!plugin) {
      throw new Error(`Unknown marketplace plugin: ${code}`);
    }
    return plugin;
  }
}

export const pluginRegistry = new PluginRegistry();
