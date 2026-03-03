export interface TmapiSku {
  sku_id: string
  name: string
  image: string | null
  price: number | null
  stock: number | null
  props: string[]
}

export interface TmapiPriceTier {
  min_qty: number
  price: number
}

export interface TmapiItem {
  item_id: string | null
  title: string | null
  url: string | null
  supplier_name: string | null
  images: string[]
  price_min: string | null
  price_max: string | null
  price_tiers: TmapiPriceTier[] | null
  currency: string | null
  skus: TmapiSku[]
  raw: any
}

export async function fetchAndParse1688Item(url: string): Promise<TmapiItem> {
  const token = process.env.TMAPI_API_TOKEN
  if (!token) throw new Error("TMAPI_API_TOKEN is not configured")

  let res: Response
  try {
    res = await fetch(`http://api.tmapi.top/1688/item_detail_by_url?apiToken=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url.trim() }),
    })
  } catch (err: any) {
    const cause = err.cause ? ` (${err.cause.message || err.cause.code || err.cause})` : ""
    throw new Error(`TMAPI network error: ${err.message}${cause}`)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    // User-friendly messages for known errors
    if (res.status === 439 || text.includes("Insufficient")) {
      throw new Error("Недостаточно средств на балансе TMAPI. Пополните на tmapi.top")
    }
    if (res.status === 401) {
      throw new Error("Неверный TMAPI_API_TOKEN. Проверьте токен в настройках")
    }
    throw new Error(`Ошибка TMAPI (${res.status}): ${text.slice(0, 200)}`)
  }

  const payload = await res.json()
  return parseTmapiResponse(payload)
}

function parseTmapiResponse(payload: any): TmapiItem {
  if (!payload || typeof payload !== "object") {
    return { item_id: null, title: null, url: null, supplier_name: null, images: [], price_min: null, price_max: null, price_tiers: null, currency: null, skus: [], raw: payload }
  }

  const data = payload.data
  const root = data && typeof data === "object" ? data : payload

  // Find item object
  let item: any = root
  for (const key of ["item", "result", "offer", "product"]) {
    const nested = root[key]
    if (nested && typeof nested === "object" && ("title" in nested || "subject" in nested || "skuMap" in nested || "images" in nested)) {
      item = nested
      break
    }
  }

  const title = String(item.title || item.subject || item.name || item.itemTitle || "").trim() || null
  const item_id = String(item.item_id || item.itemId || item.id || "").trim() || null
  const url = String(item.url || item.itemUrl || root.url || "").trim() || null
  const supplier_name = String(item.company_name || item.companyName || item.seller_name || item.sellerName || item.shop_name || item.shopName || "").trim() || null

  // Images
  const images: string[] = []
  const mainImage = item.mainImage || item.main_image || item.image
  if (mainImage) {
    const s = String(mainImage).trim()
    if (s) images.push(s)
  }
  for (const key of ["images", "imgUrls", "imageList"]) {
    const arr = item[key]
    if (Array.isArray(arr)) {
      for (const v of arr) {
        const s = String(v).trim()
        if (s && !images.includes(s)) images.push(s)
      }
    }
  }

  // Prices
  const prices: number[] = []
  for (const pk of ["price", "priceMin", "priceMax", "price_min", "price_max"]) {
    const v = item[pk]
    if (v != null) {
      const n = Number(v)
      if (!isNaN(n) && n > 0) prices.push(n)
    }
  }
  const priceInfo = item.price_info
  if (priceInfo && typeof priceInfo === "object") {
    for (const pk of ["price_min", "price_max", "price"]) {
      const v = priceInfo[pk]
      if (v != null) {
        const n = Number(v)
        if (!isNaN(n) && n > 0) prices.push(n)
      }
    }
  }

  // Tiered pricing (e.g. tiered_price_info.prices: [{price, beginAmount}])
  let price_tiers: TmapiPriceTier[] | null = null
  const tieredInfo = root.tiered_price_info || item.tiered_price_info
  if (tieredInfo && Array.isArray(tieredInfo.prices) && tieredInfo.prices.length > 0) {
    const parsed = tieredInfo.prices
      .map((p: any) => ({ min_qty: Number(p.beginAmount ?? 1), price: Number(p.price) }))
      .filter((t: TmapiPriceTier) => !isNaN(t.min_qty) && !isNaN(t.price) && t.price > 0)
      .sort((a: TmapiPriceTier, b: TmapiPriceTier) => a.min_qty - b.min_qty)
    if (parsed.length > 0) price_tiers = parsed
  }

  // Currency
  const currency = String(root.currency || item.currency || "").trim() || null

  // SKU parsing
  const skus = parseSkus(item)

  return {
    item_id,
    title,
    url,
    supplier_name,
    images,
    price_min: prices.length > 0 ? String(Math.min(...prices)) : null,
    price_max: prices.length > 0 ? String(Math.max(...prices)) : null,
    price_tiers,
    currency,
    skus,
    raw: payload,
  }
}

function parseSkus(item: any): TmapiSku[] {
  const skuMapRaw = item.skuMap || item.sku_map
  const skuPropsRaw = item.skuProps || item.sku_props || item.skuInfoMap

  // Build prop name → image map
  const propImages: Record<string, string> = {}
  if (Array.isArray(skuPropsRaw)) {
    for (const prop of skuPropsRaw) {
      if (!prop || typeof prop !== "object") continue
      const values = prop.values || prop.value || []
      if (!Array.isArray(values)) continue
      for (const val of values) {
        if (!val || typeof val !== "object") continue
        const valName = String(val.name || val.value || "").trim()
        const valImage = String(val.imageUrl || val.image || val.img || "").trim()
        if (valName && valImage) propImages[valName] = valImage
      }
    }
  }

  const skus: TmapiSku[] = []

  // Parse skuMap as dict
  if (skuMapRaw && typeof skuMapRaw === "object" && !Array.isArray(skuMapRaw)) {
    for (const [comboKey, skuData] of Object.entries(skuMapRaw)) {
      if (!skuData || typeof skuData !== "object") continue
      const sd = skuData as any
      const skuId = String(sd.skuId || sd.sku_id || sd.id || comboKey).trim()

      let price: number | null = null
      for (const pk of ["price", "salePrice", "discountPrice", "originalPrice"]) {
        if (sd[pk] != null) {
          const n = Number(sd[pk])
          if (!isNaN(n)) { price = n; break }
        }
      }

      let stock: number | null = null
      for (const sk of ["canBookCount", "stock", "quantity", "amountOnSale"]) {
        if (sd[sk] != null) {
          const n = Number(sd[sk])
          if (!isNaN(n)) { stock = Math.floor(n); break }
        }
      }

      const parts = comboKey.replace(/&gt;/g, ">").split(">").map((p) => p.trim()).filter(Boolean)
      const name = parts.length > 0 ? parts.join(" / ") : comboKey

      let image: string | null = null
      for (const part of parts) {
        if (propImages[part]) { image = propImages[part]; break }
      }

      skus.push({ sku_id: skuId, name, image, price, stock, props: parts })
    }
  }
  // Parse skuMap as array
  else if (Array.isArray(skuMapRaw)) {
    for (let idx = 0; idx < skuMapRaw.length; idx++) {
      const sd = skuMapRaw[idx]
      if (!sd || typeof sd !== "object") continue
      const skuId = String(sd.skuId || sd.sku_id || sd.id || idx).trim()

      let price: number | null = null
      for (const pk of ["price", "salePrice", "discountPrice"]) {
        if (sd[pk] != null) {
          const n = Number(sd[pk])
          if (!isNaN(n)) { price = n; break }
        }
      }

      const specStr = String(sd.specAttrs || sd.props || sd.attributes || "")
      const parts = specStr ? specStr.replace(/&gt;/g, ">").split(">").map((p: string) => p.trim()).filter(Boolean) : []
      const name = parts.length > 0 ? parts.join(" / ") : String(sd.name || `SKU ${idx + 1}`)

      let image: string | null = null
      for (const part of parts) {
        if (propImages[part]) { image = propImages[part]; break }
      }
      if (!image) {
        const imgStr = String(sd.imageUrl || sd.image || "").trim()
        if (imgStr) image = imgStr
      }

      skus.push({ sku_id: skuId, name, image, price, stock: null, props: parts })
    }
  }

  // Fallback: skus array
  if (skus.length === 0) {
    const skusArray = item.skus
    if (Array.isArray(skusArray)) {
      for (let idx = 0; idx < skusArray.length; idx++) {
        const sd = skusArray[idx]
        if (!sd || typeof sd !== "object") continue
        const skuId = String(sd.skuid || sd.skuId || sd.sku_id || idx).trim()

        let price: number | null = null
        for (const pk of ["sale_price", "price", "salePrice"]) {
          if (sd[pk] != null) {
            const n = Number(sd[pk])
            if (!isNaN(n)) { price = n; break }
          }
        }

        let stock: number | null = null
        if (sd.stock != null) {
          const n = Number(sd.stock)
          if (!isNaN(n)) stock = Math.floor(n)
        }

        const propsStr = String(sd.props_names || sd.propsNames || "").trim()
        const parts: string[] = []
        if (propsStr) {
          for (const segment of propsStr.split(";")) {
            const s = segment.trim()
            if (s.includes(":")) {
              const val = s.split(":")[1]?.trim()
              if (val) parts.push(val)
            } else if (s) {
              parts.push(s)
            }
          }
        }
        const name = parts.length > 0 ? parts.join(" / ") : String(sd.name || `SKU ${idx + 1}`)

        let image: string | null = null
        for (const part of parts) {
          if (propImages[part]) { image = propImages[part]; break }
        }
        if (!image) {
          const imgStr = String(sd.imageUrl || sd.image || "").trim()
          if (imgStr) image = imgStr
        }

        skus.push({ sku_id: skuId, name, image, price, stock, props: parts })
      }
    }
  }

  return skus
}
