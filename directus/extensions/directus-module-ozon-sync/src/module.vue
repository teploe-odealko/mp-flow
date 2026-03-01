<template>
	<private-view title="Синхронизация с Ozon">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="sync" />
			</v-button>
		</template>

		<div class="ozon-sync-page">
			<!-- Status Banner -->
			<div class="status-banner" v-if="status">
				<div class="stat-card">
					<div class="stat-number">{{ status.stats?.total_cards || 0 }}</div>
					<div class="stat-label">Товаров</div>
				</div>
				<div class="stat-card">
					<div class="stat-number">{{ status.stats?.total_sales || 0 }}</div>
					<div class="stat-label">Продаж</div>
				</div>
				<div class="stat-card">
					<div class="stat-number">{{ status.accounts?.length || 0 }}</div>
					<div class="stat-label">Ozon аккаунтов</div>
				</div>
				<div class="stat-card">
					<div class="stat-number">{{ lastSyncLabel }}</div>
					<div class="stat-label">Последний синк</div>
				</div>
			</div>

			<!-- No accounts warning -->
			<v-notice v-if="status && (!status.accounts || status.accounts.length === 0)" type="warning">
				Нет Ozon аккаунтов. Перейдите в
				<router-link to="/content/ozon_accounts">Ozon Accounts</router-link>
				и добавьте Client ID и API Key.
			</v-notice>

			<!-- Sync Actions -->
			<div class="sync-actions">
				<div class="sync-card" @click="runSync('products')">
					<div class="sync-card-icon">
						<v-icon name="inventory_2" />
					</div>
					<div class="sync-card-content">
						<h3>Импорт товаров</h3>
						<p>Загрузить товары из Ozon Seller → каталог Master Cards</p>
					</div>
					<v-progress-circular v-if="loading === 'products'" indeterminate small />
					<v-icon v-else name="chevron_right" />
				</div>

				<div class="sync-card" @click="runSync('stocks')">
					<div class="sync-card-icon">
						<v-icon name="warehouse" />
					</div>
					<div class="sync-card-content">
						<h3>Синхронизация остатков</h3>
						<p>Обновить остатки FBO на складах Ozon</p>
					</div>
					<v-progress-circular v-if="loading === 'stocks'" indeterminate small />
					<v-icon v-else name="chevron_right" />
				</div>

				<div class="sync-card" @click="runSync('sales')">
					<div class="sync-card-icon">
						<v-icon name="point_of_sale" />
					</div>
					<div class="sync-card-content">
						<h3>Синхронизация продаж</h3>
						<p>Загрузить отправления FBO за последние 30 дней</p>
					</div>
					<v-progress-circular v-if="loading === 'sales'" indeterminate small />
					<v-icon v-else name="chevron_right" />
				</div>

				<div class="sync-card sync-card-all" @click="runSyncAll">
					<div class="sync-card-icon">
						<v-icon name="cloud_sync" />
					</div>
					<div class="sync-card-content">
						<h3>Полная синхронизация</h3>
						<p>Товары → Остатки → Продажи (всё за один раз)</p>
					</div>
					<v-progress-circular v-if="loading === 'all'" indeterminate small />
					<v-icon v-else name="chevron_right" />
				</div>
			</div>

			<!-- Results -->
			<div class="results" v-if="results.length > 0">
				<h3>Результаты</h3>
				<div
					v-for="(result, idx) in results"
					:key="idx"
					class="result-item"
					:class="{ 'result-error': !result.success }"
				>
					<v-icon :name="result.success ? 'check_circle' : 'error'" />
					<div class="result-content">
						<strong>{{ result.action }}</strong>
						<span v-if="result.success">
							{{ result.message }}
						</span>
						<span v-else class="error-text">
							{{ result.error }}
						</span>
					</div>
					<span class="result-time">{{ result.time }}</span>
				</div>
			</div>
		</div>
	</private-view>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useApi } from '@directus/extensions-sdk';

const api = useApi();

const status = ref<any>(null);
const loading = ref<string | null>(null);
const results = ref<any[]>([]);

const ENDPOINT_BASE = '/directus-endpoint-ozon-sync';

const lastSyncLabel = computed(() => {
	if (!status.value?.accounts?.length) return '—';
	const lastSync = status.value.accounts
		.map((a: any) => a.last_sync)
		.filter(Boolean)
		.sort()
		.pop();
	if (!lastSync) return 'никогда';
	const d = new Date(lastSync);
	const now = new Date();
	const diffMin = Math.round((now.getTime() - d.getTime()) / 60000);
	if (diffMin < 1) return 'только что';
	if (diffMin < 60) return `${diffMin} мин назад`;
	if (diffMin < 1440) return `${Math.round(diffMin / 60)} ч назад`;
	return d.toLocaleDateString('ru-RU');
});

