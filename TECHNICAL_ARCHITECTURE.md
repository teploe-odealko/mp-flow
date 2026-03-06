# MPFlow — Техническая архитектура

## Высокоуровневая архитектура

```
┌─────────────────────────────────────────────────────────────┐
│                      БРАУЗЕР (React)                         │
│                                                             │
│  ┌──────────────┬─────────────┬──────────────────┐         │
│  │   Каталог    │  Закупки    │  Аналитика    │  ...     │
│  │  (Client)    │  (Client)   │  (Client)      │         │
│  └──────────────┴─────────────┴──────────────────┘         │
│          ↑                                                   │
│          │ HTTP REST                                        │
│          │ TanStack Query (caching)                         │
│          ↓                                                   │
├─────────────────────────────────────────────────────────────┤
│                    BACKEND (Hono)                            │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │            API Routes (REST)                         │  │
│  │  /api/catalog   /api/finance   /api/analytics ...   │  │
│  └──────────────────────────────────────────────────────┘  │
│                          ↑                                   │
│         ┌────────────────┼────────────────┐                │
│         ↓                ↓                ↓                │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Services   │  │  Middleware  │  │  Workflows   │      │
│  │ (Business   │  │ (enrichment) │  │ (business    │      │
│  │  logic)     │  │              │  │  logic)      │      │
│  └─────────────┘  └──────────────┘  └──────────────┘      │
│         ↑                                                   │
│         │ Dependency Injection (awilix)                    │
│         │                                                   │
│         ↓                                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │    Modules (MikroORM Entities + Services)           │  │
│  │  MasterCard  FinanceTransaction  SupplierOrder ...  │  │
│  └──────────────────────────────────────────────────────┘  │
│         ↑                                                   │
│         │                                                   │
│         ↓                                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │    MCP Server (Model Context Protocol)              │  │
│  │  - 54+ Tools (list_products, create_order, etc.)    │  │
│  │  - Resources (ozon://categories, etc.)              │  │
│  └──────────────────────────────────────────────────────┘  │
│         ↑                                                   │
│         │ HTTP (MCP Streamable Protocol)                   │
│         │                                                   │
└─────────────────────────────────────────────────────────────┤
          │                                                   │
          │                                                   │
┌─────────────────────────────────────────────────────────────┐
│                AI AGENTS (External)                         │
│                                                             │
│  Claude Code   │  Cursor  │  Codex  │  Other MCP clients │
│  (вызывают tools via MCP)                                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  DATABASE (PostgreSQL)                       │
│                                                             │
│  ┌──────────────┬──────────────┬──────────────┐           │
│  │ master_cards │ fin_trans    │ supp_orders │  ...      │
│  └──────────────┴──────────────┴──────────────┘           │
│                                                             │
│  + Plugin tables (auto-created)                            │
│  + ozon_integration, ali1688_products, etc.               │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. Frontend Architecture

### 1.1 Структура

```
admin/src/client/
├── main.tsx                 # React entry point
├── app/
│   ├── layout.tsx          # Main layout + sidebar navigation
│   ├── auth-provider.tsx   # Authentication context
├── pages/
│   ├── catalog/page.tsx    # Catalog page
│   ├── procurement/page.tsx # Procurement forecasting
│   ├── finance/page.tsx    # Finance/ДДС
│   ├── analytics/page.tsx  # P&L + Unit Economics
│   ├── sales/page.tsx      # Sales list
│   ├── warehouse/page.tsx  # Inventory
│   ├── suppliers/page.tsx  # Supplier orders
│   ├── plugins/page.tsx    # Plugin management
│   ├── settings/page.tsx   # Settings
│   └── billing/page.tsx    # Subscription
├── components/
│   ├── paywall.tsx         # Subscription wall
│   ├── doc-table-header.tsx # Sortable column headers
│   └── ... (small components)
├── lib/
│   ├── api.ts              # HTTP client (fetch wrapper)
│   └── use-url-state.ts    # URL-based state management
└── styles/
    └── globals.css         # Tailwind + custom CSS
