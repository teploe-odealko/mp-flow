/**
 * Ozon Sync Endpoint Extension for Directus
 *
 * Provides Ozon Seller API integration:
 * - POST /ozon-sync/products   — import products → master_cards
 * - POST /ozon-sync/stocks     — sync FBO stocks → master_cards.stock_fbo
 * - POST /ozon-sync/sales      — sync sales → sales_orders
 * - GET  /ozon-sync/status     — sync freshness info
 */
import { defineEndpoint } from '@directus/extensions-sdk';

// ─── Ozon API helper ───────────────────────────────────────────────
const OZON_API = 'https://api-seller.ozon.ru';

interface OzonCreds {
	clientId: string;
	apiKey: string;
}

async function ozonPost(path: string, body: Record<string, any>, creds: OzonCreds): Promise<any> {
	const res = await fetch(`${OZON_API}${path}`, {
		method: 'POST',
		headers: {
			'Client-Id': creds.clientId,
			'Api-Key': creds.apiKey,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Ozon API ${path} returned ${res.status}: ${text.slice(0, 500)}`);
	}
	return res.json();
}

// ─── Extension ─────────────────────────────────────────────────────
export default defineEndpoint((router, context) => {
	const { services, getSchema, logger } = context;
	const { ItemsService } = services;

	// Helper: resolve ozon creds from ozon_accounts collection
	async function getOzonCreds(
		accountId: number | undefined,
		accountability: any,
	): Promise<OzonCreds & { accountDbId: number }> {
		const schema = await getSchema();
		const accountsService = new ItemsService('ozon_accounts', { schema, accountability });

		let account: any;
		if (accountId) {
			account = await accountsService.readOne(accountId);
		} else {
			// Get first active account for this user
			const accounts = await accountsService.readByQuery({
				filter: { is_active: { _eq: true } },
				limit: 1,
			});
			account = accounts?.[0];
		}

		if (!account?.client_id || !account?.api_key) {
			throw new Error(
				'No Ozon account found. Create one in Ozon Accounts collection with Client ID and API Key.',
			);
		}

		return {
			clientId: account.client_id,
			apiKey: account.api_key,
			accountDbId: account.id,
		};
	}

	// ─── POST /ozon-sync/products ──────────────────────────────────
	// Import products from Ozon → master_cards
	router.post('/products', async (req: any, res: any) => {
		try {
			if (!req.accountability?.user) {
				return res.status(403).json({ error: 'Authentication required' });
			}

			const schema = await getSchema();
			const { accountId } = req.body || {};
			const creds = await getOzonCreds(accountId, req.accountability);

			// Fetch products from Ozon (paginated)
			let lastId = '';
			let allProducts: any[] = [];
			let pages = 0;
			const maxPages = 10;

			while (pages < maxPages) {
				const data = await ozonPost('/v3/product/list', {
					filter: { visibility: 'ALL' },
					last_id: lastId,
					limit: 1000,
				}, creds);

				const items = data?.result?.items || [];
				if (items.length === 0) break;

				allProducts = allProducts.concat(items);
				lastId = data?.result?.last_id || '';
				pages++;

				if (items.length < 1000) break;
			}

			if (allProducts.length === 0) {
				return res.json({ success: true, imported: 0, message: 'No products found in Ozon' });
			}

			// Fetch detailed info for all products
			const productIds = allProducts.map((p: any) => p.product_id);
			const detailData = await ozonPost('/v2/product/info/list', {
				product_id: productIds,
			}, creds);

			const detailed = detailData?.result?.items || [];

			// Upsert into master_cards
			const cardsService = new ItemsService('master_cards', { schema, accountability: req.accountability });

			let created = 0;
			let updated = 0;

			for (const product of detailed) {
				const ozonProductId = product.id || product.product_id;
				const ozonSku = product.fbo_sku || product.sku || product.sources?.[0]?.sku;
				const barcode = product.barcode || product.barcodes?.[0] || '';

				// Check if already exists by ozon_product_id
				const existing = await cardsService.readByQuery({
					filter: { ozon_product_id: { _eq: ozonProductId } },
					limit: 1,
				});

				const cardData: Record<string, any> = {
					title: product.name || product.offer_id || `Ozon #${ozonProductId}`,
					sku: product.offer_id || '',
					barcode: barcode,
					ozon_product_id: ozonProductId,
					ozon_sku: ozonSku || null,
					image_url: product.primary_image || product.images?.[0] || '',
					ozon_price: parseFloat(product.marketing_price || product.price || '0'),
					status: 'active',
				};

				if (existing?.length > 0) {
					await cardsService.updateOne(existing[0].id, cardData);
					updated++;
				} else {
					await cardsService.createOne(cardData);
					created++;
				}
			}

			// Update last_sync_at
			const accountsService = new ItemsService('ozon_accounts', { schema, accountability: req.accountability });
			await accountsService.updateOne(creds.accountDbId, {
				last_sync_at: new Date().toISOString(),
			});

			logger.info(`[ozon-sync] Products imported: ${created} created, ${updated} updated`);
			return res.json({
				success: true,
				imported: created + updated,
				created,
				updated,
				total_in_ozon: allProducts.length,
			});
		} catch (err: any) {
			logger.error(`[ozon-sync] Products error: ${err.message}`);
			return res.status(500).json({ success: false, error: err.message });
		}
	});

	// ─── POST /ozon-sync/stocks ────────────────────────────────────
	// Sync FBO stocks → master_cards.stock_fbo
	router.post('/stocks', async (req: any, res: any) => {
		try {
			if (!req.accountability?.user) {
				return res.status(403).json({ error: 'Authentication required' });
			}

			const schema = await getSchema();
			const { accountId } = req.body || {};
			const creds = await getOzonCreds(accountId, req.accountability);

			// Fetch warehouse stocks
			let offset = 0;
			let allStocks: any[] = [];

			while (true) {
				const data = await ozonPost('/v2/analytics/stock_on_warehouses', {
					offset,
					limit: 1000,
					warehouse_type: 'ALL',
				}, creds);

				const rows = data?.result?.rows || [];
				if (rows.length === 0) break;

				allStocks = allStocks.concat(rows);
				offset += rows.length;

				if (rows.length < 1000) break;
			}

			// Aggregate FBO stock per product_id
			const stockMap = new Map<number, number>();
			for (const row of allStocks) {
				const productId = row.item_code || row.product_id;
				const fboQty = row.free_to_sell_amount || row.fbo_present || 0;
				stockMap.set(productId, (stockMap.get(productId) || 0) + fboQty);
			}

			// Update master_cards
			const cardsService = new ItemsService('master_cards', { schema, accountability: req.accountability });
			let updatedCount = 0;

			for (const [productId, qty] of stockMap) {
				const existing = await cardsService.readByQuery({
					filter: { ozon_product_id: { _eq: productId } },
					limit: 1,
				});

				if (existing?.length > 0) {
					await cardsService.updateOne(existing[0].id, { stock_fbo: qty });
					updatedCount++;
				}
			}

			logger.info(`[ozon-sync] Stocks updated: ${updatedCount} cards`);
			return res.json({
				success: true,
				updated: updatedCount,
				total_stock_entries: allStocks.length,
			});
		} catch (err: any) {
			logger.error(`[ozon-sync] Stocks error: ${err.message}`);
			return res.status(500).json({ success: false, error: err.message });
		}
	});

	// ─── POST /ozon-sync/sales ─────────────────────────────────────
	// Sync sales/postings → sales_orders
	router.post('/sales', async (req: any, res: any) => {
		try {
			if (!req.accountability?.user) {
				return res.status(403).json({ error: 'Authentication required' });
			}

			const schema = await getSchema();
			const { accountId, days = 30 } = req.body || {};
			const creds = await getOzonCreds(accountId, req.accountability);

			const since = new Date();
			since.setDate(since.getDate() - days);

			// Fetch FBO postings
			let offset = 0;
			let allPostings: any[] = [];

			while (true) {
				const data = await ozonPost('/v3/posting/fbo/list', {
					dir: 'ASC',
					filter: {
						since: since.toISOString(),
						to: new Date().toISOString(),
					},
					limit: 1000,
					offset,
					with: { analytics_data: true, financial_data: true },
				}, creds);

				const postings = data?.result?.postings || data?.result || [];
				if (!Array.isArray(postings) || postings.length === 0) break;

				allPostings = allPostings.concat(postings);
				offset += postings.length;

				if (postings.length < 1000) break;
			}

			// Upsert into sales_orders
			const salesService = new ItemsService('sales_orders', { schema, accountability: req.accountability });
			let created = 0;
			let updated = 0;

			for (const posting of allPostings) {
				const postingNumber = posting.posting_number;
				if (!postingNumber) continue;

				// Determine status
				let status = 'delivered';
				const ozonStatus = (posting.status || '').toLowerCase();
				if (ozonStatus.includes('cancel')) status = 'cancelled';
				else if (ozonStatus.includes('return')) status = 'returned';

				// Calculate totals from products
				let revenue = 0;
				let commission = 0;
				let logistics = 0;

				for (const product of posting.products || []) {
					revenue += parseFloat(product.price || '0') * (product.quantity || 1);
				}

				// Financial data if available
				const fin = posting.financial_data;
				if (fin) {
					for (const prod of fin.products || []) {
						commission += Math.abs(parseFloat(prod.commission_amount || '0'));
						for (const svc of prod.item_services || []) {
							if (svc.name?.includes('logistics') || svc.name?.includes('логистик')) {
								logistics += Math.abs(parseFloat(svc.price || '0'));
							}
						}
					}
				}

				const saleDate = posting.created_at
					? posting.created_at.split('T')[0]
					: new Date().toISOString().split('T')[0];

				// Check if already exists
				const existing = await salesService.readByQuery({
					filter: { posting_number: { _eq: postingNumber } },
					limit: 1,
				});

				const saleData: Record<string, any> = {
					posting_number: postingNumber,
					marketplace: 'ozon',
					sale_date: saleDate,
					status,
					revenue_rub: revenue,
					commission_rub: commission,
					logistics_rub: logistics,
				};

				if (existing?.length > 0) {
					await salesService.updateOne(existing[0].id, saleData);
					updated++;
				} else {
					await salesService.createOne(saleData);
					created++;
				}
			}

			// Update last_sync_at
			const accountsService = new ItemsService('ozon_accounts', { schema, accountability: req.accountability });
			await accountsService.updateOne(creds.accountDbId, {
				last_sync_at: new Date().toISOString(),
			});

			logger.info(`[ozon-sync] Sales: ${created} created, ${updated} updated from ${allPostings.length} postings`);
			return res.json({
				success: true,
				created,
				updated,
				total_postings: allPostings.length,
				period_days: days,
			});
		} catch (err: any) {
			logger.error(`[ozon-sync] Sales error: ${err.message}`);
			return res.status(500).json({ success: false, error: err.message });
		}
	});

	// ─── GET /ozon-sync/status ─────────────────────────────────────
	// Show sync freshness and account info
	router.get('/status', async (req: any, res: any) => {
		try {
			if (!req.accountability?.user) {
				return res.status(403).json({ error: 'Authentication required' });
			}

			const schema = await getSchema();
			const accountsService = new ItemsService('ozon_accounts', { schema, accountability: req.accountability });
			const accounts = await accountsService.readByQuery({
				filter: { is_active: { _eq: true } },
				fields: ['id', 'account_name', 'client_id', 'is_active', 'last_sync_at'],
			});

			const cardsService = new ItemsService('master_cards', { schema, accountability: req.accountability });
			const totalCards = await cardsService.readByQuery({ aggregate: { count: ['id'] } });

			const salesService = new ItemsService('sales_orders', { schema, accountability: req.accountability });
			const totalSales = await salesService.readByQuery({ aggregate: { count: ['id'] } });

			return res.json({
				accounts: (accounts || []).map((a: any) => ({
					id: a.id,
					name: a.account_name,
					client_id: a.client_id,
					last_sync: a.last_sync_at,
				})),
				stats: {
					total_cards: totalCards?.[0]?.count?.id || 0,
					total_sales: totalSales?.[0]?.count?.id || 0,
				},
			});
		} catch (err: any) {
			logger.error(`[ozon-sync] Status error: ${err.message}`);
			return res.status(500).json({ success: false, error: err.message });
		}
	});
});
