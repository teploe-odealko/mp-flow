import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import { SECTION_META } from '@/utils/constants'
import { setupGuards } from './guards'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/catalog',
  },
  {
    path: '/catalog',
    name: 'catalog',
    component: () => import('@/components/catalog/CatalogPage.vue'),
    meta: { title: SECTION_META.catalog.title, subtitle: SECTION_META.catalog.subtitle },
  },
  {
    path: '/card/:cardId',
    name: 'card-detail',
    component: () => import('@/components/card-detail/CardDetailPage.vue'),
    props: true,
    meta: { title: '', subtitle: '' },
  },
  {
    path: '/orders',
    name: 'orders',
    component: () => import('@/components/orders/OrdersPage.vue'),
    meta: { title: SECTION_META.orders.title, subtitle: SECTION_META.orders.subtitle },
  },
  {
    path: '/analytics',
    name: 'analytics',
    component: () => import('@/components/analytics/AnalyticsPage.vue'),
    meta: { title: SECTION_META.analytics.title, subtitle: SECTION_META.analytics.subtitle },
  },
  {
    path: '/demand',
    name: 'demand',
    component: () => import('@/components/demand/DemandPage.vue'),
    meta: { title: SECTION_META.demand.title, subtitle: SECTION_META.demand.subtitle },
  },
  {
    path: '/logistics',
    name: 'logistics',
    component: () => import('@/components/logistics/LogisticsPage.vue'),
    meta: { title: SECTION_META.logistics.title, subtitle: SECTION_META.logistics.subtitle },
  },
  {
    path: '/finance',
    name: 'finance',
    component: () => import('@/components/finance/FinancePage.vue'),
    meta: { title: SECTION_META.finance.title, subtitle: SECTION_META.finance.subtitle },
  },
  {
    path: '/prices',
    name: 'prices',
    component: () => import('@/components/prices/PricesPage.vue'),
    meta: { title: SECTION_META.prices.title, subtitle: SECTION_META.prices.subtitle },
  },
  {
    path: '/promo',
    name: 'promo',
    component: () => import('@/components/promo/PromoPage.vue'),
    meta: { title: SECTION_META.promo.title, subtitle: SECTION_META.promo.subtitle },
  },
  {
    path: '/sync',
    name: 'sync',
    component: () => import('@/components/sync/SyncPage.vue'),
    meta: { title: SECTION_META.sync.title, subtitle: SECTION_META.sync.subtitle },
  },
  {
    path: '/mcp',
    name: 'mcp',
    component: () => import('@/components/mcp/McpPage.vue'),
    meta: { title: SECTION_META.mcp.title, subtitle: SECTION_META.mcp.subtitle },
  },
  {
    path: '/plugins',
    name: 'plugins',
    component: () => import('@/components/plugins/PluginsPage.vue'),
    meta: { title: SECTION_META.plugins.title, subtitle: SECTION_META.plugins.subtitle },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/components/settings/SettingsPage.vue'),
    meta: { title: SECTION_META.settings.title, subtitle: SECTION_META.settings.subtitle },
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

setupGuards(router)

export default router