```

### 1.2 Технологии

| Layer | Tech |
|-------|------|
| Framework | React 19 |
| Build | Vite 6 |
| Styling | Tailwind CSS 3 |
| State Management | React Context + TanStack Query 5 |
| Routing | React Router 7 |
| HTTP | Fetch API (custom wrapper) |
| Form Handling | React hooks + native inputs |

### 1.3 Key Patterns

**TanStack Query (React Query):**
```typescript
const { data, isLoading, error } = useQuery({
  queryKey: ["catalog"],
  queryFn: () => apiGet("/api/catalog"),
  staleTime: 30_000,
})
```

**URL State Management:**
```typescript
const [page, setPage] = useUrlNumber("page")
const [filterType, setFilterType] = useUrlState("type")
// URL: ?page=2&type=ozon → параметры в URL для shareable links
```

**Lazy Loading для плагинов:**
```typescript
const pluginPageModules = import.meta.glob<{ default: React.ComponentType }>(
  "../../plugins/*/src/client/page.tsx",
)
// Convention-based: плагины добавляют page.tsx → автоматически маршрутируются
```

---

## 2. Backend Architecture

### 2.1 Структура

```
admin/src/server/
├── index.ts                 # Server entry point + initialization
├── app.ts                   # Hono app setup
├── core/
│   ├── mikro-orm.ts        # ORM initialization
│   ├── container.ts        # DI container (awilix)
│   ├── request-scope.ts    # Request-scoped DI
│   ├── plugin-loader.ts    # Plugin discovery + loading
│   ├── session.ts          # Session management (iron-session)
│   └── subscription.ts     # Subscription middleware
├── modules/                 # Core domain modules
│   ├── master-card/        # Product catalog
│   ├── supplier-order/     # Procurement
│   ├── finance/            # Financial transactions
│   ├── sale/               # Sales
│   ├── api-key/            # API keys
│   ├── file-storage/       # File uploads
│   └── plugin-setting/     # Plugin configuration
├── routes/                  # API endpoints
│   ├── catalog.ts
│   ├── procurement.ts
│   ├── finance.ts
│   ├── analytics.ts
│   ├── sales.ts
│   ├── inventory.ts
│   ├── suppliers.ts
│   ├── plugins.ts
│   ├── auth.ts
│   └── ... (15+ routes)
├── workflows/               # Complex business logic
│   ├── receive-order.ts    # Order reception + cost allocation
│   ├── create-sale.ts      # Sale creation + inventory deduction
│   ├── return-sale.ts      # Return handling
│   ├── write-off.ts        # Inventory write-off
│   └── initial-balance.ts  # Initial inventory
├── mcp/                     # MCP Server
│   ├── server.ts           # MCP protocol handler
│   ├── tools.ts            # Tool definitions (54+ tools)
│   └── openapi.ts          # OpenAPI spec generation
└── migrations/              # Database migrations
    ├── Migration_*.ts       # Versioned migrations
```

### 2.2 Request Flow

```
1. HTTP Request
   ↓
2. Middleware (Auth, Subscription check, etc.)
   ↓
3. Route Handler
   ├─ Get EM (Entity Manager) fork for this request
   ├─ Resolve services from DI container (request-scoped)
   ↓
4. Service Layer
   ├─ Business logic
   ├─ Database operations via MikroORM
   ├─ May call Workflows
   ↓
5. Workflow (if needed)
   ├─ Complex multi-step operations
   ├─ Cost calculations, allocations
   ↓
6. Response
   └─ JSON serialization
```

### 2.3 Dependency Injection (awilix)

```typescript
// Container setup
const container = createContainer({
  strict: true,
  injectionMode: 'CLASSIC',
})

container.register({
  masterCardService: asClass(MasterCardService).scoped(),
  financeService: asClass(FinanceService).scoped(),
  // ... more services
})

// Per-request scope
const scope = container.createScope()
const service = scope.resolve('masterCardService')
```

**Benefits:**
- Services don't depend on each other directly
- Easy to test (mock dependencies)
- Scoped instances (fresh per request)

### 2.4 Request-Scoped EM (Entity Manager)

```typescript
// In every route handler:
const em = orm.em.fork()
const container = createRequestScope(em, baseContainer)

// Services fetched from container get the forked EM
const service = container.resolve('masterCardService')
// service.em is the forked EM, not the shared one

