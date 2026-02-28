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

            const script = `
              <script>
                // Redirect /app/orders → /app/catalog (default landing page)
                if (window.location.pathname === '/app' || window.location.pathname === '/app/orders') {
                  window.history.replaceState(null, '', '/app/catalog');
                }

                // Hide unwanted items from Command Palette (Search modal)
                const HIDDEN_CMDK = [
                  'campaigns', 'categories', 'collections', 'customer groups',
                  'customers', 'inventory', 'orders', 'price lists', 'products',
                  'promotions', 'reservations',
                  'locations', 'product types', 'regions', 'return reasons',
                  'sales channels', 'store', 'tax regions',
                ];
                new MutationObserver(() => {
                  document.querySelectorAll('[cmdk-item]').forEach(el => {
                    const val = el.getAttribute('data-value') || '';
                    if (HIDDEN_CMDK.some(h => val.startsWith(h))) {
                      el.style.display = 'none';
                    }
                  });
                  // Hide group headers when all items inside are hidden
                  document.querySelectorAll('[cmdk-group]').forEach(g => {
                    const items = g.querySelectorAll('[cmdk-item]');
                    if (items.length > 0 && Array.from(items).every(i => i.style.display === 'none')) {
                      g.style.display = 'none';
                    }
                  });
                }).observe(document.documentElement, { childList: true, subtree: true });

                // MPFlow branding: favicon + title
                document.title = 'MPFlow';
                const favLink = document.querySelector('link[rel="icon"]') || document.createElement('link');
                favLink.rel = 'icon';
                favLink.href = 'https://mp-flow.ru/favicon.png';
                if (!favLink.parentNode) document.head.appendChild(favLink);

                // MPFlow branding: replace "Medusa Store" with "MPFlow"
                new MutationObserver((_, obs) => {
                  const btn = document.querySelector('aside button[aria-haspopup="menu"]');
                  if (btn) {
                    const nameEl = btn.querySelector('div p');
                    if (nameEl && nameEl.textContent !== 'MPFlow') {
                      nameEl.textContent = 'MPFlow';
                    }
                  }
                }).observe(document.documentElement, { childList: true, subtree: true });

                // Intercept logout: also end Logto session to prevent auto-re-login
                const _origFetch = window.fetch;
                window.fetch = async function(...args) {
                  const res = await _origFetch.apply(this, args);
                  const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
                  const method = (args[1]?.method || 'GET').toUpperCase();
                  if (url.includes('/auth/session') && method === 'DELETE') {
                    // Derive Logto endpoint from hostname (auth.{domain})
                    const host = window.location.hostname;
                    const parts = host.split('.');
                    let logtoEndpoint = '';
                    if (parts.length >= 2) {
                      const baseDomain = parts.slice(-2).join('.');
                      logtoEndpoint = 'https://auth.' + baseDomain;
                    }
                    if (logtoEndpoint) {
                      const returnUrl = window.location.origin + '/app/login';
                      window.location.href = logtoEndpoint + '/oidc/session/end?post_logout_redirect_uri=' + encodeURIComponent(returnUrl);
                    }
                  }
                  return res;
                };
              </script>
            `

            return html
              .replace("</head>", css + "</head>")
              .replace("</body>", script + "</body>")
          },
        },
      ],
    }),
  },
  modules: [
    // ── Custom modules ──────────────────────────────────────────
    { resolve: "./src/modules/master-card" },
    { resolve: "./src/modules/fifo-lot" },
    { resolve: "./src/modules/supplier-order" },
    { resolve: "./src/modules/finance" },

    // ── Auth module: emailpass (default) + Logto OIDC ─────────────
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
          // Logto OIDC provider (optional — only when LOGTO_CLIENT_ID is set)
          ...(process.env.LOGTO_CLIENT_ID ? [{
            resolve: "./src/modules/logto-auth",
            id: "logto",
            options: {
              clientId: process.env.LOGTO_CLIENT_ID,
              clientSecret: process.env.LOGTO_CLIENT_SECRET,
              callbackUrl: process.env.LOGTO_CALLBACK_URL || "http://localhost:9000/app/login?auth_provider=logto",
              endpoint: process.env.LOGTO_ENDPOINT,
            },
          }] : []),
        ],
      },
    },

    // ── Disable heavy built-in e-commerce modules ───────────────
    // These are auto-added by defineConfig() — override with disable.
    // Saves ~80 tables in the database.
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

    // ── Keep light built-in modules (needed by create-defaults) ─
    // pricing, sales_channel, region, currency — ~12 tables total
  ],
})
