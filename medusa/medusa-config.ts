import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

module.exports = defineConfig({
  plugins: [
    { resolve: "mpflow-plugin-ozon" },
  ],
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "mpflow-jwt-secret",
      cookieSecret: process.env.COOKIE_SECRET || "mpflow-cookie-secret",
    },
  },
  admin: {
    backendUrl: process.env.MEDUSA_BACKEND_URL || "",
    vite: () => ({
      plugins: [
        {
          name: "mpflow-admin-customization",
          transformIndexHtml(html: string) {
            const css = `
              <style>
                /* ── Hide built-in Medusa sidebar items ── */
                aside nav > div:has(a[href="/app/orders"]),
                aside nav > div:has(a[href="/app/products"]),
                aside nav > div:has(a[href="/app/inventory"]),
                aside nav > div:has(a[href="/app/customers"]),
                aside nav > div:has(a[href="/app/promotions"]),
                aside nav > div:has(a[href="/app/price-lists"]) {
                  display: none !important;
                }

                /* ── Hide "Extensions" collapsible header ── */
                aside .px-4:has(> button > p) {
                  display: none !important;
                }

                /* ── MPFlow brand: sidebar logo ── */
                aside button[aria-haspopup="menu"] > span:first-child {
                  background: url('https://mp-flow.ru/logo.png') center/cover no-repeat !important;
                  border-radius: 6px !important;
                }
                aside button[aria-haspopup="menu"] > span:first-child > span {
                  visibility: hidden !important;
                }

                /* ── MPFlow brand: accent color overrides ── */
                :root {
                  --fg-interactive: #0EA5E9 !important;
                  --fg-interactive-hover: #38BDF8 !important;
                }
                button[class*="bg-ui-button-inverted"],
                button.bg-ui-button-inverted {
                  background-color: #0EA5E9 !important;
                }
                button[class*="bg-ui-button-inverted"]:hover,
                button.bg-ui-button-inverted:hover {
                  background-color: #0284C7 !important;
                }

                /* ── Settings: hide irrelevant sections ── */
                /* General section: hide Regions, Tax, Returns, Refunds, Sales Channels, Product Types/Tags, Locations */
                a[href="/app/settings/regions"],
                a[href="/app/settings/tax-regions"],
                a[href="/app/settings/return-reasons"],
                a[href="/app/settings/refund-reasons"],
                a[href="/app/settings/sales-channels"],
                a[href="/app/settings/product-types"],
                a[href="/app/settings/product-tags"],
                a[href="/app/settings/locations"],
                a[href="/app/settings/store"] {
                  display: none !important;
                }
              </style>
            `

            // Fetch interceptor MUST load in <head> before the React bundle,
            // otherwise the Medusa SDK captures native fetch at import time.
            const headScript = `
              <script>
                // Intercept logout: end Logto session + clear SDK state
                (function() {
                  var _origFetch = window.fetch;
                  window.fetch = function() {
                    var args = arguments;
                    var url = (args[0] && typeof args[0] === 'object') ? args[0].toString() : String(args[0] || '');
                    var method = (args[1] && args[1].method) ? args[1].method
                      : (args[0] && typeof args[0] === 'object' && args[0].method) ? args[0].method : 'GET';
                    method = method.toUpperCase();
                    var result = _origFetch.apply(this, args);
                    if (url.indexOf('/auth/session') !== -1 && method === 'DELETE') {
                      result.then(function() {
                        // Clear @logto/browser SDK localStorage
                        Object.keys(localStorage).forEach(function(k) {
                          if (k.startsWith('logto:')) localStorage.removeItem(k);
                        });
                        _origFetch('/auth/logto-config').then(function(r) { return r.json(); }).then(function(cfg) {
                          if (cfg.endpoint && cfg.app_id) {
                            var returnUrl = window.location.origin + '/app/login';
                            window.location.href = cfg.endpoint + '/oidc/session/end?client_id=' + cfg.app_id + '&post_logout_redirect_uri=' + encodeURIComponent(returnUrl);
                          } else {
                            window.location.href = '/app/login';
                          }
                        }).catch(function() {
                          window.location.href = '/app/login';
                        });
                      });
                    }
                    return result;
                  };
                })();
              </script>
            `

            const bodyScript = `
              <script>
                // Redirect /app/orders → /app/catalog (default landing page)
                if (window.location.pathname === '/app' || window.location.pathname === '/app/orders') {
                  window.history.replaceState(null, '', '/app/catalog');
                }

                // Hide unwanted items from Command Palette (Search modal)
                var HIDDEN_CMDK = [
                  'campaigns', 'categories', 'collections', 'customer groups',
                  'customers', 'inventory', 'orders', 'price lists', 'products',
                  'promotions', 'reservations',
                  'locations', 'product types', 'regions', 'return reasons',
                  'sales channels', 'store', 'tax regions',
                ];
                new MutationObserver(function() {
                  document.querySelectorAll('[cmdk-item]').forEach(function(el) {
                    var val = el.getAttribute('data-value') || '';
                    if (HIDDEN_CMDK.some(function(h) { return val.startsWith(h); })) {
                      el.style.display = 'none';
                    }
                  });
                  document.querySelectorAll('[cmdk-group]').forEach(function(g) {
                    var items = g.querySelectorAll('[cmdk-item]');
                    if (items.length > 0 && Array.from(items).every(function(i) { return i.style.display === 'none'; })) {
                      g.style.display = 'none';
                    }
                  });
                }).observe(document.documentElement, { childList: true, subtree: true });

                // MPFlow branding: favicon + title
                document.title = 'MPFlow';
                var favLink = document.querySelector('link[rel="icon"]') || document.createElement('link');
                favLink.rel = 'icon';
                favLink.href = 'https://mp-flow.ru/favicon.png';
                if (!favLink.parentNode) document.head.appendChild(favLink);

                // MPFlow branding: replace "Medusa Store" with "MPFlow"
                // + redirect Documentation link in user popup to MPFlow docs
                new MutationObserver(function() {
                  var btn = document.querySelector('aside button[aria-haspopup="menu"]');
                  if (btn) {
                    var nameEl = btn.querySelector('div p');
                    if (nameEl && nameEl.textContent !== 'MPFlow') {
                      nameEl.textContent = 'MPFlow';
                    }
                  }
                  document.querySelectorAll('a[href*="docs.medusajs.com"]').forEach(function(a) {
                    a.href = 'https://docs.mp-flow.ru';
                  });
                }).observe(document.documentElement, { childList: true, subtree: true });
              </script>
            `

            return html
              .replace("</head>", css + headScript + "</head>")
              .replace("</body>", bodyScript + "</body>")
          },
        },
      ],
    }),
  },
  modules: [
    // ── Custom modules ──────────────────────────────────────────
    { resolve: "./src/modules/master-card" },
    { resolve: "./src/modules/supplier-order" },
    { resolve: "./src/modules/finance" },
    { resolve: "./src/modules/sale" },

    // ── Auth module: emailpass only (Logto handled client-side) ────
    {
      resolve: "@medusajs/medusa/auth",
      options: {
        providers: [
          // Built-in emailpass provider (required for CLI user creation)
          {
            resolve: "@medusajs/medusa/auth-emailpass",
            id: "emailpass",
            options: {},
          },
        ],
      },
    },

    // ── Disable ALL unused built-in e-commerce modules ──────────
    // These are auto-added by defineConfig() — override with disable.
    // @ts-ignore — key is valid at runtime for built-in module overrides
    { key: "product", disable: true },
    // @ts-ignore
    { key: "order", disable: true },
    // @ts-ignore
    { key: "cart", disable: true },
    // @ts-ignore
    { key: "customer", disable: true },
    // @ts-ignore
    { key: "fulfillment", disable: true },
    // @ts-ignore
    { key: "payment", disable: true },
    // @ts-ignore
    { key: "promotion", disable: true },
    // @ts-ignore
    { key: "inventory", disable: true },
    // @ts-ignore
    { key: "stock_location", disable: true },
    // @ts-ignore
    { key: "tax", disable: true },
    // @ts-ignore
    { key: "pricing", disable: true },
    // @ts-ignore
    { key: "sales_channel", disable: true },
    // @ts-ignore
    { key: "region", disable: true },
    // @ts-ignore
    { key: "notification", disable: true },
  ],
})