// Benefits:
// - Transaction isolation
// - Avoid stale data
// - Easy rollback on error
```

---

## 3. Database Layer (MikroORM)

### 3.1 Entity Structure

```typescript
// Example: MasterCard (Product)
@Entity({ tableName: 'master_cards' })
export class MasterCard {
  @PrimaryKey()
  id!: string

  @Property()
  title!: string

  @Property({ nullable: true })
  description?: string | null

  @Property({ type: 'varchar', length: 50, nullable: true })
  status?: 'active' | 'draft' | 'archived'

  @Property({ type: 'decimal', precision: 12, scale: 2 })
  purchase_price!: number

  @Property({ type: 'varchar', length: 3 })
  purchase_currency!: string // USD, CNY, RUB, etc.

  @Property({ type: 'decimal', precision: 12, scale: 2 })
  avg_cost!: number // Weighted average cost

  @Property({ type: 'decimal', precision: 10, scale: 2 })
  weight_g?: number

  @Property()
  created_at = new Date()

  @Property({ onUpdate: () => new Date() })
  updated_at = new Date()
}
```

### 3.2 Relationships

```typescript
@Entity()
export class SupplierOrder {
  @PrimaryKey()
  id!: string

  @Property()
  supplier_name!: string

  @OneToMany(() => SupplierOrderItem, (item) => item.order, {
    eager: true,
  })
  items = new Collection<SupplierOrderItem>(this)

  @Property()
  status!: 'draft' | 'ordered' | 'shipped' | 'received' | 'cancelled'

  @Property()
  created_at = new Date()
}

@Entity()
export class SupplierOrderItem {
  @PrimaryKey()
  id!: string

  @ManyToOne(() => SupplierOrder)
  order!: SupplierOrder

  @ManyToOne(() => MasterCard)
  master_card!: MasterCard

  @Property()
  ordered_qty!: number

  @Property()
  received_qty!: number

  @Property({ type: 'decimal', precision: 12, scale: 4 })
  unit_cost!: number // After allocation

  @Property({ type: 'decimal', precision: 14, scale: 2 })
  total_cost!: number // unit_cost * ordered_qty (for received)
}
```

### 3.3 Migrations

**Manual migrations (core):**
```bash
npm run db:migrate
```

Creates files in `admin/src/server/migrations/Migration_*.ts`

**Auto-schema (plugins):**
```typescript
// In server/index.ts:
const generator = orm.getSchemaGenerator()
const diff = await generator.getUpdateSchemaSQL({ safe: true })
await generator.updateSchema({ safe: true })
// Creates new tables + adds columns (no drops)
```

---

## 4. MCP Server Integration

### 4.1 What is MCP?

**Model Context Protocol** — open protocol for AI agents to interact with external systems.

**Flow:**
```
AI Agent (Claude Code)
  ↓ (via HTTP POST)
MCP Server (MPFlow)
  ↓ (parses tool request)
Tool Handler
  ↓ (calls service/API)
Database
  ↓ (returns data)
