import { Hono } from "hono"
import { getUserId } from "../core/auth.js"
import type { SupplierOrderService } from "../modules/supplier-order/service.js"

const suppliersRegistry = new Hono()

// GET /api/suppliers-registry
suppliersRegistry.get("/", async (c) => {
  const service: SupplierOrderService = c.get("container").resolve("supplierOrderService")
  const userId = getUserId(c)
  const { q } = c.req.query()

  const filters: Record<string, any> = {}
  if (userId) filters.user_id = userId
  if (q) filters.name = { $ilike: `%${q}%` }

  const suppliers = await service.listSuppliers(filters, { order: { name: "ASC" } })
  return c.json({ suppliers })
})

// POST /api/suppliers-registry
suppliersRegistry.post("/", async (c) => {
  const service: SupplierOrderService = c.get("container").resolve("supplierOrderService")
  const userId = getUserId(c)
  const body = await c.req.json()

  if (!body.name) return c.json({ error: "Name is required" }, 400)

  const supplier = await service.createSuppliers({
    user_id: userId || null, name: body.name,
    contact: body.contact || null, phone: body.phone || null, notes: body.notes || null,
  })
  return c.json({ supplier }, 201)
})

// GET /api/suppliers-registry/:id
suppliersRegistry.get("/:id", async (c) => {
  const { id } = c.req.param()
  const service: SupplierOrderService = c.get("container").resolve("supplierOrderService")
  const userId = getUserId(c)

  const supplier = await service.retrieveSupplier(id)
  if (userId && (supplier as any).user_id && (supplier as any).user_id !== userId) return c.json({ message: "Not found" }, 404)
  return c.json({ supplier })
})

// PUT /api/suppliers-registry/:id
suppliersRegistry.put("/:id", async (c) => {
  const { id } = c.req.param()
  const service: SupplierOrderService = c.get("container").resolve("supplierOrderService")
  const userId = getUserId(c)
  const data = await c.req.json()

  const existing = await service.retrieveSupplier(id)
  if (userId && (existing as any).user_id && (existing as any).user_id !== userId) return c.json({ message: "Not found" }, 404)

  const update: Record<string, any> = {}
  if (data.name !== undefined) update.name = data.name
  if (data.contact !== undefined) update.contact = data.contact
  if (data.phone !== undefined) update.phone = data.phone
  if (data.notes !== undefined) update.notes = data.notes

  const supplier = await service.updateSuppliers({ id, ...update })
  return c.json({ supplier })
})

// DELETE /api/suppliers-registry/:id
suppliersRegistry.delete("/:id", async (c) => {
  const { id } = c.req.param()
  const service: SupplierOrderService = c.get("container").resolve("supplierOrderService")
  const userId = getUserId(c)

  const existing = await service.retrieveSupplier(id)
  if (userId && (existing as any).user_id && (existing as any).user_id !== userId) return c.json({ message: "Not found" }, 404)

  await service.deleteSuppliers(id)
  return c.json({ id, deleted: true })
})

export default suppliersRegistry