async function loadStatus() {
	try {
		const { data } = await api.get(`${ENDPOINT_BASE}/status`);
		status.value = data;
	} catch (e: any) {
		console.error('[ozon-sync] Failed to load status:', e);
	}
}

async function runSync(action: string) {
	if (loading.value) return;
	loading.value = action;

	const labels: Record<string, string> = {
		products: 'Импорт товаров',
		stocks: 'Синхронизация остатков',
		sales: 'Синхронизация продаж',
	};

	try {
		const { data } = await api.post(`${ENDPOINT_BASE}/${action}`, {});
		results.value.unshift({
			success: true,
			action: labels[action] || action,
			message: formatResult(action, data),
			time: new Date().toLocaleTimeString('ru-RU'),
		});
		await loadStatus();
	} catch (e: any) {
		const errMsg = e?.response?.data?.error || e.message || 'Unknown error';
		results.value.unshift({
			success: false,
			action: labels[action] || action,
			error: errMsg,
			time: new Date().toLocaleTimeString('ru-RU'),
		});
	} finally {
		loading.value = null;
	}
}

async function runSyncAll() {
	if (loading.value) return;
	loading.value = 'all';

	for (const action of ['products', 'stocks', 'sales']) {
		await runSync(action);
	}

	loading.value = null;
}

function formatResult(action: string, data: any): string {
	if (action === 'products') {
		return `Создано: ${data.created}, обновлено: ${data.updated}, всего в Ozon: ${data.total_in_ozon}`;
	}
	if (action === 'stocks') {
		return `Обновлено карточек: ${data.updated}, записей остатков: ${data.total_stock_entries}`;
	}
	if (action === 'sales') {
		return `Создано: ${data.created}, обновлено: ${data.updated}, отправлений: ${data.total_postings}`;
	}
	return JSON.stringify(data);
}

onMounted(loadStatus);
</script>

<style scoped>
.ozon-sync-page {
	padding: 0 var(--content-padding) var(--content-padding);
	max-width: 900px;
}

.status-banner {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 16px;
	margin-bottom: 24px;
}

.stat-card {
	background: var(--theme--background-normal);
	border-radius: var(--theme--border-radius);
	padding: 16px;
	text-align: center;
}

.stat-number {
	font-size: 24px;
	font-weight: 700;
	color: var(--theme--primary);
}

.stat-label {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
	margin-top: 4px;
}

.sync-actions {
	display: flex;
	flex-direction: column;
	gap: 12px;
	margin-bottom: 24px;
}

.sync-card {
	display: flex;
	align-items: center;
	gap: 16px;
	padding: 16px 20px;
	background: var(--theme--background-normal);
	border-radius: var(--theme--border-radius);
	cursor: pointer;
	transition: background 0.15s, box-shadow 0.15s;
	border: 2px solid transparent;
}

.sync-card:hover {
	background: var(--theme--background-accent);
	border-color: var(--theme--primary);
}

.sync-card-all {
	border-color: var(--theme--primary);
	background: color-mix(in srgb, var(--theme--primary) 8%, var(--theme--background-normal));
}

.sync-card-icon {
	width: 44px;
	height: 44px;
	display: flex;
	align-items: center;
	justify-content: center;
	border-radius: 12px;
	background: color-mix(in srgb, var(--theme--primary) 15%, transparent);
	color: var(--theme--primary);
	flex-shrink: 0;
}

.sync-card-content {
	flex: 1;
}

.sync-card-content h3 {
	margin: 0;
	font-size: 14px;
	font-weight: 600;
}

.sync-card-content p {
	margin: 2px 0 0;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.results {
	margin-top: 8px;
}

.results h3 {
	font-size: 14px;
	font-weight: 600;
	margin-bottom: 12px;
}

.result-item {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 12px 16px;
	background: var(--theme--background-normal);
	border-radius: var(--theme--border-radius);
	margin-bottom: 8px;
	border-left: 3px solid var(--theme--success);
}

.result-item.result-error {
	border-left-color: var(--theme--danger);
}

.result-item .v-icon {
	color: var(--theme--success);
	flex-shrink: 0;
}

.result-item.result-error .v-icon {
	color: var(--theme--danger);
}

.result-content {
	flex: 1;
}

.result-content strong {
	display: block;
	font-size: 13px;
}

.result-content span {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.error-text {
	color: var(--theme--danger) !important;
}

.result-time {
	font-size: 11px;
	color: var(--theme--foreground-subdued);
	flex-shrink: 0;
}
</style>