AI Agent (sees result)
```

### 4.2 Tool Definition

```typescript
export const CORE_TOOLS: ApiTool[] = [
  {
    name: "list_products",
    description: "Get list of products with search and filtering",
    method: "GET",
    path: "/api/catalog",
    params: {
      q: { type: "string", description: "Search by title", in: "query" },
      limit: { type: "number", description: "Limit (default 50)", in: "query" },
      offset: { type: "number", description: "Offset", in: "query" },
    },
  },
  // ... 53 more tools
]
```

### 4.3 MCP Server Handler

```typescript
export function createMcpHandler(orm: MikroORM, container: InjectionContainer) {
  return async (req: Request): Promise<Response> => {
    const body = await req.json()

    // Parse MCP request
    const { jsonrpc, method, params, id } = body

    if (method === "tools/list") {
      return {
        tools: CORE_TOOLS.concat(pluginTools),
        resources: getPluginResources(),
      }
    }

    if (method === "tools/call") {
      const tool = findTool(params.name)
      const requestScope = createRequestScope(orm.em.fork(), container)

      // Call the actual route handler
      const response = await callRoute(
        tool.method,
        tool.path,
        params.arguments,
        requestScope
      )

      return { result: response, id }
    }
  }
}
```

### 4.4 Resources (for context)

```typescript
export function getOzonMcpResources(): McpResourceDef[] {
  return [
    {
      uri: "ozon://categories",
      name: "Ozon API Categories",
      description: "Index of all Ozon Seller API endpoints",
      text: buildCategoryIndex(), // Machine-readable documentation
    },
    // One resource per API category
    {
      uri: "ozon://category/Product Management",
      text: buildCategoryContent('Product Management'),
    },
  ]
}
```

**Benefit for AI:**
- Agent can read documentation without internet
- Understands what methods do before calling them
- More accurate decisions

---

## 5. Plugin System

### 5.1 Plugin Definition

```typescript
// admin/plugins/ozon/plugin.ts
export default definePlugin({
  name: "mpflow-plugin-ozon",
  label: "Ozon",
  description: "Sync products, inventory, sales with Ozon FBO",
  docsUrl: "https://docs.mp-flow.ru/docs/plugins/ozon",

  // Optional: discovered automatically from folder structure
  mcpTools: () => import('./src/mcp/ozon-mcp'),
  mcpResources: () => getOzonMcpResources(),
})
```

### 5.2 Convention-Based Discovery

```
admin/plugins/ozon/
├── plugin.ts                    # Plugin definition
├── src/
│   ├── entities/
│   │   └── ozon-integration.ts # Auto-discovered + registered
│   ├── services/
│   │   └── ozon-service.ts     # Auto-discovered
│   ├── routes/
│   │   ├── ozon-sync.ts        # Auto-discovered
│   │   └── ozon-proxy.ts       # Auto-discovered
│   ├── middleware/
│   │   └── catalog-enrichment.ts # Auto-discovered
│   ├── workflows/
│   │   ├── sync-ozon-products.ts
│   │   ├── sync-ozon-sales.ts
│   │   └── ... (auto-discovered)
│   ├── client/
│   │   └── page.tsx            # Lazy-loaded in UI
│   ├── nav.ts                  # Sidebar navigation
│   ├── column-docs.ts          # Field documentation
│   └── mcp/
│       ├── ozon-mcp.ts         # MCP tools + resources
│       └── ozon-api-reference.ts
└── package.json
```

### 5.3 Automatic Registration

```typescript
// In core server/index.ts:
const pluginPaths = [
  { resolve: "./plugins/ozon" },
  { resolve: "./plugins/ali1688" },
  { resolve: "./plugins/photo-studio" },
]

const pluginEntities = await collectPluginEntities(pluginPaths)
// Discovers all Entity classes in src/entities/

const orm = await initORM({
  entities: [...coreEntities, ...pluginEntities],
})
// Tables are created automatically
```

### 5.4 Plugin Service Example

```typescript
export class OzonService {
  constructor(private em: EntityManager, private logger: Logger) {}

  async syncOzonProducts(accountId: string) {
    const integration = await this.em.findOne(OzonIntegration, { id: accountId })
    if (!integration) throw new Error("Integration not found")

    // Fetch from Ozon API
    const ozonProducts = await fetch('https://api-seller.ozon.ru/v3/product/list', {
      headers: { 'Client-Id': integration.client_id },
    })

    // Map to MasterCard
    for (const ozonProduct of ozonProducts) {
      let masterCard = await this.em.findOne(MasterCard, {
        external_id: ozonProduct.id,
      })
      if (!masterCard) {
        masterCard = new MasterCard()
      }
      masterCard.title = ozonProduct.name
      masterCard.external_id = ozonProduct.id

      await this.em.persistAndFlush(masterCard)
    }

    return { synced_count: ozonProducts.length }
  }
}
```

---

## 6. Authentication & Authorization

### 6.1 Auth Modes

| Mode | Mechanism | Use Case |
|------|-----------|----------|
| **dev** | Auto-login (no auth) | Local development |
| **selfhosted** | Email + password | Self-hosted instances |
| **logto** | OIDC (Logto provider) | Cloud version |

### 6.2 Session Management (iron-session)

```typescript
// encrypted cookie → no server-side session store needed

const session = await getSession(req, {
  password: COOKIE_SECRET,
  cookieName: 'mpflow-session',
  cookieOptions: {
    httpOnly: true,
    secure: !isDev,
    sameSite: 'lax',
  },
})

