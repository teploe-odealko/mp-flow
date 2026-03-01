export interface MpflowConfig {
  database: {
    url: string
  }
  auth: {
    logtoEndpoint?: string
    logtoAppId?: string
    cookieSecret: string
  }
  plugins: Array<{ resolve: string }>
  server?: {
    port?: number
  }
}

export function defineConfig(config: MpflowConfig): MpflowConfig {
  return config
}

export default defineConfig({
  database: {
    url: process.env.DATABASE_URL || "postgresql://mpflow:mpflow@localhost:5432/mpflow",
  },
  auth: {
    logtoEndpoint: process.env.LOGTO_ENDPOINT,
    logtoAppId: process.env.LOGTO_SPA_APP_ID,
    cookieSecret: process.env.COOKIE_SECRET || "mpflow-dev-secret-change-in-production",
  },
  plugins: [
    { resolve: "./plugins/ozon" },
  ],
  server: {
    port: Number(process.env.PORT) || 3000,
  },
})
