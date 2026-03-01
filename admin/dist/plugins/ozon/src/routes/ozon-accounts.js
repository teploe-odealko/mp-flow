import { Hono } from "hono";
import { getUserIdOptional } from "../../../../src/server/core/auth.js";
const ozonAccountsRoutes = new Hono();
// GET /api/ozon-accounts — list accounts
ozonAccountsRoutes.get("/", async (c) => {
    const container = c.get("container");
    const userId = getUserIdOptional(c);
    const ozonService = container.resolve("ozonService");
    const filters = {};
    if (userId)
        filters.user_id = userId;
    const accounts = await ozonService.listOzonAccounts(filters);
    return c.json({ accounts });
});
// POST /api/ozon-accounts — create account
ozonAccountsRoutes.post("/", async (c) => {
    const container = c.get("container");
    const userId = getUserIdOptional(c);
    const { name, client_id, api_key } = await c.req.json();
    if (!name || !client_id || !api_key) {
        return c.json({ error: "name, client_id and api_key are required" }, 400);
    }
    const ozonService = container.resolve("ozonService");
    const account = await ozonService.createOzonAccount({
        name,
        client_id,
        api_key,
        is_active: true,
        user_id: userId || undefined,
    });
    return c.json({ account }, 201);
});
// POST /api/ozon-accounts/verify — test API connection
ozonAccountsRoutes.post("/verify", async (c) => {
    const container = c.get("container");
    const { client_id, api_key } = await c.req.json();
    if (!client_id || !api_key) {
        return c.json({ ok: false, error: "client_id and api_key are required" }, 400);
    }
    const ozonService = container.resolve("ozonService");
    try {
        const result = await ozonService.ozonApiCall({ client_id, api_key }, "/v1/seller/info");
        return c.json({
            ok: true,
            seller_name: result.name || result.company_name || "OK",
        });
    }
    catch (e) {
        return c.json({ ok: false, error: e.message });
    }
});
// PUT /api/ozon-accounts/:id — update account
ozonAccountsRoutes.put("/:id", async (c) => {
    const { id } = c.req.param();
    const container = c.get("container");
    const userId = getUserIdOptional(c);
    const data = await c.req.json();
    const ozonService = container.resolve("ozonService");
    const existing = await ozonService.retrieveOzonAccount(id);
    if (userId && existing.user_id && existing.user_id !== userId) {
        return c.json({ message: "Not found" }, 404);
    }
    const account = await ozonService.updateOzonAccount(id, data);
    return c.json({ account });
});
// DELETE /api/ozon-accounts/:id — delete account
ozonAccountsRoutes.delete("/:id", async (c) => {
    const { id } = c.req.param();
    const container = c.get("container");
    const userId = getUserIdOptional(c);
    const ozonService = container.resolve("ozonService");
    const existing = await ozonService.retrieveOzonAccount(id);
    if (userId && existing.user_id && existing.user_id !== userId) {
        return c.json({ message: "Not found" }, 404);
    }
    await ozonService.deleteOzonAccount(id);
    return c.json({ id, deleted: true });
});
export default ozonAccountsRoutes;
//# sourceMappingURL=ozon-accounts.js.map