session.user = { id: userId, email: userEmail }
await session.save()
```

**Benefits:**
- Stateless (no Redis needed)
- Encrypted (can't forge tokens)
- HTTP-only cookies (CSRF safe)

### 6.3 Subscription Middleware

```typescript
export const subscriptionMiddleware = async (c: Context, next: () => Promise<void>) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  const subscription = await getSubscription(user.id)

  if (isLogtoMode && !subscription.active) {
    return c.json({ error: 'Subscription expired' }, 402)
  }

  c.set('subscription', subscription)
  await next()
}
```

---

## 7. Key Workflows (Business Logic)

### 7.1 Receive Order Workflow

**Input:**
```typescript
{
  supplier_order_id: "ord-123",
  items: [
    { item_id: "item-1", received_qty: 100 },
    { item_id: "item-2", received_qty: 50 },
  ],
  write_off_method: "redistribute" // or "ignore"
}
```

**Process:**
1. Fetch order + items
2. Fetch shared expenses (logistics, customs, packaging)
3. Allocate shared costs by method:
   - `by_price`: proportional to unit cost
   - `by_weight`: proportional to weight
   - `equal`: equally among all units
4. Calculate unit cost for each item:
   - If `redistribute` and shortfall: absorb missing qty cost
   - If `ignore` or no shortfall: normal cost
5. Update item.unit_cost and item.total_cost
6. Update MasterCard.avg_cost (weighted average)
7. Create FinanceTransaction entries
8. Mark order as received

**Example:**
```
Order: 100 units @ $20/unit = $2,000
Shipping: $300
Customs: $100

Allocated:
- Item 1: 100 units @ $20 + $300 (by_weight, 60%) + $100/2 = $2,350
- Item 2: 50 units @ $20 + $0 (no weight) + $100/2 = $1,050

Unit cost:
- Item 1: $2,350 / 100 = $23.50
- Item 2: $1,050 / 50 = $21.00
```

### 7.2 Create Sale Workflow

**Input:**
```typescript
{
  master_card_id: "card-1",
  quantity: 5,
  price_rub: 1500,
  channel: "ozon",
  metadata: { order_id: "ozon-123" }
}
```

**Process:**
1. Fetch product
2. Deduct from inventory (FIFO by batch)
3. Calculate COGS (weighted average from batches)
4. Create FinanceTransaction (revenue)
5. Create FinanceAccrual (COGS if needed)
6. Return sale record with calculated profit

**Example:**
```
Product in stock:
- Batch 1: 3 units @ $20 = $60
- Batch 2: 5 units @ $25 = $125

Sale: 5 units @ $300

FIFO deduction:
- Take 3 from Batch 1: COGS = $60
- Take 2 from Batch 2: COGS = $50
- Total COGS = $110

Revenue = $1,500
COGS = $110
Profit = $1,390
```

### 7.3 Sync Ozon Sales Workflow

**Periodic sync:**
```typescript
async function syncOzonSales(integration: OzonIntegration, since: Date) {
  const ozonSales = await ozonClient.getSales(since)

  for (const ozonSale of ozonSales) {
    // Create if not exists
    let sale = await em.findOne(Sale, { external_id: ozonSale.id })

    if (!sale) {
      sale = new Sale()
      sale.external_id = ozonSale.id
    }

    // Update from Ozon
    sale.quantity = ozonSale.quantity
    sale.price = ozonSale.price
    sale.channel = 'ozon'
    sale.status = ozonSale.status // delivered, returned, etc.

    // Trigger sale creation workflow if new
    if (sale.id === undefined) {
      await createSaleWorkflow(...) // creates FinanceTransaction
    }

    await em.persistAndFlush(sale)
  }
}
```

---

## 8. API Response Format

### 8.1 Standard Response

```typescript
// Success
{
  "products": [
    {
      "id": "prod-1",
      "title": "Wireless Headphones",
      "purchase_price": 20,
      "purchase_currency": "USD",
      "warehouse_stock": 150,
      "avg_cost": 23.5
    }
  ]
}

// Error
{
  "error": "Product not found"
}
```

### 8.2 Pagination

```typescript
{
  "items": [...],
  "total_count": 342,
  "limit": 50,
  "offset": 0
}
```

### 8.3 Analytics Response

```typescript
{
  "revenue": 45000,
  "cogs": 18000,
  "gross_profit": 27000,
  "fees": 10500,
  "operating_profit": 16500,
  "margin": 36.7,
  "by_channel": {
    "ozon": {
      "revenue": 40000,
      "fees": 9000,
      "cogs": 16000,
      "profit": 15000
    }
  }
}
```

---

## 9. Performance Considerations

### 9.1 Database Indices

```typescript
// Critical indices for Procurement forecasting
@Index({ properties: ['master_card_id', 'transaction_date'] })
export class Sale { ... }

@Index({ properties: ['supplier_order_id'] })
export class SupplierOrderItem { ... }

@Index({ properties: ['created_at'] })
export class FinanceTransaction { ... }
```

### 9.2 Query Optimization

```typescript
// Eager loading to avoid N+1
const orders = await em.find(SupplierOrder, {}, {
  populate: ['items', 'items.master_card']
})

// vs without populate:
// N+1 queries (1 for orders + N for each order's items)
```

### 9.3 Caching Strategy

**Frontend (TanStack Query):**
```typescript
staleTime: 30_000,      // 30 sec fresh
gcTime: 5 * 60 * 1000,  // 5 min cached
```

**Backend:**
- EM fork per request (no global caching needed)
- Database handles caching (PostgreSQL query cache)

---

## 10. Testing Strategy

### 10.1 Unit Tests (Services)

```typescript
describe('MasterCardService', () => {
  let service: MasterCardService
  let mockEM: EntityManager

  beforeEach(() => {
    mockEM = createMockEntityManager()
    service = new MasterCardService(mockEM, logger)
  })

  it('should calculate weighted average cost', async () => {
    // Mock data
    mockEM.findOne.mockResolvedValue(product)

    // Test
    const result = await service.calculateAvgCost('prod-1')

    expect(result).toBe(23.5)
  })
})
```

### 10.2 Integration Tests (Workflows)

```typescript
describe('Receive Order Workflow', () => {
  it('should allocate shared costs correctly', async () => {
    // Setup: create order, items, expenses in test DB
    const order = await createOrder(em, { ... })
    await em.persistAndFlush(order)

    // Execute
    await receiveOrder(container, {
      supplier_order_id: order.id,
      items: [...],
      write_off_method: 'redistribute'
    })

    // Verify
    const updatedOrder = await em.findOne(SupplierOrder, order.id)
    expect(updatedOrder.status).toBe('received')
    // Check costs are allocated correctly
  })
})
```

### 10.3 End-to-End Tests (via Browser)

```bash
# Using Playwright or Cypress
npm run test:e2e

# Example: test procurement forecast workflow
1. Navigate to /procurement
2. Verify timeline bars render
3. Click create order
4. Verify order appears in /suppliers
```

---

## 11. Deployment

### 11.1 Production Docker Image

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy source
COPY admin .

# Build
RUN npm ci && npm run build

# Runtime
EXPOSE 3000
ENV NODE_ENV=production
CMD ["npm", "start"]
```

### 11.2 Env Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/mpflow
DB_PASSWORD=<random>

# Session
COOKIE_SECRET=<32 char random base64>

# Optional
PORT=3000
LOGTO_ENDPOINT=https://auth.example.com
LOGTO_APP_ID=<app_id>
LOGTO_APP_SECRET=<secret>

# Ozon integration
OZON_API_BASE=https://api-seller.ozon.ru
```

### 11.3 Auto-migrations

```typescript
// In server/index.ts
const migrator = orm.getMigrator()
const pending = await migrator.getPendingMigrations()
if (pending.length > 0) {
  await migrator.up()
}
```

---

## Summary

**MPFlow architecture is:**
- ✅ Monolithic but modular (plugins can extend)
- ✅ Request-scoped DI (no global state)
- ✅ Type-safe throughout (TypeScript)
- ✅ Convention-over-configuration (plugins auto-discovered)
- ✅ AI-native (MCP server built-in)
- ✅ Database-centric (ORM handles complexity)

**Key design principles:**
1. Plugins don't modify core
2. Workflows encapsulate complex business logic
3. Services are stateless (depend on injected EM)
4. Middleware enriches data without changing APIs
5. MCP tools mirror REST APIs (same handlers)
